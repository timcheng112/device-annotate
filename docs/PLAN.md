# device-proof: implementation plan

Status: M0 complete following approval of T31; M1 contract review is in progress, with the verification-flow boundary approved in T32.
See [CAPTURE-SPIKE.md](CAPTURE-SPIKE.md) for evidence, reproducible commands, and remaining contract work assigned to M1.
The settled product and technical decisions remain in [REQUIREMENTS.md](REQUIREMENTS.md) and [DESIGN.md](DESIGN.md).
This plan records the agreed behavior, implementation order, deliverables, and verification gates.
Runtime findings and remaining contract details are assigned to M0 and M1; they must be resolved before dependent implementation rather than assumed to be settled.

## Agreed planning decisions

### P1. Verify capture before building the annotation pipeline

Agreed on 2026-10-14.
The first milestone uses a neutral fixture app to verify capture on both iOS and Android before building the annotation pipeline.
It verifies Android pixel mapping, iOS native density, session sharing, and the daemon-version safeguard.
Results determine whether the existing design can be implemented as written or whether a specific blocker needs discussion.

### P2. Standalone absence checks

Agreed on 2026-10-14 and recorded as T19 in [DESIGN.md](DESIGN.md).
Allow standalone checks in a step and show successful absence checks in the legend without on-screen markers.
Annotations continue to require drawable targets.
M1 must define the spec and manifest representation, and M2 through M4 must verify the distinction between a passing absence check and an annotation-target error.

### P3. Separate nearby target badges

Agreed on 2026-10-14 and recorded as T20 in [DESIGN.md](DESIGN.md).
Place nearby targets' badges on separate outer edges without moving their target bounds.
T22 defines the approved color and identical-bounds treatment.

### P4. Detail views for dense overlap

Agreed on 2026-10-14 and recorded as T21 in [DESIGN.md](DESIGN.md).
Use a numbered overview plus individual detail views from the same capture, within one evidence image, for dense overlap.
The user also agreed to the threshold of three or more distinct targets in a connected overlap group, detailed in T21.

### P5. Region colors and grouped tags with individual results

Agreed on 2026-10-14 and recorded as T22 in [DESIGN.md](DESIGN.md).
Use region identity colors, result symbols, explicit legend outcomes, and solid/dashed result borders.
Identical bounds share one outline and one tag listing each number with its individual result symbol.
Keep separate legend entries and check results, including for mixed passing and failing checks.
M3 and M4 must cover grouping, mixed results, and long tags in layout tests and reviewed golden images.

### P6. Required criterion for one-off captures

Agreed on 2026-10-14 and recorded as T23 in [DESIGN.md](DESIGN.md).
Require `--criterion` for one-off captures and reject missing or blank criteria before contacting the device.
M1 verifies this offline validation behavior, and M6 uses the required flag in all one-off help examples.

### P7. Legend-only hidden checks when appropriate

Agreed on 2026-10-14 and recorded as T24 in [DESIGN.md](DESIGN.md).
Show a successful standalone `hidden` check only in the legend when there is no visible target to mark.
M2 through M4 must distinguish that success from an explicit annotation's missing-target error while retaining upstream check semantics.

### P8. Explicit informational annotations

Agreed on 2026-10-14 and recorded as T25 in [DESIGN.md](DESIGN.md).
Annotations without assertions use number-only tags and INFO legend rows; regions with no checks use dotted outlines.
Mixed regions retain individual result symbols and the agreed solid/all-pass or dashed/any-failure border rule.
M3 and M4 must test informational-only and mixed regions without manufacturing passing check results for INFO entries.

### P9. Explicit check counts

Agreed on 2026-10-14 and recorded as T26 in [DESIGN.md](DESIGN.md).
Report total evaluated, passed, and failed checks, excluding informational annotations and checks that have not run.
Preserve the agreed result precedence and exit codes while making zero-check captures distinguishable from captures with passing checks.
M2 must verify per-step and aggregate counts, including replacement of prior step results.

### P10. Reuse unaffected evidence after spec edits

Agreed on 2026-10-14 and recorded as T27 in [DESIGN.md](DESIGN.md).
Keep unaffected step evidence, invalidate steps affected by semantic spec changes, and mark newly added steps incomplete.
Formatting-only changes preserve results.
Changed app builds require fresh evidence for the affected verification flow.
M0 investigates build identity, M1 defines effective step configuration, M2 tests reconciliation, and M5 integrates provenance checks before reuse.

