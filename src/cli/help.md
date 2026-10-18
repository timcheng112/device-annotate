# device-annotate {{version}}

Capture annotated evidence from an existing local agent-device {{peer}} session.
Node {{node}} is required.
Use agent-device to open, navigate, foreground the app, and prepare its runner first.
Capture never taps, navigates, boots a device, activates an app, or replaces a daemon.

## Commands

```sh
device-annotate help
device-annotate validate cart.yaml
device-annotate capture cart.yaml --step after --platform android --build build.json
device-annotate capture --step sample --criterion 'The total is displayed' --box 'id="cart-total"' --out evidence/sample
device-annotate cleanup evidence/sample
device-annotate cleanup evidence/sample --apply
device-annotate cleanup evidence/sample --finished
device-annotate cleanup evidence/sample --finished --apply
```

`help`, `--help`, `-h`, and each command's `--help` print this reference offline.
`validate <spec>` validates YAML or JSON offline, including duplicate step names and nonblank selectors.
Selector parsing and target resolution occur during capture.
Use `validate -- <path>` for a path beginning with a hyphen.
The bundled `src/spec/spec.schema.json` provides structural editor validation; the CLI also checks whole-file rules.

Capture requires `--step` and either a spec path or `--criterion` plus `--out`.
One-off `--box <selector>` may repeat and produces INFO annotations.
Use a spec or the Node API for expectations and other primitives.
Spec mode cannot be combined with one-off criterion or annotations.
Optional capture flags: `--platform ios|android`, `--session <exact-address>`, `--build <JSON-file>`, `--out <folder>`, and repeated `--recording <local-file>`.
Recordings must already be readable regular files; they remain caller-owned and are listed without annotation.
CLI paths resolve from cwd, except YAML `out`, which resolves relative to the supplied spec path.
The default spec output is `evidence/<spec-basename>` beside the spec.
A CLI `--out` override resolves from cwd.

Implicit sessions are scoped to cwd; select a platform when both platforms are open.
Named sessions require `--session` with their exact address.
Ambiguous or missing sessions fail instead of choosing a device.
The installed peer and running installed-origin daemon must match; prepare them using agent-device.
On iOS, the app must already be foreground and the observe-only runner ready.
Capture refreshes snapshots, so old element refs can become stale.
Prefer stable `id="..."` selectors and add testIDs to evidence targets; refresh refs with agent-device before subsequent actions.

## Full spec

Unknown fields are rejected.
`criteria` is a nonempty list of `{criterion, steps}` objects.
Copy each acceptance criterion verbatim from the plan.
Each `steps` object contains at least one step, with names unique across the whole file.
Names are 1-64 characters, start with a lowercase letter, and contain lowercase letters, digits, `_`, or `-`; reserved filenames such as `con` and `nul` are rejected.
`out`, `defaults`, and `retention` are optional.
A step accepts `annotate`, `checks`, and `crop`; omitted lists are empty.
Only `crop` is inherited from `defaults`.
Omitted crop inherits the default; `crop: null` requests the full screenshot.
Crop includes the union of explicit targets and drawable annotation/check targets, with padding in screenshot pixels (default 24, minimum 0), limited to screen bounds.
Raw evidence remains full-frame.

```yaml
out: evidence/cart
retention:
  maxAttemptsPerStep: 3
  maxAgeDays: 7
  maxBytes: 500000000
defaults:
  crop:
    targets: ['id="cart"']
    padding: 24
criteria:
  - criterion: Cart total updates when quantity changes
    steps:
      before:
        annotate:
          - marker:
              target: 'id="cart-total"'
              text: Total before quantity changes
      after:
        annotate:
          - box:
              target: 'id="cart-total"'
              expect: { text: '£12.00' }
          - arrow:
              to: 'id="quantity"'
              text: Quantity control
          - callout:
              target: 'id="delivery"'
              text: Selected delivery option
              expect: { selected: true }
          - mask:
              target: 'id="account-number"'
        checks:
          - target: 'id="error-message"'
            expect: { absent: true }
```

