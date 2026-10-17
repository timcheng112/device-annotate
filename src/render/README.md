# Evidence renderer

`createEvidenceRenderer` initializes the pinned WASM runtime from supplied bytes and parses the supplied bundled Inter font.
The integration layer owns asset loading; this module performs no filesystem, network, or device IO.
WASM initialization is shared per process and failed initialization can be retried.
The returned synchronous `render` method accepts a screenshot, effective step, criterion, and accepted M2 evidence.
It recomputes validated layout, returning an omission policy or a complete PNG/SVG/layout result.
Failures throw without returning an intermediate image.
M5 must map those failures into evidence errors and publish only complete results.

Before composition, the PNG is decoded with CRC checking and its actual dimensions are compared with accepted geometry.
Every requested mask is applied opaquely to that source image, rounding fractional bounds outward to cover all touched pixels.
The image is re-encoded without original ancillary metadata.
Overview and detail views embed only this masked source; hatching and labels are added afterward.
Tiny masks retain opaque coverage and their fixed `masked` label appears in the legend when it cannot fit inside the region.
Raw capture artifacts remain the caller's separate audit inputs.

The SVG builder consumes the validated layout and prepared screenshot.
It uses explicit glyph outlines from the bundled Inter file at M3's measured positions, avoiding text shaping or host-font substitution.
The same font bytes are also supplied to resvg through `fontBuffers` under T4.
User/snapshot text appears only in escaped SVG titles and precomputed glyph outlines.
SVG references are local IDs or the in-memory PNG data URI.
This internal builder requires prepared pixels; callers should use the renderer boundary to enforce mask readiness.

All resvg renderer and raster objects are freed in `finally` blocks.
PNG output is copied before the WASM image is freed.
No native resvg bindings are used.
The pinned dependencies are `@resvg/resvg-wasm` 2.6.2 (MPL-2.0), `opentype.js` 1.3.4 (MIT), and `pngjs` 7.0.0 (MIT).
The bundled Inter license and hashes are under `fonts/`.
M6 owns final package-asset and license-notice verification.
