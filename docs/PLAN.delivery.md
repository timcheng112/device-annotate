# M4 delivery

M4 implements deterministic SVG/WASM rendering, reviewed neutral golden images, and processing-time measurements under [PLAN.md](PLAN.md).
Current phase: complete, with implementation, visual review, golden comparisons, and performance verification finished.
M0 through M3 are complete; M3 was committed as `18e11da`.

Worktree: `/Users/timcheng112/Downloads/device-proof`.
Branch: `plan/implementation`.
Local commits are authorized.
No push, publication, PR, or external communication has occurred.

## Implementation and findings

The renderer accepts font/WASM bytes and the accepted evidence, and performs no filesystem or device IO.
It decodes and validates the screenshot, masks source pixels before any composition, generates SVG with bundled glyph paths, and rasterizes through pinned `@resvg/resvg-wasm` 2.6.2.
PNG decoding/encoding uses pinned `pngjs` 7.0.0.
All raster objects are freed after use, including failure paths.

Nine candidate cases cover both native platforms, all primitives, dense overlap, long tags, partial errors, cropped masks, matching-color backgrounds, and absence-only evidence.
Candidates are generated separately from accepted golden images.
Initial visual inspection found unsupported fractional HSL colors and undersized labels on native-density captures.
The implementation now emits explicit RGB colors with measured white-text contrast and scales typography with screenshot width.
All nine corrected candidates were visually inspected by the implementation agent and accepted as golden references.
`npm run check` passes 679 tests, all 18 schema checks, and 22 vendor hash checks.
The measured pipeline stayed below one second: the slowest sample was 767 ms, with initialization measured separately at 35 ms.
[Rendering evidence](M4-RENDERING.md) records the exact boundary, environment, samples, review coverage, and limitations.
The local delivery commit is titled `Implement M4 deterministic rendering and reviewed golden images`.

## Next safe action

Continue M5 from [PLAN.md](PLAN.md#m5-capture-and-artifact-integration): integrate stable accepted captures, runtime asset loading, rendering, and safe artifact/manifest persistence.
Preserve the daemon safeguard, environment/build provenance, ownership/locking, immutable attempts, and mask-failure publication rules.
Recheck any simulator, emulator, and daemon state before live work.
No blockers are known.
