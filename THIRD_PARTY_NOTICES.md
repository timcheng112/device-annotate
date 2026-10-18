# Third-party notices

The package's original code is MIT licensed; see [LICENSE](LICENSE).

## Bundled material

- Vendored agent-device 0.21.27 code is Copyright (c) 2026 Callstack, MIT licensed.
  The complete license, pinned revision, and source/adaptation hashes ship in `src/vendor/agent-device/`.
- Inter Regular is bundled unchanged from Inter 4.1 under the SIL Open Font License 1.1.
  Its license, attribution, and provenance ship in `src/render/fonts/LICENSE.txt` and `src/render/fonts/README.md`.

## Installed runtime dependencies

Dependencies are installed separately by npm and retain their own licenses and notices.

| Dependency | Version | Declared license |
|---|---|---|
| agent-device (peer) | 0.21.27 | MIT |
| @resvg/resvg-wasm | 2.6.2 | MPL-2.0 |
| opentype.js | 1.3.4 | MIT |
| pngjs | 7.0.0 | MIT |
| yaml | 2.9.0 | ISC |
| zod | 4.6.7 | MIT |

The unmodified resvg WASM binary is provided by `@resvg/resvg-wasm`, loaded from its local installed package.
Its source is maintained at https://github.com/yisibl/resvg-js/tree/v2.6.2 and its license is Mozilla Public License 2.0 at https://www.mozilla.org/en-US/MPL/2.0/.
This package does not embed or modify the dependency's WASM binary.
No font or WASM download occurs during capture.
