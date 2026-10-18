# M6 delivery

M5 integrates capture, rendering, durable artifacts, ownership, and cleanup under [PLAN.md](PLAN.md).
Current phase: M6 complete; M4 prototype-fidelity follow-through remains open.
M5 remains complete, with public capture/cleanup, native adapters, local verification, and hosted CI gates passing.
M0 through M4 are complete; M4 was committed as `12c12ab`.
Its rendering and performance evidence remains in [M4-RENDERING.md](M4-RENDERING.md).
M5 exposes public live capture and satisfies its local and hosted verification gates within the documented platform limitations.

Worktree: `/Users/timcheng112/Documents/repos/device-annotate`.
Branch: `plan/implementation`.
Local commits are authorized.
The user authorized creating the private GitHub repository, pushing this branch, and running hosted CI.
The private repository is https://github.com/timcheng112/device-annotate, configured as `origin`.
The initial push was rejected for missing OAuth `workflow` scope; the user completed the GitHub CLI permission refresh.
The authorized push succeeded, and `plan/implementation` tracks `origin/plan/implementation`.
The first hosted verification run is https://github.com/timcheng112/device-annotate/actions/runs/39090014690 at commit `91b3b79` passed the unit gate but failed both native setup paths before capture.
No PR or package publication occurred.
This continuation used only the dedicated neutral M0 simulator/emulator and a new isolated M5 daemon.
Hosted verification passed on GitHub Actions at implementation commit `4c49684`.

## Implemented foundation

`src/capture/stable.ts` performs stable wait followed by snapshot/screenshot/snapshot, with one initial attempt and up to three retries.
Comparison ignores node refs, ref generation, acquisition timestamps, and observation timing diagnostics while retaining other evidence-bearing fields.
Rejected observations never enter assertion evaluation, and failure records retain the latest available audit pair without mixing retries.

`src/capture/daemon.ts` passively verifies local installed-daemon metadata and injects a direct transport through the public agent-device client seam.
It supports the pinned socket and HTTP command protocols without calling upstream daemon startup, replacement, or recovery machinery.
Metadata is checked before dispatch and after the response; socket connection establishment also rechecks before writing.
Missing, invalid, changed, mismatched-version, and unsupported-origin metadata fail closed.
Credentials remain internal to the transport closure and are excluded from operational diagnostics.

`src/capture/lock.ts` canonicalizes output-folder aliases and admits one owner through atomic, immutable lock-generation symlinks.
Released or provably dead local PIDs can be superseded; live, foreign-host, and malformed owners cannot be evicted by elapsed time.
The append-only `.device-proof-lock` journal avoids stale-lock unlink races and partial owner-record publication.
It retains two small metadata entries per normally completed command; journal compaction is not implemented.
PID reuse conservatively reports busy rather than evicting a possibly live owner.

`src/capture/store.ts` validates ownership and ledger content, exclusively allocates UUID attempt directories, refuses managed-directory symlinks, and saves artifacts before returning their paths.
Files and directories are synchronized before manifest publication; the manifest uses a synchronized temporary file and atomic rename.
Invalid replacement manifests and ownership refusals preserve earlier manifest bytes.

`src/capture/execute.ts` integrates the controlled adapter, environment gate, reconciliation, real renderer, audit artifacts, error attempts, manifest replacement, and post-save pruning.
The device factory runs only after locking and ownership checks.
Rendering failures preserve completed assertions and raw evidence; mask omissions publish no annotated image path.
A newer error replaces an older pass while retaining the earlier immutable attempt in history.
The public API/CLI and local-device adapter are now connected to this integration seam.
Environment metadata is observed again after raw evidence is saved; changed metadata refuses evaluation and preserves the raw artifacts.

`src/capture/cleanup.ts` implements preview/apply, automatic history pruning, and explicit finished-run cleanup under the same folder lock.
Current evidence and caller-owned recordings are protected using device/inode identities, including hardlink aliases.
Symlinked managed paths and unavailable recording identities fail closed.
Interrupted deletion can resume when some eligible historical files are already absent.
Cleanup never recursively deletes arbitrary folder contents.

## Verification

The complete regression run passed all 719 tests, including 40 new tests and the existing golden-image comparisons.
After adding two more checks and making finished-run cleanup idempotent, the affected 14-test integration/cleanup suite also passed.
The repository now contains 42 new M5 tests.
Type checking, all 18 generated-schema freshness checks, and all 22 vendor hash checks pass.
These are the same gates as `npm run check`, executed separately after the combined command's approval review timed out.
Transport tests use temporary loopback mock servers and require sandbox escalation because sandboxed listeners return `EPERM`.
The retried full test run received approval and passed.
These counts describe the earlier foundation checkpoint.
The continuation results below supersede its lack of live-device verification.

## Approved capture-only contract refinement

Additional review of the pinned agent-device 0.21.27 source found that ordinary iOS snapshots can activate a background session app.
The runner's `prepareActivatedTarget` calls `activateTarget` when the target needs activation.
This conflicts with device-annotate's capture-only requirement if used without qualification.

The public snapshot API supports `observeOnly: true`.
Its runner path resolves the existing app without activation and refuses observations unless the app reports `runningForeground`; it also requires an already-ready compatible runner.
However, the T8-required `client.command.wait({ stable: true })` goes through `runStableCaptureLoop` and ordinary selector snapshots, and does not expose observe-only snapshot options.
The relevant upstream source paths are `src/commands/interaction/runtime/stable-capture.ts`, `src/commands/interaction/runtime/selector-read-shared.ts`, and `apple/runner/AgentDeviceRunner/AgentDeviceRunnerUITests/RunnerTests+CommandDispatch.swift` at the pinned revision.

