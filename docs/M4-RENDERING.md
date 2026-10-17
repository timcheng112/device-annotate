# M4 rendering evidence

M4 implements deterministic SVG generation and WASM rasterization from accepted capture evidence.
The implementation and nine golden references were verified on 2026-10-18.
Live capture, atomic persistence, history updates, and CLI integration remain M5 work.

## Renderer boundary

`src/render/evidence.ts` accepts the effective step, criterion, M2 checks/errors/geometry, and screenshot bytes.
Initialization receives the bundled Inter font and pinned WASM bytes from the caller.
The renderer performs no filesystem or device IO.
It returns a complete PNG with its layout/SVG, returns an explicit omission policy, or throws before returning any intermediate image.

The source PNG is decoded with CRC checking and compared against accepted dimensions.
Requested masks replace source pixels with an opaque fill before the source is embedded in SVG.
Fractional mask bounds round outward to cover all touched pixels, and all detail views use that prepared source.
Hatching and the fixed `masked` label are then added to each applicable view.
When a mask is too small for its label, the full mask remains opaque and its legend row carries the label.
The retained raw capture remains a separate audit artifact under the existing contract.

Text uses exact bundled Inter glyph outlines and M3 positions; resvg also receives the bundled font through `fontBuffers`.
Titles escape XML-sensitive text, and screenshot references use an in-memory PNG data URI.
The renderer never asks host fonts to shape or substitute glyphs.
Resvg renderer and raster objects are freed on success and failure paths.
The output PNG is copied out of WASM memory before its raster object is freed.

## Visual review

The implementation agent visually inspected all nine corrected PNGs before copying them into `test/golden/approved/`.
A candidate gallery was opened in cmux, and direct PNG inspection covered full images and their legends.
Later cmux automation handles became unavailable, so final visual inspection used the PNG files directly.
No separate user approval or cross-platform rendering run is claimed.

The first review found two issues and led to fixes before acceptance:

- Fractional HSL color strings were rejected by the renderer, producing black tags and missing colored strokes.
  Colors now use explicit RGB hex values and retain at least 4.5:1 contrast against white tag text.
- Fixed 16-pixel labels were too small beside native-resolution captures.
  Typography, strokes, padding, and spacing now scale by `max(1, round(screenshot.width / 400))`, while screenshot pixels remain at 1:1 scale.

| Reviewed reference | Coverage |
|---|---|
| [iOS native](../test/golden/approved/ios-native.png) | Native M0 screenshot, readable labels, arrow, mask, uncertain clipping warning |
| [Android native](../test/golden/approved/android-native.png) | Native M0 screenshot, edge placement, mask, arrow, full-frame projection |
| [Mixed primitives](../test/golden/approved/primitives-mixed.png) | Box, marker, arrow, callout, mask, INFO/PASS/FAIL, grouped results, XML-sensitive text |
| [Dense overlap](../test/golden/approved/dense-masked.png) | Nested overlap, five distinct targets, one overview and five detail views, masks carried across views |
| [Long tags](../test/golden/approved/long-tags.png) | Thirty-three entry numbers, wrapped grouped tag, complete long criterion/legend, explicit Unicode escapes |
| [Partial error](../test/golden/approved/partial-error.png) | ERROR badge, unresolved entry without marker, completed passing/failing checks, absence row |
| [Crop and edges](../test/golden/approved/crop-edge.png) | Zero padding, proven clipping, fractional mask bounds, tiny mask, crop warning |
| [Matching colors](../test/golden/approved/contrast.png) | White halos against matching-color UI, INFO mixed with PASS/FAIL, distinct outer tags |
| [Legend only](../test/golden/approved/legend-only.png) | Passing absence check with no marker |

All synthetic input PNGs and snapshot/spec data are committed under `test/fixtures/render/`.
The two native cases reference the already committed neutral M0 captures.
No employer-app images or snapshots enter these inputs or references.

## Automated verification

`npm run check` passes type checking and 679 tests, including nine new renderer tests and nine exact golden pixel comparisons.
It also passes all 18 generated-schema freshness checks and 22 vendor hash checks.
Golden tests compare dimensions and every decoded RGBA pixel, with no tolerance and no automatic reference updates.

Renderer tests verify actual region colors in output pixels, unchanged screenshot pixels away from annotations, crop translation, opaque outward-rounded masks, masked source bytes across details, corrupted input rejection, inconsistent dimensions, unusable-mask omission, XML escaping, repeatability, input immutability, and white-text contrast.
Existing layout tests continue to cover identity grouping, entry errors, all corner placements, and the three neutral coordinate fixtures.

## Processing time

The reproducible command is `npm run benchmark:render`.
Raw samples and environment metadata are in [M4-performance.json](M4-performance.json).
The run used Node 24.21.0 on an Apple M2, macOS Darwin 23.6.0, arm64, with `@resvg/resvg-wasm` 2.6.2, `opentype.js` 1.3.4, and `pngjs` 7.0.0.

The measured interval includes in-memory snapshot evaluation, layout, PNG decoding, mask application, PNG source re-encoding, SVG generation, WASM rasterization, final PNG encoding, and output copying.
Asset/file reads and device capture are excluded.
Runtime/font initialization is measured separately at 34.6 ms.
Each case retains its first sample and five further samples; warm statistics use those five further samples.

| Case | Output pixels | First sample | Warm median | Warm maximum |
|---|---|---:|---:|---:|
| iOS native | 1302 × 3726 | 767.0 ms | 582.4 ms | 592.4 ms |
| Android native | 1176 × 3396 | 457.2 ms | 452.9 ms | 460.4 ms |
| Dense masked details | 565 × 2124 | 157.6 ms | 156.8 ms | 157.5 ms |
| Long tags and legend | 826 × 3824 | 136.0 ms | 126.5 ms | 131.3 ms |

All samples satisfy the less-than-one-second requirement for this measured boundary and environment.
Initialization plus the first iOS sample totals approximately 802 ms.
M5 must measure the integrated capture and persistence path separately; these results do not establish device-capture latency or arbitrary input-size performance.

## Reproduction and next step

```sh
npm run check
npm run benchmark:render
node scripts/render-goldens.mjs /tmp/device-proof-m4-review
cmux browser open file:///tmp/device-proof-m4-review/index.html --focus true
```

The candidate generator refuses the approved-golden directory as its output location.
Inspect changed candidates before promoting PNGs, then rerun golden comparisons.
M5 can now integrate this renderer with accepted capture evidence and safely publish only complete results.