Each annotation has exactly one primitive: `box`, `marker`, `arrow`, `callout`, or `mask`.
Box, marker, callout, and mask use `target`; arrow uses `to`.
Arrow and callout require nonblank `text`; text is optional on other primitives.
All primitives accept an optional `expect` containing exactly one predicate.
Omitting `expect` produces INFO and contributes no passing assertion.
Standalone checks require `{target, expect}` and are useful for absence without drawable geometry.
Annotations always need drawable targets, even when their predicate concerns absence.

Predicates use agent-device semantics on the same accepted snapshot:

- `visible: true`: target is visible.
- `hidden: true`: target is hidden according to snapshot visibility evidence.
- `exists: true`: target exists.
- `absent: true`: target is absent, subject to snapshot completeness restrictions.
- `editable: true`: target supports editing.
- `selected: true`: target is selected.
- `focused: true`: target is focused.
- `text: '<exact expected text>'`: exact nonempty string comparison, preserving whitespace.

State predicates accept only `true`; use `hidden` or `absent` for their corresponding negative assertions.
Zero matches may prove standalone hidden/absent checks only when upstream snapshot evidence permits it.
Ambiguity and unresolved drawable targets produce errors with candidate diagnostics.
Fully off-screen drawable targets are errors; partly off-screen targets produce warnings.
Edge-touching targets with already-clipped bounds warn that their full extent is unknown.
Checks and annotations share numbers; grouping preserves separate legend results.
Dense overlaps can produce detail views, and full legend text is retained.
Region colors identify targets; PASS/FAIL/INFO/ERROR text, symbols, and border styles communicate results.
Bundled Inter provides deterministic English-first rendering; unsupported glyphs appear as Unicode escapes while source text remains preserved.

## Neutral fixture example

With the repository's neutral fixture app already foreground, this single-step example works on both tested platforms.
Save it as `neutral.yaml` and run `device-annotate capture neutral.yaml --step sample --platform ios` (or `android`).

```yaml
criteria:
  - criterion: The neutral center element exists
    steps:
      sample:
        checks:
          - target: 'label="center"'
            expect: { exists: true }
```

## Build identity and reuse

Multi-step specs require a complete build identity supplied separately with `--build` or the Node API.
This identifies the actual installed native build and all runtime code; validation cannot verify the caller's claim.

```json
{"appId":"dev.example.cart","native":"sha256:actual-installed-build-hash","runtime":{"kind":"embedded"}}
```

For separately delivered JavaScript or other runtime code, use `runtime: {"kind":"external","revision":"immutable-runtime-hash"}`.
Single-step captures may omit identity but their unknown build cannot establish reuse compatibility.
Multi-step captures also require observed device, OS, display, and tool metadata.
Unknown metadata refuses multi-step capture before accepting evidence; a fresh single-step capture may record unknown values.
iOS simulators use a read-only native orientation probe compiled with local Xcode.
Multi-step capture works when this probe and the other device metadata reads succeed; unsupported tooling leaves metadata unknown and refuses multi-step capture.
Android emulator and iOS simulator multi-step capture are verified.
Physical devices and other platforms have no release verification claim.

A step replacement updates the shared manifest and archives its previous attempt.
Spec, criterion, build, or environment changes invalidate affected evidence; unknown identity never enables reuse.
Removed steps enter history, renamed steps start incomplete, and reordering preserves compatible evidence.
A historical pass never restores itself automatically.

## Results, diagnostics, and integrity

Validation emits one JSON value on stdout and exits 0 for valid or 2 for invalid input.
Capture and cleanup emit one JSON value on stdout; human diagnostics go to stderr.
Capture exits 0 for a passed step, 1 for failed assertions, and 2 for an evidence error.
The exit describes this step; inspect `manifest.json` for the whole flow.
Aggregate precedence is error, failed, incomplete, passed.
Only recorded assertions contribute to check counts; INFO and uncaptured steps contribute none.
A zero-check capture may pass evidence production without proving an assertion.
Completed independent checks survive other entry errors.
An error image can contain partial evidence, but missing mask geometry suppresses the annotated image entirely.
Available raw evidence and structured diagnostics are retained after evidence-production errors.

