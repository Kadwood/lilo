/**
 * The compression inside Husqvarna HUS and Pfaff/Viking VIP files (Greenleaf ArchiveLib, an LZ77 +
 * Huffman scheme close to LHA "lh6"). Decoder ported from pyembroidery's EmbCompress.py (MIT,
 * https://github.com/EmbroidePy/pyembroidery), which solved the format; the description of the
 * container comes from Jason Weiler's notes and libembroidery (zlib licence).
 *
 * Each of a file's three streams (command, x, y) is one independent bit stream, made of blocks:
 * a 16-bit token count, then three Huffman tables (code lengths, characters, distances), then the
 * tokens. A token below 256 is a literal byte, 510 ends the stream, anything else is a copy of
 * `token - 253` bytes from `distance + 1` bytes back.
 *
 * The encoder writes **literal-only** blocks with a fixed table in which every byte value has an
 * 8-bit code, so the output is the raw data behind a 4-byte header. This is what pyembroidery's
 * `compress()` and libembroidery's `hus_compress()` do too: it is a valid stream for the decoder
 * (no copies are needed), only larger than a real LZ encoder would make it. One difference: the
 * 16-bit token count is read most significant bit first, so it is written big-endian here. Those two
 * write it little-endian, which only decodes when the low byte of the size happens to be big enough
 * (a stream of exactly 256 bytes, or of 65534, comes out as a one-token block).
 */
import { FormatError } from "./io";

/** Most tokens one block can announce (the count is 16 bits). */
const BLOCK_MAX = 0xffff;
/** After the 2-byte token count: 0x02A0 01FE selects 256 literals of 8 bits and a dummy distance table. */
const LITERAL_BLOCK_TABLES = [0x02, 0xa0, 0x01, 0xfe];

/** `data` as literal-only blocks of at most 65535 bytes each. */
export function compressLiterals(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / BLOCK_MAX));
  const out = new Uint8Array(data.length + blocks * 6);
  let o = 0;
  for (let i = 0; i < blocks; i++) {
    const chunk = data.subarray(i * BLOCK_MAX, Math.min(data.length, (i + 1) * BLOCK_MAX));
    out[o++] = chunk.length >> 8;
    out[o++] = chunk.length & 0xff;
    for (const b of LITERAL_BLOCK_TABLES) out[o++] = b;
    out.set(chunk, o);
    o += chunk.length;
  }
  return out;
}

interface Huffman {
  /** Symbol returned when the table has no codes (zero bits are consumed). */
  value: number;
  width: number;
  lengths: number[];
  /** `1 << width` entries: symbol index, or -1 where no code reaches. */
  table: Int32Array | null;
}

const single = (value: number): Huffman => ({ value, width: 0, lengths: [], table: null });

/** Table cells one stream may build in total, so a hostile file of tiny blocks cannot stall the app. */
const MAX_TABLE_WORK = 1 << 26;

function build(s: BitStream, lengths: number[], value = 0): Huffman {
  let width = 0;
  for (const l of lengths) if (l > width) width = l;
  if (width === 0) throw new FormatError("The compressed data is corrupt (empty code table).");
  if (width > 16) throw new FormatError("The compressed data is corrupt (code too long).");
  s.work += 1 << width;
  if (s.work > MAX_TABLE_WORK) throw new FormatError("The compressed data is corrupt (too many tables).");
  const table = new Int32Array(1 << width).fill(-1);
  let at = 0;
  let size = 1 << width;
  for (let bits = 1; bits <= width; bits++) {
    size >>= 1;
    for (let sym = 0; sym < lengths.length; sym++) {
      if (lengths[sym] !== bits) continue;
      for (let k = 0; k < size && at < table.length; k++) table[at++] = sym;
    }
  }
  return { value, width, lengths, table };
}

