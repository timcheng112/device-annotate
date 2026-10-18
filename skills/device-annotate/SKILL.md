---
name: device-annotate
description: Capture annotated native mobile screenshots and assertion evidence with device-annotate after navigating with agent-device. Use to verify acceptance criteria, produce selector-anchored evidence, or diagnose capture outcomes.
---

# Device annotate

Use the installed `device-annotate help` for the version-specific spec, examples, flags, and diagnostics.
Prerequisites: the matching agent-device peer, its agent skill for device navigation, and an existing local session with the intended app ready.
Use agent-device to navigate and prepare the runner; device-annotate only observes and captures.
On iOS the app must already be foreground and its observe-only runner ready.

Copy acceptance criteria verbatim from the plan into a spec, select named steps, and validate the entire spec offline before capture.
Add stable testIDs to evidence targets and use stable selectors instead of guessing coordinates.
Select the cwd-scoped session with `--platform` when necessary, or an explicit session address with `--session`.
Alternate agent-device actions with `device-annotate capture <spec> --step <name>`.
Capture refreshes snapshots, so reacquire refs before later agent-device actions.
Supply truthful native/runtime build identities for multi-step flows; unknown build or environment metadata cannot establish reusable evidence.
Consult help for current platform limitations, including the iOS multi-step metadata refusal.

Passed means that step is complete; inspect the shared manifest before claiming the entire flow is done.
INFO annotations and zero-check captures prove no assertions.
Failed means fix the app.
Error means fix the selector, spec, environment, or add a testID; never change app behavior merely to clear an evidence error.
Report failures as they are.
Never hand-edit images or manifest.json, or weaken an expectation to turn a failure into a pass.
Change an expectation only if the criterion was misread, and disclose that correction.

Masks cover annotated images and detail views; raw screenshots and snapshots remain unredacted audit artifacts.
Use seeded test data and review artifacts before sharing.
Local evidence creation does not authorize uploading it.

History defaults to three previous attempts per step, seven elapsed days from stored capture times, and 500000000 bytes across historical artifacts.
All limits apply together; zero disables history retention.
Cleanup runs after safe saves or explicit commands, with no background timer.
Current evidence and caller-owned recordings are protected during history cleanup.
Preview with `device-annotate cleanup <folder>`; use `--apply` for eligible history deletion.
A finished run must have all steps captured with a passed or failed aggregate outcome.
For a finished run, preview with `--finished` and add `--apply` when its current evidence can be discarded.
Caller-owned recordings and unrelated files remain protected.

## Video evidence

For a video checklist, use `video start <spec> --out <new-folder>` with the same platform/session and build options as capture.
Navigate with agent-device, then `video mark --out <folder> --step <name>` once per declared step, in order.
Finish with `video stop --out <folder>` and inspect its result and `video.json` before reporting success.
Use `video render --out <folder>` to retry encoding after a completed stop.
The Node equivalents are `videoStart`, `videoMark`, `videoStop`, and `videoRender`.
FFmpeg with libx264 and ffprobe must already be installed.
Captions use approximate monotonic timing with the recording-start uncertainty disclosed; do not claim frame-perfect alignment.
The approved running checklist shows all steps, accumulated results, and expected/actual failure details below the recording.
Video has no moving-target masks; mask specs are refused, and all recordings remain unredacted.
Use a new recording for recaptures, changed specs, interrupted marks, or changed environments.
Do not independently replace or stop the recording through agent-device during an active video flow.
An unacknowledged start requires inspection before stopping any recorder.
