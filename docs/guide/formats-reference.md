---
id: "formats-reference"
title: "File formats"
summary: "The 8 embroidery file formats Lilo reads and writes, and which machines use each one."
section: "reference"
order: 20
keywords: ["format","pes","dst","exp","jef","vp3","xxx","u01","pec","brand","machine","compatibility"]
appContext: ["dialog.export","view.converter"]
status: "generated"
---

# File formats

Lilo reads and writes 8 embroidery formats. The list is built from the app's own format table.

A format is the file type your machine understands. Brother and Baby Lock machines use **PES**. Most commercial machines use **DST**. If you are not sure, check your machine manual or the type of file it already sews.

| Extension | Name | Keeps thread colours? | Used by |
| --- | --- | --- | --- |
| .pes | Brother PES | Yes | See your machine manual |
| .pec | Brother PEC | Yes | See your machine manual |
| .dst | Tajima DST | No | See your machine manual |
| .exp | Melco EXP | No | See your machine manual |
| .jef | Janome JEF | Yes | See your machine manual |
| .vp3 | Pfaff/Viking VP3 | Yes | See your machine manual |
| .xxx | Singer XXX | Yes | See your machine manual |
| .u01 | Barudan U01 | No | See your machine manual |

**Keeps thread colours** matters when you send a file. Formats without colours still sew in the right order. They just show you "colour 1, colour 2" instead of real thread names. See [Choosing a format](export-formats.md).

## Machine compatibility

Wi-Fi sending works with Brother and Baby Lock machines that have built-in Wi-Fi. Every other machine uses a file on a USB stick. Read [Send over Wi-Fi](lilo-link-wifi.md) and [USB stick](usb-stick.md).
