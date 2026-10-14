# M0 capture compatibility spike

Status: runtime experiments complete on both platforms; the partial-visibility behavior refinement is awaiting user review.
M1 and dependent production work have not started.
The authoritative product decisions remain in [DESIGN.md](DESIGN.md); this document records observations and unresolved consequences.
Experiments ran on 2026-10-14 UTC, crossing into 2026-10-15 in Asia/Singapore.

## Reviewable evidence

Open the [coordinate preview](prototypes/capture-spike/index.html) in cmux.
It includes native iOS, native Android, and an additional iOS compatibility-mode diagnostic, with a toggle between outlines and the raw captures.
The native captures each have six targets checked against both known app geometry and actual colored pixels.
All twelve native targets match exactly; the compatibility diagnostic has at most one pixel of rounding error.
The preview was opened, inspected, and refreshed in cmux during this spike.
These are diagnostic overlays, not M4's production annotation renderer or reviewed golden images.

- [Geometry measurements](../test/fixtures/capture-spike/geometry.json)
- [iOS snapshot](../test/fixtures/capture-spike/ios/capture.snapshot.json) and [PNG](../test/fixtures/capture-spike/ios/capture.raw.png)
- [Android snapshot](../test/fixtures/capture-spike/android/capture.snapshot.json) and [PNG](../test/fixtures/capture-spike/android/capture.raw.png)
- [Implicit and explicit session checks](../test/fixtures/capture-spike/sessions.json)
- [Real daemon mismatch experiment](../test/fixtures/capture-spike/daemon-guard.json)
- [Selected environment and installed build provenance](../test/fixtures/capture-spike/provenance.json)

All committed images and trees are from `dev.deviceproof.fixture`, a neutral native fixture with fixed labels and geometry.
The final Android evidence uses a dedicated AVD created from the installed system image, without restored user apps.
An earlier emulator startup restored an unrelated app; the neutral-content check refused that capture before writing fixture artifacts.
Daemon state, logs, binaries, signing keys, upstream source, and build outputs stay under ignored `scripts/m0/.local/`.
No employer-app inputs are used in the fixture generators or committed evidence.

## Exact runtime and source

| Component | Used here |
|---|---|
| agent-device npm artifact | 0.21.27, pinned with integrity in the harness lockfile |
| Corresponding upstream release tag | `v0.21.27`, commit `50e45f11bc6d388d272e672771acc33d9e56921d` |
| Disposable older daemon | agent-device 0.21.26 |
| PNG inspection | pngjs 7.0.0 |
| Node / npm | 24.21.0 / 11.19.0 |
| Host | macOS 14.6.1, arm64 |
| Xcode / simulator SDK | 16.2 (16C5032a) / 18.2 |
| iOS target | Dedicated iPhone 16 Pro simulator, iOS 18.3.1 |
| Android target | Dedicated 1080 × 2220 AVD, Android 13 / API 33, 440 dpi |
| Android emulator / ADB | 31.3.13.0 / platform-tools 33.0.3 |
| Android build SDK / tools | API 33 / build-tools 33.0.1, installed Temurin JDK 17 |

