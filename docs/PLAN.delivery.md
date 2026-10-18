# M5 delivery

M5 integrates capture, rendering, durable artifacts, ownership, and cleanup under [PLAN.md](PLAN.md).
Current phase: verification, with public capture/cleanup, native adapters, and local native suites implemented.
M0 through M4 are complete; M4 was committed as `12c12ab`.
Its rendering and performance evidence remains in [M4-RENDERING.md](M4-RENDERING.md).
M5 exposes public live capture but remains incomplete until the required hosted CI gates run successfully.

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
Hosted verification is running on GitHub Actions.

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
These workflow definitions are local and have not run on hosted CI.

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

Monitor the unit, iOS, and Android jobs in the hosted workflow and resolve any M5 failures.
Repository creation, this push, and hosted CI execution are authorized; a further publication confirmation is unnecessary.
The iOS host limitation remains explicit: multi-step iOS evidence requires a toolchain/provider that can reliably expose active display rotation, or a separately verified read-only observation source.
Do not substitute configured orientation, screenshot aspect ratio, or a guessed default for that observation.
Keep T8's approved observe-only refusal behavior intact.
Do not mark M5 complete until the full [M5 exit criteria](PLAN.md#m5-capture-and-artifact-integration), including successful hosted iOS and Android CI runs, are satisfied.

## First hosted CI corrections

The first run passed the complete offline checks on Ubuntu.
Android setup failed because `sdkmanager` was absent from `PATH`; the workflow now explicitly sets up Android command-line tools and the fixture SDK packages.
iOS setup failed because the pinned agent-device CLI accepts `prepare --timeout`, while the workflow used `--timeout-ms`; the command now matches the installed CLI help.
Both corrections concern test setup, and neither changes the capture-only adapter or environment admission gates.

The second hosted run, https://github.com/timcheng112/device-annotate/actions/runs/39090147160 at `10aec39`, passed all 740 tests and the iOS native suite, including capture-only refusal.
Android built the fixture but its emulator exited before boot: 3510 MB was available and the data partition required 7373 MB.
The workflow now removes unused .NET and Android NDK installations from the disposable Android runner before setup, reports available disk space, and bounds emulator boot to five minutes.
No local SDK installation is removed.
