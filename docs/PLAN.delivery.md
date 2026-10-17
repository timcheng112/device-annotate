# M3 delivery

M3 implements pure annotation and legend layout under [PLAN.md](PLAN.md) and [DESIGN.md](DESIGN.md).
Current phase: complete, with implementation and verification finished.
M0, M1, and M2 remain complete; M2 evidence is preserved in PLAN.md.

Worktree: `/Users/timcheng112/Downloads/device-proof`.
Branch: `plan/implementation`.
M3 starts after `56d0b10`, the completed M2 implementation.
Local commits are authorized.
No push, publication, PR, or external communication has occurred.

## Implementation

The layout boundary consumes the effective step, criterion, accepted M2 checks/errors/geometry, and parsed bundled font metrics.
It validates the records before producing image eligibility or layout data.
It preserves shared numbering, per-entry outcomes, grouped region identity, crop translation, clipping warnings, and explicit error rows.
Connected overlap groups count distinct target identities and add individual detail views only at the approved three-target threshold.
Every view carries all intersecting masks, including masks belonging to other targets.
The legend follows all image views.
Tags use deterministic outer-edge candidates and a growing external margin when those candidates collide.
Text uses bundled glyph advances and returns explicit glyph positions without host-font dependencies.

Inter Regular is copied unchanged from the official 4.1 release, with its license and hashes under `src/render/fonts/`.
`opentype.js` 1.3.4 is pinned in the package lock.
The shell's default Node installation has a missing ICU library; use the installed Node 24.21.0 for checks:

```sh
export PATH=/Users/timcheng112/.volta/tools/image/node/24.21.0/bin:$PATH
npm run check
```

## Verification

Focused tests exercise grouping, INFO/check/error presentation, omission policy, crop translation, clipping, mask propagation, overlap identities, tag collisions, long text, glyph metrics, and repeatability without input mutation.
`npm run check` passes type checking, 661 tests, all 18 generated-schema checks, and 22 vendor source/license/test hash checks.
The 22 new layout tests include all three neutral M0 capture fixtures, tiny crops at all four corners, and drawable masks with unavailable assertions.
`git diff --check` passes.
On 2026-10-18, the user confirmed the English-first scope and accepted keeping Inter without additional fallback fonts.
Characters absent from Inter use readable Unicode escapes, while original source text remains preserved.
T17 records this accepted scope.
The local delivery commit is titled `Implement M3 deterministic annotation and legend layout`.
Production rendering, visual QA, golden images, and device sessions remain later milestones.

## Next safe action

Continue M4 from [PLAN.md](PLAN.md#m4-rendering-and-reviewed-golden-images): render the layout using the bundled font, establish reviewed neutral golden images, and measure rendering performance.
Use the explicit glyph positions and apply every view's complete mask list before publishing an image.
No blockers are known.