- `INVALID_INPUT` / `SPEC_UNAVAILABLE`: validate the whole spec and check paths, flags, step names, and build identity.
- `SESSION_UNAVAILABLE` / `DEVICE_UNAVAILABLE`: prepare the intended local session and select its platform or exact address.
- `DAEMON_UNAVAILABLE` / `DAEMON_VERSION_MISMATCH`: use the matching installed agent-device daemon; capture refuses to restart it.
- `DAEMON_CHANGED` / `SESSION_CHANGED`: verify the intended session before retrying.
- `IOS_OBSERVATION_UNAVAILABLE`: foreground the app and prepare the compatible observe-only runner using agent-device.
- `ENVIRONMENT_UNAVAILABLE`: inspect missing metadata; use a supported observation source or an independent fresh single-step run.
- `CAPTURE_UNSTABLE`: settle animations or loading through agent-device and retry; capture comparison has one initial attempt and at most three retries.
- Target/check diagnostics: inspect candidates, use stable selectors, or add testIDs; preserve the criterion and expectations.
- Output busy/ownership/save diagnostics: wait for the active writer, use the owning spec or a separate folder, and check filesystem access.
- Recording diagnostics: provide existing readable local files outside managed output paths.

Passed means the requested step's evidence is complete; verify all requested steps before reporting the flow done.
Failed means fix the app.
Error means fix the selector, spec, environment, or testID; never change app behavior merely to clear an evidence error.
Never hand-edit images or `manifest.json`, weaken expectations to manufacture a pass, or hide failures.
Change an expectation only when the criterion was misread, and disclose the correction.

## Privacy and retention

Masks affect annotated images, including detail views; raw screenshots and snapshots remain unredacted audit artifacts.
Use seeded test data and review artifacts before sharing.
There is no automatic redaction, telemetry, upload, or package-initiated external network request.
Capture communicates with the verified local daemon over loopback and invokes read-only local platform tooling.
Installation and caller-invoked agent-device preparation have their own dependency/tool behavior.

History defaults: 3 previous attempts per step, 7 elapsed 24-hour days from stored capture time, and 500000000 bytes across historical artifacts.
All limits apply together; zero in any limit disables history retention.
Current evidence and caller-owned recordings remain protected.
Oldest eligible history is pruned after a successful durable save or an explicit cleanup command, never by a background timer.
A failed save does not prune history.
`cleanup <folder>` previews deletions; add `--apply` to delete eligible managed history.
`--finished` requires a fully captured passed or failed run and previews cleanup including current evidence; combine with `--apply` only when that run can be discarded.
Cleanup preserves caller-owned recordings and unrelated files and does not recursively remove the output folder.

## Node API

```js
import { validate, capture, cleanup } from 'device-annotate';
const validation = validate(yamlText); // YAML text or a spec object
const attempt = await capture({ specPath: 'cart.yaml', step: 'after', platform: 'android', build });
const preview = await cleanup({ outDir: '/absolute/path/to/evidence/cart' });
```

`capture` also accepts `cwd` (absolute), `session`, `out`, and `recordings` (local path strings).
For one-off calls use `{step, criterion, out, config: {annotate, checks, crop}}` instead of `specPath`.
`cleanup` accepts `outDir`, `apply`, and `finished`; omitted booleans default to false.
The package ships TypeScript declarations, generated schemas, the Inter font/license, and vendored agent-device notices.
The pinned `@resvg/resvg-wasm` dependency supplies local WASM bytes; runtime never downloads fonts or WASM.

## Annotated video

Record through agent-device, mark prepared screens, and export a timed running checklist below the video.
Requires local FFmpeg with libx264 and ffprobe on PATH, in addition to the normal capture prerequisites.
Use seeded data: video is not redacted, and specs containing masks are rejected before recording.

