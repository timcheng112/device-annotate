# M5 delivery

M5 integrates capture, rendering, durable artifacts, ownership, and cleanup under [PLAN.md](PLAN.md).
Current phase: implementation, with the internal integration and persistence foundation verified.
M0 through M4 are complete; M4 was committed as `12c12ab`.
Its rendering and performance evidence remains in [M4-RENDERING.md](M4-RENDERING.md).
M5 is incomplete and does not yet expose public live capture.

Worktree: `/Users/timcheng112/Downloads/device-proof`.
Branch: `plan/implementation`.
Local commits are authorized.
No push, publication, PR, external communication, or live-device session changes occurred during this implementation session.

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
The public API/CLI and actual local-device adapter remain outstanding.

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
No live iOS/Android verification or CI run has been performed for M5.

## Approved capture-only contract refinement

Additional review of the pinned agent-device 0.21.27 source found that ordinary iOS snapshots can activate a background session app.
The runner's `prepareActivatedTarget` calls `activateTarget` when the target needs activation.
This conflicts with device-proof's capture-only requirement if used without qualification.

The public snapshot API supports `observeOnly: true`.
Its runner path resolves the existing app without activation and refuses observations unless the app reports `runningForeground`; it also requires an already-ready compatible runner.
However, the T8-required `client.command.wait({ stable: true })` goes through `runStableCaptureLoop` and ordinary selector snapshots, and does not expose observe-only snapshot options.
The relevant upstream source paths are `src/commands/interaction/runtime/stable-capture.ts`, `src/commands/interaction/runtime/selector-read-shared.ts`, and `apple/runner/AgentDeviceRunner/AgentDeviceRunnerUITests/RunnerTests+CommandDispatch.swift` at the pinned revision.

The user approved replacing the iOS stable-wait call with a bounded quiet-period loop of observe-only snapshots on 2026-10-18.
[DESIGN.md T8](DESIGN.md#t8-stability-check) now records that refinement, including observe-only comparison snapshots and refusal without activation or fallback.
Android retains the approved upstream wait.
Proceed with dependent integration without asking again.
The earlier question about foreground preflight was superseded by discovery of the observe-only API.

## Next safe action

Implement the actual local-device adapter using the approved observe-only iOS stability refinement in T8.
Complete session-selected read-only environment collection under T52/T53, recording/build preflight at the public boundary, capture/cleanup CLI and Node API, interrupted-write coverage, and both native end-to-end suites and CI definitions.
Finished-run preview, application, and repeat application are covered by focused filesystem tests.
Recheck simulator, emulator, and daemon state before live work, preserving the daemon guard and neutral-fixture restrictions.
Do not mark M5 complete until the full [M5 exit criteria](PLAN.md#m5-capture-and-artifact-integration) are satisfied.