### P11. Require a compatible environment for reuse

Agreed on 2026-10-14 and recorded as T28 in [DESIGN.md](DESIGN.md).
Changing device/platform, OS, display configuration, or either tool version requires fresh captures for the run.
Ordinary app navigation between steps preserves reuse eligibility.
M0 identifies the necessary runtime metadata, and M2/M5 verify compatibility checks and stale-result exclusion.

### P12. Bounded history and explicit finished-run cleanup

Agreed on 2026-10-14 and recorded as T29 in [DESIGN.md](DESIGN.md).
Keep at most three previous attempts per step, expire history after seven elapsed days, and cap history at 500 MB per output folder; make these limits configurable.
Protect current evidence from automatic pruning and leave referenced external recordings alone.
Run pruning after safely saving a capture and through the cleanup command; provide a preview before applying explicit finished-run deletion.
M1 defines retention configuration, M2 tests eligibility as pure logic, M5 implements safe archival and cleanup, and M6 documents the lifecycle.

### P13. Fail immediately when an evidence folder is busy

Agreed on 2026-10-14 and recorded as T30 in [DESIGN.md](DESIGN.md).
Allow only one capture or cleanup command at a time per output folder.
A concurrent command returns a clear busy error without waiting, capturing, or modifying the active command's evidence.
M5 must verify exclusive access, error reporting, and interruption recovery.

## Build order

1. M0: verify the capture assumptions on both platforms.
2. M1: define the complete spec contract and implement offline validation.
3. M2: resolve selectors, evaluate checks, and calculate manifest outcomes.
4. M3: calculate annotation geometry and legend layout.
5. M4: render deterministic images and establish reviewed golden images.
6. M5: integrate capture, artifact writing, and the public interfaces.
7. M6: finish CLI help, the agent skill, packaging, and release verification.

Each milestone must satisfy its verification criteria before its dependent work is considered complete.
M0 is the first delivery: reproducible neutral captures and documented compatibility findings on both platforms.
The application-driving fixture harness may use agent-device; device-proof's production code continues to capture and verify only.

| Milestone | Reviewable deliverable |
|---|---|
| M0 | Neutral fixture app and capture pairs, coordinate overlays, reproducible spike scripts, and `docs/CAPTURE-SPIKE.md` with verified versions and findings |
| M1 | Contract examples, reviewed spec/manifest/error shapes, zod schema, generated JSON Schema, and offline `validate()`/CLI |
| M2 | Pure selector/check/outcome/reuse/retention modules with upstream parity and behavioral tests |
| M3 | Deterministic layout data and layout tests covering the accepted visual rules |
| M4 | Production SVG/WASM rendering, reviewed neutral golden images, and recorded performance measurements |
| M5 | Working capture and cleanup commands, safe persistence and history, and iOS/Android end-to-end CI definitions and results |
| M6 | Complete CLI help, agent skill, local package smoke-test evidence, and release-readiness notes |

## M0. Capture compatibility and neutral fixtures

Runtime evidence is recorded in [CAPTURE-SPIKE.md](CAPTURE-SPIKE.md), with the [coordinate preview](prototypes/capture-spike/index.html) shown in cmux.
Native geometry, implicit/named sessions, and a real daemon-version mismatch have been exercised on both target platforms where applicable.
The user approved the edge-uncertainty warning on 2026-10-15, recorded as T31 in [DESIGN.md](DESIGN.md), resolving the partial-visibility gate.
M0 is complete within its documented platform and environment limits.
M1 contract review is in progress; T32 defines one verification flow per spec with a shared app-build identity.

### Work

- Establish a neutral fixture app with stable identifiers, known geometry, and reproducible data.
- Inspect the installed agent-device version and its corresponding source before relying on the findings recorded at commit `3d48bb99`.
- Install and configure agent-device following that version's README when beginning this milestone.
- Capture a snapshot and screenshot on an Android emulator and an iOS simulator.
- Verify coordinate mapping with elements near screen edges and the system bars, plus partially off-screen elements.
- Verify iOS screenshot dimensions and rect projection at native density.
- Verify implicit session attachment using the same working directory and platform as the CLI, plus explicit named sessions.
- Find and verify a way to inspect the running daemon's version before any client call that could replace it.
- Exercise a version mismatch with a disposable session and confirm that refusal preserves the existing daemon and session.
- Record the exact dependency versions, device configuration, observations, and any remaining limitations.
- Inspect available app/build identity metadata and establish what additional caller-supplied provenance, if any, is needed to support T27 safely.
- Verify metadata for device identity, OS, display configuration, and tool versions needed for T28's environment compatibility rule.

