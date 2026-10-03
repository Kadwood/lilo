/** Byte-level helpers shared by the format readers and writers. */

/** Growable byte buffer with the integer writers the formats need, plus patch-in-place. */
export class ByteWriter {
  private buf = new Uint8Array(1024);
  length = 0;

  private grow(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }

  u8(...values: number[]): this {
    this.grow(values.length);
    for (const v of values) this.buf[this.length++] = v & 0xff;
    return this;
  }
  /** Signed or unsigned, both write the low byte (like pyembroidery's `write_int_8`). */
  i8(v: number): this {
    return this.u8(v);
  }
  u16le(v: number): this {
    return this.u8(v, v >> 8);
  }
  u16be(v: number): this {
    return this.u8(v >> 8, v);
  }
  u24le(v: number): this {
    return this.u8(v, v >> 8, v >> 16);
  }
  u24be(v: number): this {
    return this.u8(v >> 16, v >> 8, v);
  }
  u32le(v: number): this {
    return this.u8(v, v >> 8, v >> 16, v >> 24);
  }
  u32be(v: number): this {
    return this.u8(v >> 24, v >> 16, v >> 8, v);
  }
  /** Latin-1 / ASCII string (characters above 0xFF are masked, like the originals). */
  ascii(s: string): this {
    for (const c of s) this.u8(c.charCodeAt(0));
    return this;
  }
  utf8(s: string): this {
    return this.bytes(new TextEncoder().encode(s));
  }
  utf16be(s: string): this {
    for (let i = 0; i < s.length; i++) this.u16be(s.charCodeAt(i));
    return this;
  }
  bytes(b: ArrayLike<number>): this {
    this.grow(b.length);
    for (let i = 0; i < b.length; i++) this.buf[this.length++] = b[i] & 0xff;
    return this;
  }
  fill(v: number, n: number): this {
    for (let i = 0; i < n; i++) this.u8(v);
    return this;
  }
  /** Pad with `v` until the buffer is `size` bytes long. */
  padTo(size: number, v = 0x20): this {
    while (this.length < size) this.u8(v);
    return this;
  }
  /** Overwrite 32 bits big-endian at `at`. */
  patch32be(at: number, v: number): void {
    this.buf[at] = v >> 24;
    this.buf[at + 1] = v >> 16;
    this.buf[at + 2] = v >> 8;
    this.buf[at + 3] = v;
  }
  patch32le(at: number, v: number): void {
    this.buf[at] = v;
    this.buf[at + 1] = v >> 8;
    this.buf[at + 2] = v >> 16;
    this.buf[at + 3] = v >> 24;
  }
  done(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

/** Bounds-checked sequential reader. Reading past the end throws `FormatError`. */
export class ByteReader {
  pos = 0;
  constructor(
    readonly data: Uint8Array,
    private readonly label = "file",
  ) {}

  get remaining(): number {
    return this.data.length - this.pos;
  }
  get eof(): boolean {
    return this.pos >= this.data.length;
  }
  private need(n: number): void {
    if (this.pos + n > this.data.length) throw new FormatError(`The ${this.label} ends unexpectedly.`);
  }
  seek(pos: number): void {
    if (pos < 0 || pos > this.data.length) throw new FormatError(`The ${this.label} is corrupt (bad offset).`);
    this.pos = pos;
  }
  skip(n: number): void {
    this.seek(this.pos + n);
  }
  u8(): number {
    this.need(1);
    return this.data[this.pos++];
  }
  i8(): number {
    const v = this.u8();
    return v > 127 ? v - 256 : v;
  }
  u16le(): number {
    this.need(2);
    const v = this.data[this.pos] | (this.data[this.pos + 1] << 8);
    this.pos += 2;
    return v;
  }
  u16be(): number {
    this.need(2);
    const v = (this.data[this.pos] << 8) | this.data[this.pos + 1];
    this.pos += 2;
    return v;
  }
  u24be(): number {
    this.need(3);
    const v = (this.data[this.pos] << 16) | (this.data[this.pos + 1] << 8) | this.data[this.pos + 2];
    this.pos += 3;
    return v;
  }
  u24le(): number {
    this.need(3);
    const v = this.data[this.pos] | (this.data[this.pos + 1] << 8) | (this.data[this.pos + 2] << 16);
    this.pos += 3;
    return v;
  }
  u32le(): number {
    this.need(4);
    const d = this.data;
    const p = this.pos;
    this.pos += 4;
    return (d[p] | (d[p + 1] << 8) | (d[p + 2] << 16) | (d[p + 3] << 24)) >>> 0;
  }
  u32be(): number {
    this.need(4);
    const d = this.data;
    const p = this.pos;
    this.pos += 4;
    return ((d[p] << 24) | (d[p + 1] << 16) | (d[p + 2] << 8) | d[p + 3]) >>> 0;
  }
  bytes(n: number): Uint8Array {
    this.need(n);
    const out = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  ascii(n: number): string {
    return String.fromCharCode(...this.bytes(n));
  }
}

export class FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatError";
  }
}

export const signed8 = (v: number): number => (v > 127 ? v - 256 : v);
export const signed16 = (v: number): number => (v > 0x7fff ? v - 0x10000 : v);
export const signed32 = (v: number): number => (v | 0);

/** Python's `round()`: halves go to the even neighbour. The ported writers rely on it. */
export function pyRound(v: number): number {
  const f = Math.floor(v);
  const d = v - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}