```sh
# Open the intended app/session with agent-device first.
device-annotate video start flow.yaml --build build.json --platform android --out evidence/flow-video
# Navigate with agent-device, then mark the next declared step.
device-annotate video mark --out evidence/flow-video --step before
# Navigate to the next state with agent-device.
device-annotate video mark --out evidence/flow-video --step after
device-annotate video stop --out evidence/flow-video
# Retry an export after a tool/disk failure, without contacting the device.
device-annotate video render --out evidence/flow-video
```

`start` accepts one spec path, required `--out`, optional `--platform ios|android`, `--session <exact-address>`, and `--build <JSON-file>`.
`mark` accepts required `--out` and `--step`; `stop` and `render` accept required `--out`.
Paths resolve from the invocation directory.
Use `device-annotate video --help` for this complete reference.
Start always requires a new empty output folder and freezes the spec for the recording.
The spec's screenshot `out` setting is ignored for video; captures are saved under the video's `evidence/` directory.
Mark each declared step once and in order, after navigating to its expected state.
Repeated checks and changed specs require a new recording.
Do not independently stop, restart, or replace this session's recorder through agent-device while recording.

`video.json` records the session, observed environment, build, frozen spec, timing, marks, warnings, export path, and export checksum.
Rendering again verifies the saved checksum and rebuilds a missing export from the raw recording.
If the saved export has changed, preserve it elsewhere by moving `annotated.mp4`, then rerun `video render`; the command never overwrites the changed file.
`raw.mp4` remains unchanged, `annotated.mp4` contains the checklist, and `evidence/manifest.json` retains screenshot results and audit artifact paths.
The checklist shows PENDING, CHECKING, PASS, FAIL, INFO, and ERROR explicitly.
INFO means no assertions were evaluated.
Completed results persist while later steps run; failure rows include expected and actual values.
The footer expands to fit the flow and keeps a constant height throughout playback.
Video output is 30 FPS H.264 MP4; available audio is transcoded to AAC.
A labeled frozen-frame ending gives final results at least two seconds of reading time.

Timing is approximate: agent-device {{peer}} does not report the first-frame timestamp.
The ledger records the start request window, and captions use the same host's monotonic clock without stretching to fit the video.
The footer discloses this uncertainty.
The first version supports at most 100 steps and one hour of source video, with bounded output dimensions.
Split flows whose full checklist exceeds rendering limits.
Multiple raw chunks are preserved but are not exported as a continuous recording.
Video has captions only; it does not track or mask moving targets.

Build and environment requirements match screenshot capture on Android emulators and iOS simulators.
A session/environment change refuses new checks.
Recording startup preflights tools and environment before starting the recorder.
An interrupted start is never automatically retried or stopped: inspect agent-device before stopping any recorder.
An interrupted mark blocks further marks; stop to preserve its ERROR state, then start a new recording to retry.
Stop can be retried after a transport failure; once successfully stopped, export retries stay offline.
Raw evidence survives export errors.
A completed export returns exit 0 for a complete flow without failed checks, 1 for failed checks, or 2 for incomplete/error evidence.
Exit 0 with INFO-only steps proves no assertions.

```js
import { videoStart, videoMark, videoStop, videoRender } from 'device-annotate';
await videoStart({ specPath: 'flow.yaml', out: 'evidence/flow-video', platform: 'android', build });
await videoMark({ out: 'evidence/flow-video', step: 'before' });
// Navigate using agent-device, then mark the remaining declared steps.
await videoMark({ out: 'evidence/flow-video', step: 'after' });
const result = await videoStop({ out: 'evidence/flow-video' });
// If encoding failed after stop: await videoRender({ out: 'evidence/flow-video' });
```

All video operations also accept an absolute `cwd`.
Screenshot cleanup operates only on its evidence ledger; video files are retained until explicitly removed by their owner.