### Verification and exit criteria

- Keep neutral capture pairs with provenance suitable for committed test fixtures.
- Show a rendered coordinate overlay on each platform and verify its alignment against the fixture app's known geometry.
- Demonstrate that capture reads the app session the agent has already opened.
- Demonstrate the daemon-version safeguard without disturbing the user's active sessions.
- Identify whether the public capture response supplies all metadata needed for stability checks and the manifest.
- Treat a failed foundational assumption as a blocker requiring an explicit resolution before proceeding with dependent code.
- Record reproducible commands and supported versus unverified behaviors in `docs/CAPTURE-SPIKE.md`; source inspection alone does not satisfy runtime verification.

Employer-app captures and snapshots remain ignored and must never become committed fixtures.
The existing prototype is a visual reference only; its hard-coded targets and estimated text widths are not implementation foundations.

## M1. Spec contract and offline validation

Contract review has established the verification-flow boundary in [DESIGN.md, T32](DESIGN.md#t32-one-verification-flow-per-spec).
Provenance fields and missing-identity behavior remain unresolved; the production package and schema have not been implemented.

### Work

- Establish the TypeScript package, test commands, and the module boundaries in T17.
- Define the zod schema for criteria, unique step names, all annotation primitives, checks, crop settings, and output configuration.
- Define retention configuration and managed attempt metadata, including capture times, current/history status, artifact ownership, and artifact references needed for safe cleanup.
- Define manifest and CLI error representations for failures before a screenshot, snapshot, device description, or valid step is available; never claim a missing artifact exists.
- Resolve outstanding spec details through review before treating the schema as stable.
- Generate the JSON Schema from zod, keeping generated files under script control.
- Implement YAML loading and actionable validation errors with field locations.
- Normalize file-based and one-off inputs into the same internal representation.
- Define normalized effective step configuration, including its criterion and inherited settings, so reconciliation distinguishes semantic edits from formatting-only changes.
- Require a non-empty `--criterion` for one-off captures and preserve the supplied wording.
- Expose offline `validate()` and `device-proof validate` without loading or contacting the device client.

### Verification and exit criteria

- Unit tests cover valid examples, malformed YAML, unknown fields, missing criteria, duplicate step names, unsupported predicates, invalid annotation combinations, and attempts to specify actions.
- Verify that zod validation and generated JSON Schema agree on representative valid and invalid documents.
- Verify that validation works with no running daemon or device.
- Verify that one-off captures with missing or blank criteria fail before any device-client call and that supplied criterion text is preserved.
- Validate the examples that will later ship in CLI help.

## M2. Resolution, checks, and outcomes

### Work

- Vendor the agreed predicate, visibility, absence, and React Native merge code from the verified upstream version, with its license, source headers, and matching upstream tests.
- Add the vendor comparison script from T1.
- Reuse the public selector functions over the supplied snapshot.
- Map rects into screenshot pixels and classify fully and partially off-screen targets.
- Produce actionable candidate diagnostics for unresolved or ambiguous targets.
- Evaluate checks against the supplied capture snapshot without triggering another device capture.
- Implement pure manifest updates and result aggregation; keep filesystem operations in `capture/` or `cli/` as required by T17.
- Compute step, criterion, and manifest check counts from recorded pass/fail results, excluding INFO entries and uncaptured checks.
- Reconcile existing evidence against the current spec, retaining unaffected steps and marking affected or newly added steps incomplete according to T27.
- Compute history cleanup eligibility from capture timestamps, configured count/age/size limits, and protected artifact references without filesystem side effects.

### Verification and exit criteria

- Run the vendored upstream parity tests.
- Unit tests cover zero, one, and multiple matches; React Native duplicate reporting; off-screen targets; and iOS and Android coordinate transforms.
- Verify T31's warning for edge-touching targets with unknown original bounds, including intentionally edge-aligned targets, without changing assertion results or manufacturing an evidence error.
- Unit tests cover every supported predicate and the upstream restrictions on proving absence from incomplete snapshots.
- Verify expected and actual values for failed checks.
- Test aggregate precedence: error, failed, incomplete, then passed.
- Test that an uncaptured step remains incomplete and that replacing one step's result preserves other steps.
- Test zero checks, all-pass and mixed results, INFO exclusion, uncaptured steps, and recapture replacement without double counting.
- Test selector/check/annotation edits affecting one step, criterion and shared-setting changes affecting dependent steps, new steps, and formatting-only edits.
- Verify that invalidated passes and their check counts cannot contribute to current outcomes, and that reused evidence retains its original capture time and provenance.
- Test that device/platform, OS, display-configuration, and tool-version changes invalidate old results, while ordinary navigation does not.
- Use a controlled clock to test just before and at the seven-day boundary, as well as count and size limits, oldest-first pruning, current-attempt protection, and INFO/error attempt history.

## M3. Pure layout

### Work

- Bundle the Inter font with its required license and measure text using its glyph metrics.
- Implement deterministic numbered markers, region colors, boxes, arrows, masks, crop projection, and the legend panel according to T11 and T19-T25.
- Group identical bounds for drawing, preserving per-check results, and apply the agreed dense-overlap fallback.
- Wrap criteria, annotation text, and expected and actual values without truncating evidence.
- Define deterministic collision handling, edge placement, padding, and contrast treatment.
- Keep layout independent of devices and file writes.

### Verification and exit criteria

- Unit tests cover marker numbering, collision handling, long criteria, multiline text, and viewport edges.
- Test crop coordinate translation and padding, including partially off-screen targets.
- Test that legend text stays outside the app image and that mask geometry covers the intended region.
- Verify repeatable layout for identical inputs.
- Test overlap groups with containment, touching edges, transitive chains, repeated checks on one target, and distinct targets with identical bounds.
- Test grouped tags with all-pass and mixed results, separate legend entries, and long lists that wrap or move without losing numbers.
- Test INFO-only regions and tags combining INFO, passing checks, and failing checks; verify that INFO entries never acquire a checkmark or a passing assertion result.

## M4. Rendering and reviewed golden images

### Work

- Build SVG from the screenshot and calculated layout, then rasterize with `@resvg/resvg-wasm` and the bundled font.
- Escape all user and snapshot text when embedding it in SVG.
- Render each supported primitive, region color, result symbol and border style, expected/actual failure row, and the hatched mask labelled "masked".
- Create reference images from neutral captures and review them visually before accepting them as golden images.

### Verification and exit criteria

- Compare rendered outputs pixel for pixel with reviewed golden images, as required by T10.
- Cover both platforms, dense annotations, long text, edge placement, masks, crops, and mixed passing and failing checks.
- Include text containing XML-sensitive characters to verify safe rendering.
- Include matching-color app backgrounds, grouped tags with mixed results, long tags, and dense-overlap detail views in the reviewed golden images.
- Confirm that tests use the bundled font rather than host fonts.
- Measure added processing time on representative captures against the less-than-one-second requirement, recording the environment and measurement boundary.

## M5. Capture and artifact integration

### Work

- Turn the verified capture spike into the production adapter with implicit and explicit session targeting.
- Enforce the daemon-version safeguard before the first potentially disruptive call.
- Implement stable wait, snapshot/screenshot/snapshot comparison ignoring refs, and bounded retries according to T8.
- Feed one accepted snapshot through resolution and checks, with the corresponding screenshot used for rendering.
- Write annotated images, raw images, snapshots, and the shared manifest according to T7 and T16.
- Preserve available raw evidence and structured diagnostics when evidence production fails.
- Make manifest writes resilient to interruption and define safe behavior when captures target the same output directory.
- Acquire exclusive access for capture and cleanup before device work or evidence mutation; return T30's busy error immediately to concurrent callers.
- Implement interruption recovery without treating a merely slow command as a dead owner.
- Preserve superseded attempts in managed history and prune only after the new attempt and manifest are safely saved, according to T29.
- Implement cleanup preview and explicit application, protecting current evidence during automatic pruning and excluding caller-owned recordings.
- Check app/build provenance before reusing evidence and apply the agreed affected-flow recapture rule when the build changes.
- Enforce T28's environment compatibility rule before accepting existing evidence into the current run.
- List caller-supplied local recordings without annotating them.
- Complete `capture()` and the capture CLI, JSON stdout, diagnostics, and exit codes.

### Verification and exit criteria

- Unit tests cover stable captures, irrelevant ref changes, meaningful snapshot changes, retries, and retry exhaustion.
- Integration tests with a controlled adapter cover capture failures, rendering failures, interrupted writes, manifest preservation, and version mismatch refusal.
- CLI tests verify per-step exit codes 0, 1, and 2 and machine-readable stdout.
- End-to-end tests drive the neutral fixture app with agent-device, then capture evidence on both platforms.
- Demonstrate a passing criterion, a real assertion failure, and an evidence error with their distinct artifacts and outcomes.
- Verify multi-step aggregation and replacement of a previously captured step.
- Verify that failed saves cannot trigger history pruning, referenced current artifacts remain intact, repeated cleanup is safe, and cleanup touches only eligible package-managed files.
- Test capture-versus-capture and capture-versus-cleanup contention, path aliases for the same folder, normal lock release, and recovery after an interrupted owner.
- Verify that a busy caller neither contacts the device nor overwrites the active command's manifest, and that it receives exit code 2 with a structured diagnosis.
- Run iOS simulator tests on macOS CI and Android emulator tests in CI, as required by T10.

## M6. Help, skill, and package verification

### Work

- Write version-specific `device-proof help` covering the full spec, annotations, predicates, examples, and diagnostics.
- Use `skill-creator` when writing `skills/device-proof/SKILL.md`, following the scope and integrity rules in T18.
- Explain session selection, stale refs after capture, stable selectors, and adding `testID`s.
- Explain that masks affect the annotated image while raw screenshots and snapshots remain audit artifacts.
- Explain retention limits, stored capture times, cleanup on command execution, preview/apply behavior, and explicit cleanup of finished runs in help and the skill.
- Configure the agent-device peer dependency and package contents, including the font, WASM requirements, generated schema, and licenses.
- Exclude the skill, prototype inputs, and development fixtures from the npm package as appropriate to T18.
- Verify the packed artifact in an isolated local consumer.

### Verification and exit criteria

- Exercise help examples through validation and selected end-to-end scenarios.
- Verify CLI and Node API entry points from the packed artifact.
- Inspect package contents and ensure all runtime assets and required notices are present.
- Verify no telemetry or package-initiated network calls in the implemented workflow.
- Run the completed unit, golden-image, and platform end-to-end suites.
- Record remaining limitations and release evidence without overstating untested platform support.

## Remaining contract work and its gates

These tasks are part of the implementation sequence, not additional settled decisions.
Investigate runtime facts directly and review any resulting user-visible behavior choices before implementing the affected contract.

- M0: establish reliable app/build and environment identity metadata, and determine how an affected verification flow can be identified when runtime metadata is insufficient.
- M1, before freezing the schema: define exact annotation/check/crop/recording fields, check counts, grouped-number representation, provenance, and managed history records.
- M1, before implementing persistence: define partial and pre-capture error records, including optional artifact paths and unavailable device metadata.
- M1, before enabling reuse: specify step/criterion matching, removed and renamed steps, inherited settings, and caller-provided build provenance within the per-spec flow boundary approved in T32, including behavior when identity is unavailable.

## Completion criteria

- All v1 requirements and package behavior from T1-T32 are represented in the package, help, and skill where applicable.
- Unit and upstream parity tests pass; golden images are visually reviewed and pixel comparisons pass.
- End-to-end tests pass on both an iOS simulator and an Android emulator, with the exact versions and environment recorded.
- The added processing-time requirement is measured and met for representative inputs, including dense annotations, with capture time reported separately.
- A locally packed package works in an isolated consumer with its required runtime assets and licenses.
- No employer-app captures or snapshots enter fixtures, commits, or the package.
- Remaining limitations are explicit; publishing and external handoff remain separately authorized actions.

## Accepted visual references

The [nearby-target example](prototypes/annotation-overlap/nearby.png) demonstrates the badge placement agreed in T20.
The [dense-overlap example](prototypes/annotation-overlap/dense.png) demonstrates the overview and individual detail views agreed in T21; its old outcome colors are superseded by T22.
The [grouped-tag example](prototypes/annotation-overlap/grouped.png) demonstrates the region colors, shared outline, individual result symbols, and separate legend entries agreed in T22.
The [informational annotation example](prototypes/annotation-overlap/info.png) demonstrates the INFO-only and mixed regions agreed in T25.
Earlier comparison images remain exploratory references, not the current specification.
These illustrations use synthetic UI and local AppKit drawing scripts; they do not validate the production font, renderer, collision algorithm, or platform coordinate mapping.

## External actions

Upstream issue drafts and vendor-export proposals may be prepared locally.
Posting issues, opening pull requests, pushing, and publishing each require the user's explicit go-ahead.
The day-one upstream issue remains unposted.
