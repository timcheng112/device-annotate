# Reviewed rendering references

The nine PNGs in `approved/` were visually inspected by the implementation agent on 2026-10-18, after opening the candidate gallery in cmux.
They are neutral fixtures, with no employer-app captures or snapshots.
The native inputs reuse the committed M0 iOS and Android captures.
Synthetic inputs are stored under `test/fixtures/render/` and are reproducible with `scripts/create-render-fixtures.mjs`.

The visual review checked native label readability, region colors and white halos, solid/dashed/dotted borders, mixed INFO/PASS/FAIL tags, arrows, opaque hatched masks, tiny masks identified in the legend, crop projection, detail views, long tags, XML-sensitive text, English-first Unicode escapes, and explicit ERROR rows.
The detailed evidence and measured limitations are recorded in [M4-RENDERING.md](../../docs/M4-RENDERING.md).
This is agent visual review; no separate user sign-off is claimed.

## Reproduction

Use Node 22.12 or newer and install the locked dependencies.
Run the full checks or just the pixel comparisons:

```sh
npm run check
npm run test:golden
```

Golden tests decode both PNGs and compare their complete RGBA pixel buffers and dimensions exactly.
They do not accept a perceptual threshold and do not update references during tests.
Font bytes, PNG codec, glyph parser, and WASM renderer are pinned.

Generate a separate candidate gallery:

```sh
npm run build
node scripts/render-goldens.mjs /tmp/device-proof-m4-review
cmux browser open file:///tmp/device-proof-m4-review/index.html --focus true
```

Inspect every changed candidate before copying its PNG into `approved/`.
The generator refuses the approved directory as its destination.
Changes to fixture inputs or the renderer require renewed visual review before replacing an accepted reference.
SVGs remain local review artifacts; production evidence output is PNG.