class BitStream {
  pos = 0;
  /** Huffman table cells built so far. */
  work = 0;
  readonly totalBits: number;
  constructor(private readonly data: Uint8Array) {
    this.totalBits = data.length * 8;
  }
  /** The next `n` (at most 16) bits without consuming them; zeros past the end. */
  peek(n: number): number {
    const i = this.pos >> 3;
    const d = this.data;
    const word = ((d[i] ?? 0) << 16) | ((d[i + 1] ?? 0) << 8) | (d[i + 2] ?? 0);
    return (word >> (24 - (this.pos & 7) - n)) & ((1 << n) - 1);
  }
  pop(n: number): number {
    const v = this.peek(n);
    this.pos += n;
    return v;
  }
  lookup(h: Huffman): number {
    if (h.table === null) return h.value;
    const sym = h.table[this.peek(16) >> (16 - h.width)];
    if (sym < 0) throw new FormatError("The compressed data is corrupt (unknown code).");
    this.pos += h.lengths[sym];
    return sym;
  }
  variableLength(): number {
    let m = this.pop(3);
    if (m !== 7) return m;
    for (let q = 0; q < 13; q++) {
      if (this.pop(1) === 1) m++;
      else break;
    }
    return m;
  }
}

function loadLengthTable(s: BitStream): Huffman {
  const count = s.pop(5);
  if (count === 0) return single(s.pop(5));
  const lengths = new Array<number>(count).fill(0);
  let index = 0;
  while (index < count) {
    if (index === 3) index += s.pop(2);
    if (index >= count) throw new FormatError("The compressed data is corrupt (code table overrun).");
    lengths[index] = s.variableLength();
    index++;
  }
  return build(s, lengths, 8);
}

function loadCharacterTable(s: BitStream, lengthTable: Huffman): Huffman {
  const count = s.pop(9);
  if (count === 0) return single(s.pop(9));
  const lengths = new Array<number>(count).fill(0);
  let index = 0;
  while (index < count) {
    const c = s.lookup(lengthTable);
    if (c === 0) index += 1;
    else if (c === 1) index += 3 + s.pop(4);
    else if (c === 2) index += 20 + s.pop(9);
    else {
      lengths[index] = c - 2;
      index++;
    }
  }
  return build(s, lengths);
}

function loadDistanceTable(s: BitStream): Huffman {
  const count = s.pop(5);
  if (count === 0) return single(s.pop(5));
  const lengths: number[] = [];
  for (let i = 0; i < count; i++) lengths.push(s.variableLength());
  return build(s, lengths);
}

/**
 * Decompress one stream. Stops at the end token, at the end of the input, or once `expected` bytes
 * exist, so a hostile stream can neither run forever nor allocate more than `expected` bytes.
 * Throws `FormatError` on a malformed stream.
 */
export function expand(input: Uint8Array, expected: number): Uint8Array {
  const s = new BitStream(input);
  const out = new Uint8Array(expected);
  let n = 0;
  let blockLeft = 0;
  let characters: Huffman = single(0);
  let distances: Huffman = single(0);
  while (s.pos < s.totalBits && n < expected) {
    if (blockLeft <= 0) {
      blockLeft = s.pop(16);
      characters = loadCharacterTable(s, loadLengthTable(s));
      distances = loadDistanceTable(s);
    }
    blockLeft--;
    const token = s.lookup(characters);
    if (token <= 255) {
      out[n++] = token;
    } else if (token === 510) {
      break;
    } else if (token > 510) {
      throw new FormatError("The compressed data is corrupt (bad token).");
    } else {
      const length = token - 253;
      const dist = s.lookup(distances);
      const back = (dist === 0 ? 0 : (1 << (dist - 1)) + s.pop(dist - 1)) + 1;
      if (back > n) throw new FormatError("The compressed data is corrupt (copy from before the start).");
      for (let i = 0; i < length && n < expected; i++, n++) out[n] = out[n - back];
    }
  }
  return out.subarray(0, n);
}