Installation followed the [release README](https://github.com/callstack/agent-device/blob/50e45f11bc6d388d272e672771acc33d9e56921d/README.md), using a pinned local install for the isolated harness instead of modifying the global CLI.
`doctor` completed with no hard blockers; its warnings concerned unavailable HarmonyOS and Vega tools, outside M0's platforms.
The tag's source package calls itself `0.21.27-dev`; the executed npm package reports `0.21.27`.
The earlier planning source commit `3d48bb99` was not treated as proof of runtime behavior.
The installed bundle's daemon takeover logic and public declarations were cross-checked against the corresponding tagged source.
No upstream code has been vendored into production yet.

Useful source locations at that tag:

- `packages/contracts/src/client-capture.ts`, `client-device-view.ts`, and `client-connection.ts`: public response and selection fields.
- `src/client/client-normalizers.ts` and `src/agent-device-client.ts`: implicit-session metadata and response normalization.
- `packages/daemon-contracts/src/daemon-resolution.ts`: installed-package state paths.
- `src/daemon-client/daemon-client-metadata.ts` and `daemon-launch-spec.ts`: passive version metadata and takeover behavior.
- `packages/capture-kit/src/snapshot-rect-projection.ts`: upstream rectangle projection.
- `packages/platform-android/src/screenshot.ts`: Android screenshot stabilization and demo-mode side effects.
- `packages/platform-apple/src/core/screenshot.ts`: simulator density and optional status-bar normalization.
- `android/snapshot-helper/src/main/java/com/callstack/agentdevice/snapshothelper/AccessibilityTreeXml.java`: Android accessibility bounds acquisition.

## Coordinates and capture behavior

| Observation | Runtime result | Consequence |
|---|---|---|
| Android regular snapshot | Viewport 1080 × 2220; colored bounds match PNG pixels exactly | Use 1:1 projection for unscaled Android captures |
| iOS native screenshot | Viewport 402 × 874; requested density 3 produces 1206 × 2622 | Multiply point rects by 3 in this configuration |
| iOS default screenshot | 402 × 874 at density 1 | Native density must be requested explicitly |
| iOS compatibility diagnostic | Viewport 390 × 844; screenshot 1206 × 2622 | Density alone is insufficient when app and device coordinate extents differ |
| Regular partial targets | Both platforms return already-clipped visible rectangles | Crossing a screen boundary cannot always be detected from those rectangles |
| Raw iOS tree | Original partial bounds preserved; public `viewport` absent | A different tree shape is not a drop-in fix for regular capture/check semantics |
| Raw Android tree | Partial bounds still clipped | Raw mode does not recover original off-screen extents |
| Stable fixture | Snapshot nodes match before/after after removing refs | Verified only for this fixed fixture; M5 still owns retries and stability policy |
| Ref generation | Generation changes across observation-only snapshots | T2's stale-ref warning remains necessary |

The fixture places elements near the top and bottom system regions and both horizontal edges, with deliberately clipped left and bottom targets.
The iOS partial-left source frame is `(-20, 360, 120, 60)` and the regular snapshot returns `(0, 360, 100, 60)`.
Android's corresponding source frame is `(-40, 720, 240, 120)` and both regular and raw snapshots return `(0, 720, 200, 120)`.
No field in the observed Android responses supplies the original extent.
A fully missing target still cannot be drawn; nothing in this spike changes the annotation-target error rule.

The compatibility diagnostic came from the initial Swift link using macOS SDK 15.2 metadata despite an iOS simulator target.
Explicit simulator SDK linkage in `build-fixtures.py` corrected this to SDK 18.2 and restored the native 402 × 874 layout.
The earlier neutral pair is retained in `ios-compat` because it demonstrates a real failure of density-only projection.
Its projection uses PNG width/viewport width and PNG height/viewport height, matching the colored pixels within one pixel.
This does not establish support for iPad Split View, arbitrary window origins, foldables, rotation changes, or physical devices.

Android's default screenshot path temporarily enables demo mode, changes the clock to 9:41, hides notification icons, and waits one second before capture.
It restores live status-bar presentation afterward, so equal before/after trees alone would miss this change inside the image.
The final capture harness explicitly passes `stabilize: false` and `normalizeStatusBar: false` to preserve the observed surface, using `wait({stable: true, quietMs: 500, timeoutMs: 60000})` separately.
M5 must preserve this separation.
A cold Android helper exceeded the default ten-second stable-wait budget once; the explicit sixty-second spike budget passed.
When specifying `timeoutMs` in this version's wait API, `quietMs` must also be supplied.

The optional Android `overlayRefs` plus half-scale experiment produced a 540 × 1110 PNG but no ref overlays for these static labels.
Therefore the previously suspected upstream overlay scaling bug was neither reproduced nor disproved.
Device-proof's own native coordinate experiment does not depend on upstream ref overlays.

## Session attachment and daemon protection

The CLI opened the fixtures from this repository's worktree.
The Node client used `createAgentDeviceClient({cwd: repositoryRoot, lockPlatform: platform})`, passed `platform` to snapshot/wait, and omitted an explicit session.
Both iOS and Android implicit sessions were active together, and the client read the intended fixture on each platform.
Using `lockPlatform` is necessary to carry platform selection through calls such as `capture.screenshot`, whose public options do not include `platform`.
The returned addresses were `cwd:<worktree hash>:ios` and `cwd:<worktree hash>:android`.
Opening from the harness subdirectory and reading from the repository root also attached to the same worktree-scoped session.

Explicit CLI sessions `m0-ios-named` and `m0-android-named` were then read by clients configured with those exact session names.
The snapshot and screenshot responses both named the requested session, and the listed device matched the intended neutral device.
Named snapshots and images are retained next to each native capture pair.
The harness closed its named sessions after checking them.

For this native Android fixture, the harness supplies `--activity .FixtureActivity` when opening it.
A package-only open reported success while the launcher or previously restored app remained foregrounded; direct component launch and explicit CLI activity selection worked.
Capture metadata's app identifier is therefore insufficient by itself to prove that the intended app is visible.
The harness additionally checks for neutral target identifiers before writing evidence.
Production capture must report unexpected/missing targets rather than navigate to repair the app.

Before importing or calling the Node client, the M0 guard reads the isolated installed daemon's `daemon.json` directly and checks `version`, installed code origin, and process liveness.
It does not call `sessions.list`, `doctor`, or another client method to discover the version.
In this version, the installed default directory is `~/.agent-device`, overridden by `AGENT_DEVICE_STATE_DIR`; source checkouts use a different default path.
The guard intentionally supports only the explicitly isolated installed-package case exercised here.

A real 0.21.26 daemon held the disposable Android session while the 0.21.27 guard was invoked.
The guard returned `DAEMON_VERSION_MISMATCH`, naming both versions, before any newer-client call.
The daemon metadata stayed byte-identical, its PID and start time stayed unchanged, its session inventory stayed equal, and the original 0.21.26 client successfully captured the fixture afterward.
The independent 0.21.27 daemon also retained its original identity.
No daemon metadata was edited to simulate the mismatch.

This verifies the preflight mechanism, not a complete production race guarantee.
M5 must handle default and explicit path resolution, malformed/missing metadata, a daemon changing between preflight and transport dispatch, and code-origin mismatches without invoking replacement as an accidental recovery action.
Remote daemons and checkout clients remain unverified.
The safeguard cannot rely on version equality alone for a checkout versus installed-package mismatch: the reviewed upstream also compares code origin/signature.

## Build and environment provenance

The public capture response does not supply everything needed for T27 and T28.
The following distinction is verified through the recorded responses and supplemental local device probes.

| Needed fact | Public runtime evidence | Additional evidence used here |
|---|---|---|
| App/package identity | Snapshot and `command.appState` | Neutral target identifiers verify actual fixture content |
| Device identity | `sessions.list` supplies selected device; capture identifiers may contain only session/app | Join the selected session to `devices.list` |
| OS and hardware model | `devices.list` supplied model and OS on both tested devices | Android build fingerprint from ADB |
| Screenshot geometry | PNG dimensions; iOS logical size/density; Android portrait rotation | Read actual PNG header and compare snapshot viewport |
| Native iOS display density | Default screenshot reports requested output density 1 | `simctl io ... enumerate` reports integrated display size and preferred UI scale 3 |
| Android display density | Snapshot `androidSnapshot.pixelDensity` is 2.75 | `adb shell wm density` is 440 dpi; do not multiply pixel rects by 2.75 |
| Appearance and text size | Absent from tested capture responses | iOS `simctl ui` appearance/content size; Android settings probes |
| Installed app version | Absent from tested capture responses | iOS installed Info.plist; Android package metadata |
| Build content identity | Absent from tested capture responses | Installed iOS executable/Info.plist SHA-256 and installed APK SHA-256 |
| Tool identity | Installed npm package and passive daemon metadata | Harness lockfile and source tag recorded above |

The installed Android APK hash equals the locally built APK hash.
The fixture source hashes and installed iOS executable hash are recorded in `provenance.json`.
These prove provenance for the fixture; version names, install timestamps, and package identifiers alone do not prove unchanged app behavior.
Rebuilding or changing an OTA/Metro JavaScript bundle can leave the native app version unchanged.
Neither a screenshot nor a package identifier identifies the semantic extent of an affected verification flow.

M1 must define caller-supplied immutable build/revision provenance, including runtime bundle identity where relevant, before automatic reuse is enabled.
It must also define how that identity applies to the affected flow.
No field names, fallback policy, or affected-flow boundaries have been approved in this spike.
Unknown identity must not be interpreted as an unchanged build.
Likewise, absent appearance, text-size, native-density, or persistent device identity must not silently establish T28 compatibility.
An emulator serial can be reused by a different AVD, so it is insufficient alone as durable identity.
The supplemental native probes demonstrate available local facts; they do not authorize a new production adapter interface or assume that physical/remote devices expose the same facts.

## Reproduction

Run commands from the repository root unless the block explicitly changes directory.
Use dedicated simulator/AVD targets; the setup below creates its own fixture devices and daemon state.
The harness is private and separate from M1's future package.
The main dependencies are reproducible with `npm ci` from the committed lockfile.

```sh
cd scripts/m0
npm ci --ignore-scripts --no-audit --no-fund
npm install --prefix .local/older --save-exact agent-device@0.21.26 --ignore-scripts --no-audit --no-fund
git clone --depth 1 --branch v0.21.27 https://github.com/callstack/agent-device.git .local/upstream
AGENT_DEVICE_STATE_DIR="$PWD/.local/state" node node_modules/agent-device/bin/agent-device.mjs doctor --json
cd ../..
python3 scripts/m0/build-fixtures.py ios
python3 scripts/m0/build-fixtures.py android
python3 scripts/m0/prepare-android.py
```

The builders require Xcode, the simulator runtime, JDK 17, Android SDK platform 33, and build-tools 33.0.1 to be installed.
The Android SDK defaults to `~/Library/Android/sdk`; `ANDROID_HOME` can override it.
They do not fetch build dependencies or contact a service.
The generated Android signing key is fixture-only and stays ignored.

```sh
M0_IOS_UDID=$(xcrun simctl create 'Device Proof M0' com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro com.apple.CoreSimulator.SimRuntime.iOS-18-3)
xcrun simctl boot "$M0_IOS_UDID"
xcrun simctl bootstatus "$M0_IOS_UDID" -b
xcrun simctl install "$M0_IOS_UDID" scripts/m0/.local/build/DeviceProofFixture.app
ANDROID_AVD_HOME="$PWD/scripts/m0/.local/avd" "$HOME/Library/Android/sdk/emulator/emulator" -avd DeviceProofM0 -no-snapshot -no-window -no-audio -port 5580
```

Keep the emulator running in its terminal and continue in another terminal after `adb -s emulator-5580 shell getprop sys.boot_completed` returns `1`.
Use the dedicated iOS UDID returned above in that terminal.

```sh
adb -s emulator-5580 install --no-incremental -r scripts/m0/.local/build/fixture.apk
node scripts/m0/open-fixtures.mjs "$M0_IOS_UDID" emulator-5580
node scripts/m0/capture.mjs ios
node scripts/m0/capture.mjs android
node scripts/m0/experiments.mjs ios
node scripts/m0/experiments.mjs android
node scripts/m0/session-checks.mjs
node scripts/m0/guard-check.mjs
python3 scripts/m0/provenance.py
node scripts/m0/verify-geometry.mjs
cmux browser open "file://$PWD/docs/prototypes/capture-spike/index.html" --focus true
```

`session-checks.mjs` closes the implicit fixture sessions, tests named sessions, and closes those named sessions.
The mismatch experiment uses its own `.local/mismatch-state` daemon and closes its disposable session afterward.
The command sequence intentionally drives only the neutral fixture; production device-proof remains capture-and-verify only.
`verify-geometry.mjs` is offline and also verifies the retained compatibility diagnostic without requiring its earlier mislinked app to be reinstalled.
The compatibility pair records the initial SDK-linking experiment, not the corrected builder's current output.

## Remaining gate

The partial-visibility requirement cannot be implemented literally from the observed Android rectangles.
The pending recommendation is to keep regular snapshots and upstream check semantics, draw the reported visible bounds, and issue a precise uncertainty warning for targets touching a viewport edge.
Such a warning would also cover intentionally edge-aligned targets and must not falsely assert proven clipping.
The user was asked to approve this refinement after the rendered results were shown in cmux.
Until resolved, M0's foundational-assumption gate remains open and dependent production implementation must wait.
Build identity and supplemental environment fields remain the explicitly assigned M1 contract review work, supported by the findings above.