The user approved replacing the iOS stable-wait call with a bounded quiet-period loop of observe-only snapshots on 2026-10-18.
[DESIGN.md T8](DESIGN.md#t8-stability-check) now records that refinement, including observe-only comparison snapshots and refusal without activation or fallback.
Android retains the approved upstream wait.
Proceed with dependent integration without asking again.
The earlier question about foreground preflight was superseded by discovery of the observe-only API.

## Public and native integration

`src/capture/device.ts` selects a unique session from cwd-scoped inventory, pins its daemon-provided address, and verifies its creation time and device around each operation.
Implicit iOS and Android sessions and explicit addresses share this selection boundary.
Every request uses the previously verified injected transport.
iOS uses only observe-only snapshots, verifies the returned observation contract, and uses a bounded 500 ms quiet period with a 60-second budget.
A refusal returns `IOS_OBSERVATION_UNAVAILABLE` without ordinary snapshot or stable-wait fallback.
Android retains upstream stable wait.
Screenshots disable stabilization and status-bar normalization; iOS requests observed native density.
Temporary screenshots are private local files and adapter cleanup never closes the caller's device session.

Native testing exposed Android `elapsedMs` and the response-level `unchanged` age summary as acquisition bookkeeping.
Stability ignores those fields and snapshot-quality timing, while retaining backend, coverage, truncation, geometry, labels, and unknown evidence-bearing fields.
Regression tests distinguish timing-only changes from changed capture quality.

`src/capture/environment.ts` uses bounded read-only native subprocesses, tied to the selected session's UDID, simulator set, or serial.
iOS identity includes host hardware identity, canonical simulator-set path, and UDID.
Android identity includes host identity, canonical AVD path, and Android ID, so an emulator port or reused AVD pathname alone cannot establish identity.
Android reads effective configuration for appearance and exact font scale, including an observed scale of 1 when the settings database contains no font-scale row.
Unknown or unsupported metadata retains one diagnostic per null field.
The collector supports a Linux host machine ID and Android SDK environment variables for CI.
Physical-device and remote-target metadata remain unverified; unsupported metadata does not establish compatibility.

On this host, `devicectl device info displays` returns CoreDevice error 1000 for the booted iOS simulator.
The collector uses supported JSON-file output with a bounded timeout and does not infer rotation from portrait-shaped pixels.
iOS display rotation and rotation-dependent pixel dimensions therefore remain unknown here.
Fresh iOS single-step evidence works; multi-step capture correctly refuses under T35.
Android's observed metadata is complete, and its live multi-step flow passes.
Custom simulator sets retain scoped simctl queries and identity, but the unscoped devicectl display probe is deliberately unavailable for those sets.

`src/capture/public.ts` implements `capture()` with spec ownership, caller-supplied build validation, recording readability checks, and structured errors.
The exported API stays lazy so offline validation never imports a device or process-launch client.
The CLI supports spec capture, one-off criterion/box capture, build JSON, platform/session selection, repeatable recording references, and cleanup preview/apply.
Both capture preflight and cleanup reject invalid inputs before device or artifact work.
The shared recording guard refuses direct, symlink, and hardlink aliases of `manifest.json` before replacement.

```sh
node bin/device-annotate.mjs capture path/to/spec.yaml --step sample --platform ios --build build.json
node bin/device-annotate.mjs capture --step control --criterion 'The expected control is visible' --box 'id="control"' --platform android --out evidence/control
node bin/device-annotate.mjs cleanup evidence/control
node bin/device-annotate.mjs cleanup evidence/control --apply
```

```js
import { capture, cleanup } from 'device-annotate';
const attempt = await capture({ specPath: '/absolute/spec.yaml', step: 'sample', platform: 'ios', build });
const preview = await cleanup({ outDir: '/absolute/evidence' });
```

## Continuation verification

The complete regression gate passes 736 tests, type checking, 18 generated-schema freshness checks, and 22 vendor hash checks.
The transport suite ran with sandbox escalation for its loopback listeners.
New coverage includes the quiet loop, session ambiguity, preflight's offline boundary, metadata failures, recording aliases, changed environments, and cleanup boolean validation.
A child-process interruption test stops publication immediately before atomic rename, kills the lock owner, verifies unchanged previous manifest bytes, and recovers the folder for another publication.

`test/e2e/native.mjs` runs the real CLI against a pre-opened neutral fixture on each platform.
Both platforms produced a passing assertion with exit 0, a deliberately false assertion with exit 1, and a missing-mask evidence error with exit 2.
Both error cases retained raw/snapshot artifacts and published no annotated image.
Android additionally passed live multi-step aggregation, recapture replacement, renamed-step archival, retained-step reuse, and artifact readability checks.
iOS passed the explicit unknown-environment multi-step refusal gate.
The native harness requires the installed neutral fixture to match the locally built fixture artifact used for its build identity.

`test/e2e/ios-refusal.mjs` stopped the dedicated neutral app, attempted capture, and verified `IOS_OBSERVATION_UNAVAILABLE`, no image/raw path, no app reactivation, and byte-identical daemon metadata.
It restored the neutral app after checking.
The production adapter performed no app activation.

Four native PASS/FAIL images were visually inspected for correct center-target anchoring, readable legends, result symbols, and solid/dashed outlines.
A fresh cmux preview opened the gallery, and all four images reported successful loading at their native output dimensions.
The local gallery and native reports are under ignored `scripts/m0/.local/m5-evidence/`.
No employer-app captures were used or committed.
After verification, the isolated M5 daemon stopped gracefully and released both neutral-device claims.
The dedicated M0 simulator and emulator were returned to their initial stopped state.
The local native evidence and cmux preview remain available.

`test/e2e/performance.mjs` measures the complete capture entry point minus adapter construction, metadata collection, stable observation, screenshot acquisition, and adapter resource cleanup.
The remainder includes validation, locking, rendering initialization, artifact synchronization, manifest replacement, and history pruning.
Four sequential samples per platform ran on this Apple M2 host with Node 24.21.0.
All measured added-processing samples were below one second.

| Platform | First processing/persistence | Subsequent range | Total capture range |
|---|---:|---:|---:|
| iOS | 929 ms | 704-744 ms | 3.72-4.09 s |
| Android | 744 ms | 537-591 ms | 1.46-1.76 s |

These measurements apply to the neutral center-box fixture and this host, not arbitrary spec sizes or all machines.
The JSON samples remain in the ignored native evidence folder, and the committed script reproduces the measurement boundary.

`.github/workflows/verify.yml` defines offline checks, a dedicated macOS iOS simulator job, and an Ubuntu Android emulator job.
Fixture setup and iOS runner preparation happen through the test harness before capture-only verification.
The fixture builder now supports the host simulator architecture and `JAVA_HOME` on Linux.
Runner selection follows [GitHub's runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), and Android setup follows the [emulator action's documentation](https://github.com/ReactiveCircus/android-emulator-runner/blob/main/README.md).
These workflow definitions were subsequently exercised on hosted CI; results and setup corrections are recorded below.

## Resumed local verification

Review of the native CI harness found that any missing Android environment metadata could select the refusal case and silently skip multi-step aggregation, replacement, and archival verification.
The harness now requires complete Android environment metadata for every pass/fail/error case.
iOS permits only the documented unknown active rotation and rotation-dependent pixel dimensions; unrelated missing metadata fails the native gate.
Four regression tests cover complete metadata, Android metadata loss, the known iOS limitation, and unrelated iOS metadata loss.
The tightened gate also accepts all six saved native pass/fail/error environment records from the preceding session.
That replay uses saved evidence and does not constitute a fresh native run.

`npm run check` passed after this change, including all 740 tests, type checking, 18 generated-schema freshness checks, and 22 vendor hash checks.
Loopback transport tests ran with sandbox escalation.
No simulator, emulator, or daemon was started during this continuation.
At this local-verification checkpoint, no hosted CI run or publication had occurred.
Current remote and authorization status is recorded above.

## Next safe action

The user selected `device-annotate` as the final library and CLI name on 2026-10-18.
Package metadata, imports, CLI entry points, diagnostics, documentation, and schema descriptions use the selected name.
The package lock and JSON Schemas are regenerated through their existing tools.
`npm run check` passes after the final rename: 740 tests, type checking, 18 generated-schema checks, and 22 vendor hash checks.
A direct npm registry check returned 404 for `device-annotate`; this does not reserve the name.
The checkout moved from `~/Downloads/device-proof` to `~/Documents/repos/device-annotate` at the user's request.
Neutral fixture identities, the existing `versions.deviceProof` evidence field, and the `.device-proof-lock` journal remain unchanged to preserve existing evidence and locking compatibility.
Recorded native fixture provenance retains its original capture-time workspace path; fresh native runs must prepare a session scoped to the new checkout path.

Continue with M6 help, skill, and package verification from [PLAN.md](PLAN.md#m6-help-skill-and-package-verification).
The private repository and implementation branch are published, and M5 hosted verification is complete.
Package publication and PR creation remain separate actions that have not been requested.
The iOS host limitation remains explicit: multi-step iOS evidence requires a toolchain/provider that can reliably expose active display rotation, or a separately verified read-only observation source.
Do not substitute configured orientation, screenshot aspect ratio, or a guessed default for that observation.
Keep T8's approved observe-only refusal behavior intact.
The [M5 exit criteria](PLAN.md#m5-capture-and-artifact-integration), including successful hosted iOS and Android CI runs, are now satisfied within these limits.

## First hosted CI corrections

The first run passed the complete offline checks on Ubuntu.
Android setup failed because `sdkmanager` was absent from `PATH`; the workflow now explicitly sets up Android command-line tools and the fixture SDK packages.
iOS setup failed because the pinned agent-device CLI accepts `prepare --timeout`, while the workflow used `--timeout-ms`; the command now matches the installed CLI help.
Both corrections concern test setup, and neither changes the capture-only adapter or environment admission gates.

The second hosted run, https://github.com/timcheng112/device-annotate/actions/runs/39090147160 at `10aec39`, passed all 740 tests and the iOS native suite, including capture-only refusal.
Android built the fixture but its emulator exited before boot: 3510 MB was available and the data partition required 7373 MB.
The workflow now removes unused .NET and Android NDK installations from the disposable Android runner before setup, reports available disk space, and bounds emulator boot to five minutes.
No local SDK installation is removed.

## Successful hosted verification and M5 completion

[Run 39090940944](https://github.com/timcheng112/device-annotate/actions/runs/39090940944) passed all three jobs at commit `4c49684` on 2026-10-18.
The Ubuntu unit job passes all 740 tests, type checking, 18 schema freshness checks, and 22 vendor hash checks.
The macOS iOS simulator job passes native pass/fail/error capture and the unavailable-foreground refusal test without app reactivation or daemon replacement.
The known missing iOS rotation and active pixel dimensions correctly produce the T35 multi-step refusal; hosted success does not establish iOS multi-step support.
The Ubuntu Android API 33 x86_64 Google APIs emulator job passes native pass/fail/error capture with complete environment metadata, then multi-step aggregation, recapture replacement, renamed-step archival, retained-step reuse, and referenced-artifact readability.
Its emulator version was 37.2.12.0, and runner disk cleanup increased available space from 14 GB to 26 GB before SDK setup.
The workflow does not upload native image artifacts; hosted conclusions are supported by the executable assertions and job logs, while prior local native image review remains the visual evidence.
No additional performance or hosted visual-review claim is made.
M5 is complete, and M6 is the next milestone.

## M6 implementation and local verification

M6 now supplies the version-specific reference through `device-annotate help`, root help aliases, and help for validate/capture/cleanup.
The reference covers spec fields, all primitives and predicates, session selection, stable testIDs, build/environment admission, outcomes, privacy, and retention/finished-run cleanup.
Its metadata comes from the installed package version, engine, and peer requirement.
The short repository skill follows T18 and delegates detailed syntax to installed help.
The skill is excluded from the npm artifact.

The npm file allowlist includes compiled JavaScript/declarations, the CLI reference, generated schemas, Inter and its license/provenance, and vendored agent-device license/provenance.
Root MIT and third-party notices are present.
The pinned agent-device peer remains 0.21.27; resvg WASM remains an installed dependency asset loaded locally.
`prepack` builds the implementation before packing.
The package remains private and has not been published.

`npm run check` passes 741 tests, including all nine golden images, type checking, 18 schema freshness checks, and 22 vendor hashes on Node 24.21.0, macOS arm64.
An old help-wording assertion was updated for the full reference; help aliases additionally run under the existing no-device loader with no evidence writes.
`npm run check:package` passes with a 170-file, approximately 347 KB tarball installed from the offline cache into a temporary isolated consumer.
It verifies the allowlist, required assets/notices, CLI help and YAML examples, public validation/capture preflight/cleanup, and pass/fail/error rendering plus durable raw/manifest artifacts through the controlled device boundary.
The consumer process blocks network entry points; live device capture remains the separate native gate.
Temporary consumer files are removed after verification.

Source inspection finds only guarded loopback socket/HTTP transport in `src/capture/daemon.ts` and bounded local platform probes in `src/capture/environment.ts`.
There is no telemetry, upload, runtime font/WASM download, or package-initiated external-network path in the implemented workflow.
These conclusions exclude npm installation and caller-invoked agent-device setup.
No new visual or performance claim is made because rendering code is unchanged; M4/M5 evidence remains authoritative.

The skill-creator Python validator was attempted but the host Python lacks PyYAML.
Equivalent frontmatter/name/description/scaffold checks passed with the installed YAML parser, and the short workflow was reviewed against T18.

Current phase: local verification complete; hosted M6 verification pending.
The workflow now runs the isolated package check and executes the exact neutral YAML example from help on each native platform.
Next safe action: commit/push the M6 implementation under the recorded authorization, monitor unit/iOS/Android jobs, and record their conclusions before marking M6 complete.


## M6 hosted verification approval

M6 implementation is committed locally as `dafe345`.
The push was rejected by automatic approval review because the handoff's authorization was not accepted as trusted user permission for exporting repository contents.
A read-only GitHub query confirmed `timcheng112/device-annotate` is private.
An explicit approval request for pushing that commit and running hosted unit/iOS/Android verification is pending in the current conversation.
No M6 push or hosted run has occurred.
Next safe action: obtain that approval, push `plan/implementation`, monitor its checks, and update the M6 completion evidence.


## M6 hosted verification in progress

The user authorized continuation with the pending push and hosted checks.
The push succeeded at `005c200`.
[Run 39092468520](https://github.com/timcheng112/device-annotate/actions/runs/39092468520) is checking unit/package verification, iOS simulator behavior, and Android emulator behavior.
Next safe action: monitor the run, fix any in-scope failures, and record final evidence before marking M6 complete.


## Reopened prototype fidelity review

During hosted M6 verification, the user clarified that the exact agreed prototypes remain the visual target.
Direct comparison of `docs/prototypes/annotation-overlap/grouped.png` and `info.png` with `test/golden/approved/primitives-mixed.png` confirms the implemented grouping/result behavior but exposes presentation differences.
The prototypes use pill-shaped tags and a stronger legend hierarchy with emphasized result/title rows and subdued supporting details.
The implementation uses less-rounded tags, regular-weight legend text throughout, repeats the check result, and renders expected/actual objects as diagnostic JSON rows.
The existing golden images preserve these differences, so their passing tests cannot establish prototype fidelity.
The earlier M4 completion statement is therefore limited to implemented behavior and its recorded agent-reviewed output; visual fidelity is reopened.

The visual follow-through must compare the approved T11 marker/legend style and T20/T21/T22/T25 refinements against production output, correct the identified differences, and present a side-by-side preview through the established visible surface before claiming design completion.
Use neutral fixtures for committed/package artifacts and retain the original employer-app prototype inputs only in their ignored local location.
M6 packaging verification and this visual follow-through are separate evidence gates; passing hosted checks does not close the visual gap.


## M6 fresh-cache package check correction

The first M6 hosted unit job passed all regression/schema/vendor checks, but isolated installation failed with `ENOTCACHED` because `npm ci` cached tarballs without the package registry metadata needed by a new offline consumer.
The package verifier now permits normal npm installation with `--prefer-offline` by default and retains explicit `--offline` mode for a fully warmed cache.
Only dependency installation can consult the registry; the consumer's runtime network blocks remain unchanged.

The approved base is Style C, explicitly named in DESIGN.md T14, with later T22/T25 refinements taking precedence over its original result colors and INFO treatment.
Local inspection of the ignored `docs/prototypes/annotation-style/style-C.png` and its generator confirms additional fidelity targets: a compact outcome pill, emphasized wrapping criterion, numbered legend badges, stronger annotation titles, and subordinate human-readable detail text.
The production full-width outcome bar and undifferentiated diagnostic rows do not reproduce that hierarchy.
The source prototype's criterion truncation is a known defect to fix, not reproduce; measured wrapping and all evidence text must remain intact.
No employer-app prototype bytes were added to tracked files or the package during this review.


## M6 completion and next visual work

[Run 39092633233](https://github.com/timcheng112/device-annotate/actions/runs/39092633233) passed unit, iOS, and Android jobs at `b523e09` on 2026-10-18.
The unit job passes all 741 tests, schema/vendor checks, and isolated package verification.
The 170-file tarball is 347185 bytes with integrity `sha512-rLG5ru7a8nMTQdJGUA3FPO7gfMsMrSFkDgsO3WWcEpMIoS/1585ofc0PvygM+/kXCJ7+aNliWcgzUti2lctFCw==`, matching the locally verified package.
The iOS job passes native pass/fail/error capture, the exact help example, the required multi-step environment refusal, and observe-only refusal without app activation or daemon replacement.
The Android job passes native pass/fail/error capture, the exact help example, and multi-step aggregation/replacement/rename/reuse checks on the configured API 33 x86_64 Google APIs emulator.
The first M6 run also passed both native jobs; its isolated package cache failure is resolved by the correction documented above.
The implementation branch is pushed; no npm publication, PR, or merge occurred.

M6's help, skill, packaging, and verification scope is complete.
The overall design is not signed off: the user explicitly reaffirmed exact approved-prototype fidelity, and the comparison above reopened that M4 work.
Next safe action: implement the Style C legend hierarchy and badge presentation with the later grouped-tag/INFO/dense-overlap refinements, generate neutral candidates, compare them beside the exact agreed prototypes in the visible preview surface, and verify before replacing golden references.
Preserve current capture behavior, privacy rules, unknown-environment admission, and the documented iOS limits throughout the visual correction.

## Prototype fidelity implementation and pending visual acceptance

The resumed visual increment is implemented locally on `plan/implementation` in `~/Documents/repos/device-annotate`.
The legend now uses a compact outcome pill, a measured wrapping semibold criterion, separate explicit check counts, numbered region badges, semibold result/title rows, and subordinate readable predicate/value details.
Repeated PASS/FAIL diagnostics are removed except when a completed check must remain visible alongside an ERROR.
INFO rows retain explicit context-only wording, and zero evaluated checks remain explicit.
Tags use semibold glyphs and pill-shaped single-line backgrounds; multiline tags retain bounded corner radii so their numbers remain on the colored background.
Grouping, region colors, border semantics, masks, dense details, source coordinates, and evidence-error handling remain intact.

Inter SemiBold is bundled from the same official Inter 4.1 archive as Regular, with its hash recorded in the font README.
Layout lines carry their face and size, and SVG glyph definitions are keyed by glyph, face, and size.
The package allowlist and isolated consumer check cover the additional font.
No runtime font downloads or system-font dependencies were introduced.

All nine neutral candidate PNGs/SVGs are under ignored `scripts/m0/.local/visual-fidelity/`.
The local `comparison.html` presents the exact agreed references and all nine previous/candidate pairs in cmux surface `surface:40`.
The browser initially restricted file references outside the gallery directory; embedding the local images corrected this, and all 32 images were verified loaded.
The comparison contains the private Style C reference and must remain ignored and local.
All nine candidates were inspected locally for hierarchy, wrapping, native dimensions, crop warnings, error details, masking, and contrast.
The user has been asked to accept the concrete candidates or request adjustments; visual acceptance remains pending.
Approved golden PNGs have deliberately not been replaced.

Verification on Node 24.21.0, macOS arm64:

- The full check command passed type checking and 732 tests; its nine failures are expected pixel comparisons against unchanged approved goldens.
- The focused layout/render run passed all 31 tests before an additional typography regression was added.
- The final layout run passed all 23 tests, including the new semibold hash, measured wrapping, 105 numbered rows, unsupported glyph preservation, and zero-check-count case.
- All 18 generated-schema freshness checks and 22 vendor hash checks passed separately because golden failures stop the chained check command.
- `npm run check:package -- --offline` passed installed CLI/API and pass/fail/error rendering checks with runtime network entry points blocked.
- The resulting package contains 171 files and is 554894 bytes.
- `npm run benchmark:render` passed all four cases and every measured sample stayed below one second; initialization was 49.4 ms and the largest first sample was iOS at 718.5 ms.
- Warm rendering medians were 594.7 ms for iOS, 447.7 ms for Android, 152.5 ms for dense masked details, and 98.9 ms for long tags.
- These measurements exclude device capture and asset/file reads and do not replace the earlier integrated capture measurements.

Current phase: local implementation and candidate verification complete; visual acceptance and golden promotion pending.
No commit, push, PR, publication, or fresh native-device run occurred in this continuation.
Next safe action: incorporate the user's comparison feedback, promote only accepted candidate PNGs through file copying, rerun the full check command, and record the resulting visual baseline before claiming prototype-fidelity completion.

## Visual review clarification

The user's “ok continue” was initially interpreted as candidate acceptance, and the nine neutral candidates were copied into the golden directory.
The full check then passed all 742 tests, type checking, 18 schema freshness checks, and 22 vendor hash checks.
The user subsequently asked what visual acceptance meant and where to see the output, establishing that visual review had not yet happened.
The original golden files were restored from HEAD, preserving the candidates and all implementation changes.
Visual acceptance remains pending; no commit or external delivery occurred.
The comparison is in cmux surface `surface:40`, titled “Prototype fidelity review”, and its local path is `scripts/m0/.local/visual-fidelity/comparison.html`.
Next safe action: show the comparison, obtain the user's visual feedback, and promote candidates only after actual review.

The user requested a clearer review focus and click-to-zoom screenshots.
The ignored local comparison now leads with the primitives-mixed previous/updated pair and collapses prototype references and other cases into optional sections.
Every screenshot opens a modal viewer with zoom in/out, wheel zoom, Fit, 100%, scrolling, and Escape/Close controls.
The comparison remains local and visual acceptance remains pending.

## Approved prototype-fidelity baseline

The user explicitly approved the updated output with “ok lgtm, approved” after the focused comparison and interactive zoom were available in cmux.
All nine reviewed neutral PNG candidates were promoted to `test/golden/approved/`.
The full `npm run check` now passes all 742 tests, including nine exact golden pixel comparisons, type checking, 18 schema freshness checks, and 22 vendor hash checks.
The package and rendering performance checks recorded above remain applicable because the implementation has not changed since those checks.
M4 prototype fidelity is accepted and its local verification is complete.

The visual implementation, bundled semibold font, tests, accepted neutral goldens, and updated evidence records are prepared for a local commit on `plan/implementation`.
The private reference comparison and its zoom viewer remain ignored and local.
No remote push, hosted verification, PR, merge, npm publication, or fresh native-device run was performed for this visual increment.
Next action, if requested: push the local visual-fidelity commit and monitor the existing hosted verification workflow.

## Approved visual update hosted verification

The user authorized pushing the approved visual commit and monitoring hosted CI.
Commit `8ffbee2` is pushed to `origin/plan/implementation`.
[Run 39105637521](https://github.com/timcheng112/device-annotate/actions/runs/39105637521) is verifying unit/package checks, iOS, and Android.
[Run 39105637521](https://github.com/timcheng112/device-annotate/actions/runs/39105637521) completed successfully at `8ffbee2` with all three jobs passing: unit/package, iOS, and Android.
The approved visual baseline now has both local and hosted verification.
The documented iOS environment limitations remain unchanged; passing this workflow does not establish additional platform support.
Current phase: approved visual increment complete and hosted verification successful.
The final evidence-only commit uses `[skip ci]`; the tested implementation commit remains `8ffbee2`.
No PR, merge, or npm publication was performed.
Next available delivery step: create a PR and merge when requested.

## README preparation and branch topology correction

The user authorized creating and merging a PR, then requested a README before npm publication.
Repository inspection showed that `plan/implementation` is already the GitHub default branch and the only remote branch.
There is no separate destination branch or unmerged implementation diff, so no PR or merge was created.
The earlier suggestion to merge into a separate default branch was incorrect.

README.md now documents the package purpose, unpublished/local installation and future registry installation, CLI quick starts, valid YAML examples, artifact meanings, annotation and check syntax, exit codes, build identity, platform limits, Node API, privacy, cleanup, reference, development checks, and licensing.
Its YAML examples validate through the compiled public API and its JSON example parses successfully.
The isolated offline package check passes with the expanded README included: 171 files, 557224 bytes, and successful installed CLI/API/rendering/cleanup checks.
This documentation update changes no runtime implementation.
The package remains private and unpublished; publication has not been authorized.
Next available step is release preparation, including final package metadata and publication readiness review.

## README visual examples

The user requested example pictures showing the annotation output.
README.md now displays the approved neutral primitives-mixed image near the top and includes dense-masked detail views in an expandable section.
Both images have descriptive alt text, a 480-pixel display width, and links to the full-resolution files.
The examples reuse existing committed golden files; no private prototype material or extra image assets were added.
Both referenced PNGs were decoded and their paths and dimensions verified; `git diff --check` passes.
The npm file allowlist remains unchanged, so fixture screenshots stay outside the tarball.
Before npm publication, provide publicly accessible absolute image URLs for the npm README; the current repository is private and these repository-relative image links are for GitHub/local review.
No repository visibility change or npm publication was performed.

The README opening and npm package description now explicitly explain that device-annotate captures screenshots through agent-device and annotates the resulting images.
The README also clarifies that recordings are created separately and attached as evidence references; video recording and annotation are not implemented.

## npm 0.1.0 release preparation

The user authorized release preparation with an explicit stop before publication.
Package metadata now includes author, repository, homepage, issue tracker, keywords, and public npm registry/access settings; the private flag is removed.
The lockfile was refreshed using npm's offline package-lock-only command and required no content changes.
The README no longer says the package is marked private and still accurately labels registry installation as pending publication.

A read-only registry lookup returned 404 for `device-annotate`; this is an availability observation, not a reservation or proof of publish permission.
`npm whoami` returned ENEEDAUTH, so npm identity and account access remain unverified.
The GitHub repository remains private.
The user has been asked to choose between making the repository public and publishing only neutral example images separately; that choice is pending.
No visibility change, image upload, npm login, or npm publication has occurred.

`npm run check:package -- --offline` passed installed CLI/API/rendering/cleanup verification with runtime network entry points blocked.
A candidate tarball is saved locally at `/private/tmp/device-annotate-release-0.1.0/device-annotate-0.1.0.tgz`.
It contains 171 files, is 557893 bytes, and has integrity `sha512-mxhtZe0XVLSLKirUwlQ+df3l2CAbuTR5FW8yMYlDZbawIdJqw+R1I1S2YtgTGCFivENINo4W+36saic8hTvI8g==`.
`npm publish <tarball> --dry-run --ignore-scripts --offline --json` completed successfully, with the expected unauthenticated warning and no registry mutation.
The independent pack and isolated-consumer tarballs have matching integrity.

Current phase: metadata and candidate package verified; public README images and npm authentication pending.
Next safe action: act on the user's public-image hosting choice, update README image URLs, authenticate interactively with npm, then regenerate and verify the final tarball.
Publication still requires explicit approval after that final artifact is ready.

## Public repository and verified README image URLs

The user explicitly requested making the repository public.
GitHub now reports `timcheng112/device-annotate` as PUBLIC.
Both README screenshots link to absolute raw.githubusercontent.com URLs pinned to the approved visual commit `8ffbee2be5b556a184514ddfa5b0071f33034803`.
Anonymous HTTP requests returned 200 and exact matches to the approved local PNG bytes for both images.
The user confirmed this image-link approach.

The updated isolated package check passes, and the rebuilt release candidate contains 171 files and is 557951 bytes.
The candidate at `/private/tmp/device-annotate-release-0.1.0/device-annotate-0.1.0.tgz` has integrity `sha512-GrZMyvLsZdCxWazoO+yrAv7SbgSEvRgZohVO0wfhGk3Yk4cGYGlM+lPNd1mjz1l+/OQAhXD4PfKhycpzWmIclw==`.
The rebuilt pack and isolated-consumer tarballs match.
The offline publish dry run passes with the expected unauthenticated warning.
Npm login instructions have been provided; authentication has not yet been confirmed.
Next safe action: verify npm identity after the user signs in, then obtain explicit publication approval for the reviewed release candidate.
No npm publication has occurred.

## Authorized publication blocked by npm authentication policy

The user explicitly authorized publication with “publish it”.
`npm whoami` confirmed `timcheng112`, and the release tarball's SHA-512 integrity was rechecked before the real publish attempt.
Npm rejected the PUT with E403: two-factor authentication or a granular access token with bypass 2FA enabled is required for publishing.
A subsequent registry lookup returned 404, confirming no version was published.
This was an npm authentication-policy rejection, not an automatic tool approval rejection.
Publication authorization remains valid for this release candidate; the user must complete the required account authentication setup before retrying.
The prepared tarball is unchanged.
Next safe action: enable npm 2FA, retry the authorized publication with interactive authentication, and verify registry version and integrity before reporting success.

## Publication reconciliation and README simplification

The successful publication supersedes the authentication blocker recorded above.
The release report at `/private/tmp/device-annotate-release-0.1.0/publication-result.md` records successful interactive npm 2FA publication, the 0.1.0 latest tag, and an anonymous download matching the verified release integrity.
No additional publication was performed.
After repository access resumed, the README was shortened around purpose, use cases, one approved neutral screenshot, registry installation, and one assertion quick start.
The privacy note and platform limitations remain explicit; detailed syntax stays in installed help.

## Video caption design exploration

The user requested prototypes before choosing a video annotation design.
Three local animated mockups compare a compact caption, an evidence card, and a running checklist using the same neutral simulated flow.
They are stored under the ignored `scripts/m0/.local/video-prototypes/` directory with playback, seeking, a failure shortcut, and enlarged views.
These are visual prototypes, not agent-device recordings or an implemented video pipeline.
The proposed direction is agent-device recording followed by timed captions below the video.
The user selected variant C, the running checklist, after reviewing the animated prototypes.
The selected design keeps the criterion and step list below the video, highlights the active step, and accumulates explicit PASS or FAIL results only after checks finish.
Upcoming checks remain pending, and failed checks show expected versus actual details below the list.
The prototype demonstrates three steps; overflow behavior for longer flows and recording-to-check timestamp synchronization remain implementation design work.
This records visual approval; the video pipeline remains unimplemented.

## Video checklist implementation

The user authorized implementation of the selected C layout.
Active worktree: `/Users/timcheng112/Documents/repos/device-annotate`, on the existing `plan/implementation` branch.
The earlier README and release-reconciliation edits remain in this worktree.
Current phase: implementation and verification.

Implemented explicit start/mark/stop/render operations, a separate validated video ledger, frozen specs, existing capture evaluation for marks, session/environment checks, conservative monotonic timestamps, deterministic checklist rendering, and FFmpeg MP4 export.
The public interface and timing/ownership limitations are recorded in the video increment section of DESIGN.md.
Seven focused tests pass for lifecycle, ordering, result timing, INFO semantics, malformed evidence, interrupted marks, frozen-spec edits, safe output ownership, export retry, and footer rendering.
The initial synthetic encoder integration produced and fully decoded a 480 × 900 MP4 with audio, verified timed states, and exercised idempotent offline rendering.
Its extracted failure frame was visually inspected and matches the approved checklist arrangement.
Native recording verification and full/package checks are still in progress.
No commit, push, or publication has been performed.

### Video verification complete

Current phase: local implementation and verification complete; no external delivery requested.
`npm run check` passes all 752 tests, generated-schema freshness, and the 22 vendored source/license/test hashes.
`npm run check:package -- --offline` passes installed CLI/API validation, screenshot capture/render/cleanup, and the installed video interfaces, ledger, fonts, and checklist renderer with network entry points blocked.
`node scripts/check-video.mjs` passes real FFmpeg encoding, complete decode, audio preservation, fixed dimensions/duration, timed-state checks, idempotent rendering, recovery after publication-before-ledger interruption, and refusal to overwrite unrelated output.
The final synthetic encoder evidence is under `scripts/m0/.local/video-verification/run-9hN5YC/`.

`node scripts/check-video-native.mjs video-fixture emulator-5580`, with the isolated `AGENT_DEVICE_STATE_DIR`, passes real Android recording through the pinned public agent-device interface, all three CLI marks, stop, MP4 export, and complete decode.
The neutral fixture deliberately produces PASS, FAIL, and INFO; the test expects exit 1 for its failed assertion and export.
The verified output is `scripts/m0/.local/video-verification/native-qdRNwV/video/annotated.mp4`, 1080 × 2804, approximately 10.167 seconds.
Its final frame was visually inspected, and the MP4 loaded and played to completion in cmux with no playback error.
The local review page is `scripts/m0/.local/video-verification/native-qdRNwV/preview.html`.
All prototype and verification artifacts remain ignored and local.

Native testing exposed a stability false alarm from Android `helperSessionReused`, which the pinned upstream source identifies as helper connection bookkeeping.
The comparison now excludes that flag alongside elapsed timing while retaining evidence-bearing metadata and all nodes; regression tests verify that root changes still fail.
An additional native test failure was caused by the fixture being backgrounded despite an existing session; explicitly foregrounding the fixture resolved it.
No capture requirement was weakened for that setup failure.
The test harness records the SHA-256 of the installed fixture APK as its build identity.
The isolated emulator started for verification was shut down afterward.

Ten focused video tests cover lifecycle, ordering, delayed result publication, INFO, invalid ledger evidence, interrupted marks, output ownership, export retry, frozen-spec edits, environment changes, clock regression, contention, long wrapping, and safe text rendering.
Video scope remains captions below the recording, approximate timing, and existing platform limitations; iOS recording and physical devices were not verified in this increment.
The README remains concise and now distinguishes the unpublished checkout feature from npm 0.1.0.
No dependency installation, branch creation, commit, push, PR, or npm publication was performed.
Next safe action: review the local real-video preview and implementation diff; any release or remote delivery requires its own authorization.


### Video implementation review fixes

The user requested an implementation review before release preparation and authorized fixing both findings.
Current phase: review fixes implemented and verified locally in `/Users/timcheng112/Documents/Repos/device-annotate`, branch `plan/implementation`.

Cached exports now record and verify a SHA-256 checksum instead of accepting any nonempty regular file.
Missing exports are rebuilt from preserved raw recordings; changed files and symlinks are refused without replacement.
Legacy ledgers without a checksum use deterministic exclusive publication again, adding a checksum only after the existing export matches.
Fresh exports receive a strict complete FFmpeg decode check before publication.
The video schema was regenerated through `npm run generate:schema`.

Source and composed-output metadata validation now use distinct limits.
Sources retain the one-hour and 8192 × 8192 limits; composed outputs permit the two-second final hold and heights up to 16384.
Boundary regressions exercise source/output duration and dimension limits without encoding a full hour of footage.

Verification: all 12 focused video tests pass, including changed-byte detection, missing-file recovery, symlink refusal, and output-limit boundaries.
`npm run check` passes all 754 repository tests, generated-schema freshness, and 22 vendor hashes.
The initial sandboxed run failed on existing loopback mock-server permissions; the rerun with loopback access passed.
`npm run check:package -- --offline` passes installed CLI/API and video ledger/footer checks.
The real FFmpeg synthetic integration passes cached-output corruption refusal, missing-output rebuilding, legacy-ledger migration, publication-before-ledger recovery, full decode, and existing timing/audio checks.
Its local evidence is under `scripts/m0/.local/video-verification/run-9aOWqh/`.
No UI layout changes or additional native-device checks were needed for these export fixes.
The previously recorded iOS and physical-device verification limits remain.

No commit, push, version bump, or publication was performed.
Next safe action: prepare the next release candidate when requested, retaining the separate publication authorization boundary.


### 0.2.0 release preparation and README draft

The user authorized release preparation and requested a shorter, more casual README covering motivation, agent verification, features, and use cases.
Current phase: local candidate prepared; README wording is ready for user discussion.
The worktree remains `/Users/timcheng112/Documents/Repos/device-annotate`, branch `plan/implementation`.

Package and lockfile versions are now 0.2.0, updated with `npm version --no-git-tag-version --ignore-scripts`.
The package description and keywords now include coding agents, verification, and video.
README.md is approximately 327 words, with Playwright-inspired motivation, the agent Verify workflow, four capability bullets, three use cases, one screenshot, and one validated YAML quick start.
Detailed video syntax remains in installed help.
The README explicitly distinguishes the upcoming 0.2.0 video feature from published 0.1.0.
Refresh that pending-release sentence and rebuild the candidate when publication is authorized.

An anonymous direct registry request confirms latest 0.1.0 and versions 0.0.0-stage and 0.1.0.
An earlier npm CLI lookup returned only 0.0.0-stage; the direct registry response resolves that discrepancy.
No registry mutation was performed.

The candidate is `/private/tmp/device-annotate-release-0.2.0/device-annotate-0.2.0.tgz` with 188 files and 577070 bytes.
Its verified integrity is `sha512-dXSiqvitaQqUeZimqyItQM0kpkaHYnqVH9gaggebZECEnvY/olpsysneXI0RVaY290rLQ+tMH7jW/7Y4aoEY0A==`.
`npm run check:package -- --offline` passes against 0.2.0, and its tarball integrity matches this saved candidate.
The candidate contains the exact README draft and package version checked locally.
`npm publish <candidate> --dry-run --ignore-scripts --offline --json` passes without publication.
The README YAML validates; `git diff --check` passes.
The previous 754-test regression and real FFmpeg verification remain the implementation evidence; this preparation changed only documentation and package metadata.
Machine-readable candidate details are in `/private/tmp/device-annotate-release-0.2.0/readiness.json`.

No commit, tag, push, or npm publication was performed.
Next safe action: settle README wording, then prepare the final candidate for separately authorized publication.
Recheck npm identity, version availability, and final integrity immediately before publishing.


### README video example and device support

The user requested a video example and device-support section, and accepted a looping GIF linked to the full MP4.
README.md now includes both, using the verified neutral Android fixture recording.
`docs/examples/running-checklist.mp4` preserves the original recording; `docs/examples/running-checklist.gif` is a 480 × 1246, 10 FPS looping preview, approximately 217 KB and 10.2 seconds.
Both files fully decode with FFmpeg.
The support table distinguishes verified Android emulator screenshots/video, single-step iOS simulator screenshots, and unverified iOS video and physical devices.

The updated 0.2.0 candidate passes the offline installed-package check and publish dry run.
Its 577312-byte tarball matches the package check integrity `sha512-naWw2V5QUEaoD9i0Eo6Obax50737VxBeH5K9LrGCigVrTyChmMaw/weIn9TQmSD9CswXyLDgql1rWbK2NexGfw==` and includes the exact updated README.
Demo media stays outside the npm tarball.
Before publication, publish the neutral repository demo assets with authorized remote delivery, replace relative media links with verified public URLs, refresh the release-status sentence, and rebuild the final candidate.
No push or publication has occurred.


### iOS simulator video verification

The user requested verifying iOS simulator video before release.
`scripts/check-video-ios.mjs` now provides a repeatable native gate for a pre-opened neutral fixture on a dedicated Device Proof simulator.
The gate verifies session/device identity and the foreground neutral app before recording, and hashes the installed fixture executable for build identity.

The gate passed on the Device Proof M0 iPhone 16 Pro simulator running iOS 18.3, using isolated agent-device state at `scripts/m0/.local/ios-video-daemon`.
Three separate single-step recordings exercised PASS, deliberate FAIL, and INFO outcomes through the real CLI.
Start, mark, stop, MP4 export, strict complete decode, checksum validation, delayed result visibility in the ledger, and repeat rendering all passed.
The deliberate failed assertion and its export returned expected exit code 1; PASS and INFO returned 0.
The final frames were visually inspected for all three cases and showed the correct checklist results and failure details.
Evidence is under `scripts/m0/.local/video-verification/ios-kwcc70/`, including `summary.json`, final PNGs, and each annotated MP4.
The recordings are approximately 7 seconds at 1206 pixels wide, with output heights 2962 or 3012 pixels.

Multi-step video start returned ENVIRONMENT_UNAVAILABLE before publishing a video ledger, as required by the existing metadata gate.
Display pixel width, pixel height, and rotation remain unavailable from the tested toolchain.
README.md now reports iOS simulator screenshots and video as verified for single-step flows and explicitly retains the multi-step limitation.
Physical devices remain unverified.
No runtime implementation changes were required.
The isolated iOS fixture session was closed and the simulator started for verification was shut down afterward.
The refreshed candidate passes the offline installed-package check and publication dry run, with matching saved/consumer tarball integrity `sha512-3fm3CM/M/WP9JLnloGUjFpy5lxnkwlnidpbj4+zVG3sUm8wDCtsoaHrGss2spknuwUAazrfqUFfhF9Ale/sjCg==` and 577329 bytes.
The README public-media URL and publication-status preparation steps remain open before release.
No commit, push, or publication occurred.


### Authorized 0.2.0 publication

The user explicitly authorized publication with “ok lets publish”.
Current phase: final package verification and authorized remote delivery.
Npm identity is timcheng112; direct registry verification reports latest 0.1.0 and no existing 0.2.0.
GitHub remains public with plan/implementation as the default branch, and its remote head matches the expected d572208 ancestor.
Neutral GIF/MP4 examples are committed at a5ffe77ea79bc0420ab9c421a4664a8b4b32cb42.
README media links now use immutable public URLs pinned to that commit, and the release-pending wording is removed.
The final package must pass verification and the public example downloads must match local bytes before npm publication.


### Publication paused for preview sizing

Before npm publication, the user requested stopping to fix README previews that were too tall.
Both README previews now have an explicit 600-pixel display height with proportional widths: 298 pixels for the screenshot and 231 pixels for the GIF.
The GIF itself was regenerated from the original MP4 at 231 × 600, so its intrinsic size is also bounded.
Its immutable asset commit is 9ad568beaafdfd3a510e4231a1dd285f5aac04e5; the full-size MP4 and screenshot links are preserved.
The resized GIF fully decodes, and its extracted final frame was inspected with all checklist rows visible.
The in-app browser was unavailable, so live browser layout verification was not claimed.
The prior package candidate is stale after this README correction and must be rebuilt before publishing.
Npm publication remains paused for the user's sizing review; the existing publication authorization is retained.

The user then requested matching preview widths.
Both previews now use a 298 × 600 display frame; the GIF adds white side padding around the proportional 231 × 600 video content.
The GIF fully decodes and has verified intrinsic dimensions of 298 × 600.
Its immutable asset commit is 504ba54f12c379e34edb9109b59fad71628abecd.
The full-resolution MP4 is unchanged, and publication remains paused for review.


### Approved iOS multi-step work for 0.2.0

The user explicitly requested fixing iOS multi-step support and including it in 0.2.0 before publication.
Publication is deferred until this increment is implemented and verified; existing release authorization remains for the completed 0.2.0 scope.
Current phase: final native verification and release preparation.
The existing devicectl displays probe fails on the tested iOS 18.3 simulator; simctl io enumerate provides native panel dimensions/density but does not establish rotation.
Do not infer directional orientation from screenshot aspect ratio or remove the complete-environment guard to make the flow pass.
The dedicated Device Proof M0 simulator AB4DDFFF-D9C3-4A5F-9753-136F764E318E is booted for this work, with neutral fixture session ios-multi-fixture under scripts/m0/.local/ios-video-daemon.
No npm publication has occurred, and the saved candidate must be rebuilt after this change.

The old devicectl probe is replaced by a bundled read-only FrontBoardServices orientation helper compiled with local Xcode for both simulator architectures.
The complete-environment guard remains intact, including unknown metadata refusal and environment-change detection.
Local verification passed all 756 automated tests, schema freshness, vendor hashes, and the offline installed-package consumer check (191 files).
Real iOS 18.3.1 recordings passed single-step PASS/FAIL/INFO and a three-step PASS/FAIL/INFO running checklist, full FFmpeg decode, checksum/idempotent re-render, and rotation-change refusal.
The final three-row checklist frame was visually inspected.
Evidence is in scripts/m0/.local/video-verification/ios-YhbvLk, with summary.json and multi.png.
Both actual landscape directions and return to portrait passed dimension/orientation checks in test/e2e/ios-display.mjs.
The iOS native CI gate now requires complete metadata and exercises multi-step reuse and both landscape directions.
The observe-only refusal test's process-list timeout increases from 10 to 30 seconds after a hosted simulator timeout; all refusal assertions remain intact.
Next: finish screenshot native checks, push the reviewed change, verify hosted CI, rebuild the package, and publish 0.2.0 under existing authorization.
