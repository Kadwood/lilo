# Built-in embroidery fonts

Everything else in this folder is **generated and git-ignored**. Run `pnpm fonts` (it is also run
automatically before `dev`, `build` and `test`, and in CI). It downloads
[inkstitch/embroidery-fonts](https://github.com/inkstitch/embroidery-fonts) at a pinned commit
(SHA-256 verified), keeps only open-licence fonts and writes `<id>/{font.json,LICENSE,preview.png}`
plus `index.json`. It re-runs only when the pinned commit or the converter changes (`.stamp.json`).

See `scripts/import-fonts.mjs` and the font section of `NOTICE.md`.
