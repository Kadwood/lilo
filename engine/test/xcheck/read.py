#!/usr/bin/env python3
"""Read embroidery files with pyembroidery (an independent implementation) and print JSON.

Usage: read.py <file> [<file> ...]
Prints {"pyembroidery": "<version>", "files": {"<basename>": {...}}}. Stitch coordinates are in
0.1 mm, y down, as pyembroidery holds them. A file pyembroidery cannot read gives {"error": "..."}.
Header fields are parsed straight from the bytes (pyembroidery does not expose them) following the
layout of its own writers, so a Lilo header that disagrees with its body shows up.
"""
import json
import os
import struct
import sys

from importlib.metadata import version

import pyembroidery as pe

NAMES = {
    pe.STITCH: "stitch", pe.JUMP: "jump", pe.TRIM: "trim", pe.COLOR_CHANGE: "colorChange",
    pe.STOP: "stop", pe.END: "end", pe.NEEDLE_SET: "needleSet", pe.SEQUENCE_BREAK: "sequenceBreak",
}


def dst_header(data):
    out = {}
    for line in data[:512].decode("latin-1").split("\r"):
        if ":" in line:
            k, v = line.split(":", 1)
            if k.strip() in ("+X", "-X", "+Y", "-Y", "ST", "CO"):
                out[k.strip()] = int(v.strip())
    return out


def jef_header(data):
    names = ("hoop", "left", "top", "right", "bottom")
    vals = struct.unpack_from("<5i", data, 32)
    out = dict(zip(names, vals))
    out["colors"], out["points"] = struct.unpack_from("<2I", data, 24)
    return out


def jef_expected_hoop(bounds):
    from pyembroidery.JefWriter import get_jef_hoop_size

    return get_jef_hoop_size(int(round(bounds[2] - bounds[0])), int(round(bounds[3] - bounds[1])))


def vp3_header(data):
    # %vsm% NUL, string16, 3 bytes, 4 bytes (distance to end), string16 (global notes), then extents.
    pos = 6
    n = struct.unpack_from(">H", data, pos)[0]
    pos += 2 + n + 3 + 4
    n = struct.unpack_from(">H", data, pos)[0]
    pos += 2 + n
    right, neg_top, left, neg_bottom, stitches = struct.unpack_from(">4iI", data, pos)
    return {"right": right, "top": -neg_top, "left": left, "bottom": -neg_bottom, "stitches": stitches}


HEADERS = {".dst": dst_header, ".jef": jef_header, ".vp3": vp3_header}


def read_one(path):
    ext = os.path.splitext(path)[1].lower()
    with open(path, "rb") as f:
        data = f.read()
    pat = pe.read(path)
    if pat is None:
        return {"error": "pyembroidery.read returned None"}
    out = {
        "stitches": [[round(x, 3), round(y, 3), NAMES.get(c & 0xFF, "other:%d" % (c & 0xFF))] for x, y, c in pat.stitches],
        "threads": ["#%06x" % (t.color & 0xFFFFFF) for t in pat.threadlist],
        "bounds": list(pat.bounds()),
    }
    if ext in HEADERS:
        out["header"] = HEADERS[ext](data)
        if ext == ".jef":
            out["header"]["expectedHoop"] = jef_expected_hoop(out["bounds"])
    return out


def main(paths):
    files = {}
    for p in paths:
        try:
            files[os.path.basename(p)] = read_one(p)
        except Exception as e:  # report, do not hide: the test fails on any error
            files[os.path.basename(p)] = {"error": "%s: %s" % (type(e).__name__, e)}
    print(json.dumps({"pyembroidery": version("pyembroidery"), "files": files}))


if __name__ == "__main__":
    main(sys.argv[1:])
