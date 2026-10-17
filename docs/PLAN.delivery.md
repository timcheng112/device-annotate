# M2 delivery

M2 implements pure resolution, checks, manifest reconciliation, and history eligibility under the approved contracts in [PLAN.md](PLAN.md) and [DESIGN.md](DESIGN.md).
Current phase: complete, with implementation and verification finished.
M0 and M1 remain complete.

Worktree: `/Users/timcheng112/Downloads/device-proof`.
Branch: `plan/implementation`.
M2 starts after commit `1e12eff`; the delivery commit is titled `Implement M2 resolution, checks, and evidence lifecycle`.
Local commits are authorized.
No external actions were requested or performed.

## Delivered behavior

The resolver uses public selector functions over one supplied snapshot and preserves upstream ambiguity, alternative, and duplicate-reporting behavior.
The check pipeline produces completed checks and entry errors independently, plus raw screenshot coordinates, crop geometry, groups, clipping warnings, and image eligibility.
Reconciliation preserves compatible original evidence, archives invalidated attempts, and excludes historical counts from current results.
History pruning returns a deterministic preview while protecting current evidence and caller-owned recordings by canonical file identity.
The filesystem adapter must supply verified sizes and identities; missing observations stop the preview.

The installed peer and local upstream source both identify agent-device 0.21.27, commit `50e45f11bc6d388d272e672771acc33d9e56921d`.
[Vendor notes](../src/vendor/agent-device/README.md) record the preserved source, extraction boundaries, matching tests, and comparison commands.

## Verification

`npm run check` passes type checking, 639 tests, all 18 generated-schema checks, and 22 vendor source/license/test hash checks.
The total includes 23 copied upstream parity tests.
`npm run compare:vendor` passes against the pinned local source.
Coordinate tests use the three committed neutral M0 capture pairs, including iOS compatibility scaling.
No new live capture, visual QA, or production rendering is claimed.

## Next safe action

Continue M3 from [PLAN.md](PLAN.md#m3-pure-layout): bundled font metrics, deterministic annotation placement, overlap/detail geometry, and legend layout.
M5 will integrate accepted captures and durable writes with these pure modules.
Call reconciliation before replacement, and apply a pruning preview only after the new files and manifest are safely saved under the output-folder lock.
Missing screenshot geometry is a capture-level failure; the pure resolver does not invent a viewport or start another capture.
No blockers are known.
