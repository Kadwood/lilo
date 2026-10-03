---
id: "formats-reference"
title: "File formats"
summary: "The 12 embroidery file formats Lilo writes (all but G-code it also reads), and which machines use each one."
section: "reference"
order: 20
keywords: ["format","pes","dst","exp","jef","vp3","xxx","u01","pec","brand","machine","compatibility"]
appContext: ["dialog.export","view.converter"]
status: "generated"
---

# File formats

Lilo writes 12 embroidery formats and reads 11 of them. The list is built from the app's own format table.

A format is the file type your machine understands. Brother and Baby Lock machines use **PES**. Most commercial machines use **DST**. If you are not sure, check your machine manual or the type of file it already sews.

| Extension | Name | Lilo | Keeps thread colours? | Used by |
| --- | --- | --- | --- | --- |
| .pes | Brother PES | Read and write | Yes | Brother, Baby Lock, Bernina (reads) |
| .pec | Brother PEC | Read and write | Yes | Brother, Baby Lock |
| .dst | Tajima DST | Read and write | No | Tajima, Barudan, Ricoma, Melco, SWF, Happy, ZSK, Toyota, Janome MB-7, Brother, Baby Lock |
| .exp | Melco EXP | Read and write | No | Melco, Bernina |
| .jef | Janome JEF | Read and write | Yes | Janome, Elna (some) |
| .vp3 | Pfaff/Viking VP3 | Read and write | Yes | Pfaff, Husqvarna Viking |
| .xxx | Singer XXX | Read and write | Yes | Singer, Compucon |
| .u01 | Barudan U01 | Read and write | No | Barudan |
| .hus | Husqvarna Viking HUS | Read and write | Yes | Husqvarna Viking |
| .vip | Pfaff/Viking VIP | Read and write | Yes | Husqvarna Viking, Pfaff |
| .tbf | Tajima TBF | Read and write | Yes | Tajima |
| .gcode | G-code (stitch path) | Write only | No | CNC and plotter tools |

**Keeps thread colours** matters when you send a file. Formats without colours still sew in the right order. They just show you "colour 1, colour 2" instead of real thread names. See [Choosing a format](export-formats.md).

## Machine compatibility

The research behind Lilo covers 17 brands, 66 machines and 44 thread brands. No machine has been tested on real hardware beyond one pending Brother run, so treat every machine as "should work" until you have sewn one design. The full tables are in compatibility.md in the docs folder.
