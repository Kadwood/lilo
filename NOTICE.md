# Third-party notices

Lilo is GPL-3.0 (see [LICENSE](LICENSE)). It includes or depends on the following.

## Ember Bridge (MIT)

`app/src-tauri/` (the Rust shell) and `editor/src/link/` (the "Lilo Link" UI) are forked from
[Ember Bridge](https://github.com/EmberSoftwareInc/ember-bridge).

- Upstream commit: `01b30d54e6226c28e9404742b0858ec1f209166a`
- Changes: renamed to Lilo; Ember cloud, auto-update and release-channel code removed; local API
  port moved to 17841; origin allow-list tightened. See `docs/` and git history.

```
MIT License

Copyright (c) 2026 EmberSoftwareInc and contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## stitchjs (MIT)

`@stitchables/stitchjs` 1.0.37 (https://github.com/stitchables/stitchjs), used by `engine/`.
Licensed MIT per its package.json; the upstream repository ships no LICENSE file and names no
copyright holder, so the standard MIT text is reproduced with the authors credited generically.
Main authors per GitHub: Matthew Jacobson, Cory Ortega.

```
MIT License

Copyright (c) the stitchjs authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## vtracer (MIT)

TODO: not yet used (planned for raster-to-vector tracing). Add licence text when added.

## Ink/Stitch (GPL-3.0)

TODO: not yet used (planned for thread palettes and lettering fonts). Add attribution and per-font
licences (OFL / public domain / CC-BY) when data is imported.
