# device-proof: technical design

Status: M0 runtime findings are recorded in [CAPTURE-SPIKE.md](CAPTURE-SPIKE.md); remaining gates and contract work are tracked in [PLAN.md](PLAN.md).
Requirements live in [REQUIREMENTS.md](REQUIREMENTS.md).
Facts about agent-device come from reading its source at commit `3d48bb99` (2026-10-14).
The findings below preserve that initial source review; [CAPTURE-SPIKE.md](CAPTURE-SPIKE.md) distinguishes verified 0.21.27 behavior from assumptions and limitations.
In particular, viewport projection, already-clipped target bounds, screenshot stabilization, and supplemental provenance require the refinements documented there.

## Findings from agent-device source

These answer the open questions in the requirements.

### Selector and `is` reuse

- `agent-device/selectors` publicly exports pure selector functions over a snapshot the caller already holds: `parseSelectorChain`, `listSelectorChainMatches`, `resolveSelectorChain`, `formatSelectorFailure`.
- The `is` evaluator (`evaluateIsPredicate`, `packages/selectors/src/internal/predicates.ts`) and the visibility model it needs (`createSnapshotVisibility`, `packages/contracts/src/snapshot-visibility.ts`) are internal.
- The public `client.interactions.is()` runs its own capture, throws on failure, and strips the matched node and rect from the response, so it cannot drive drawing.
- The CLI's `is` also merges iOS React Native double-reported elements and refuses to prove `absent` on truncated, sparse or unsettled captures.
  The public `resolveSelectorChain` does neither.

### Coordinates

- Android: snapshot rects are physical pixels and map 1:1 to the screenshot, status bar included.
- iOS: snapshot rects are points.
  Screenshots are 1x by default; passing `pixelDensity` gives native resolution, and rects are multiplied by the density.
- `capture.snapshot` returns `viewport: {width, height}` (no origin), the box rects are measured in.
- agent-device's own projection (`projectSnapshotRectToScreenshot`) and overlay drawing are internal.
- Unverified: `--overlay-refs` with `--scale` on Android appears mis-mapped.

### Recording

- `record stop` returns `telemetryPath`, a JSON file of gesture events with `tMs` (ms from recording start) and x/y points.
- The session action log stores each action's target rect, role, label and id (`TargetAnnotationV1`), readable via `.ad` scripts and `client.observability.events`.
- agent-device burns touch overlays into video on macOS hosts only.

### Session model

- The Node client talks to the same daemon as the CLI.
  Requests are serialized per session and per device.
- A public `snapshot` starts a new ref frame, so the agent's `@eN` refs go stale after device-proof captures.
- `noRecord` exists on snapshot, get, is and find, but not on screenshot.
- The client defaults to session `"default"`; the CLI scopes its implicit session by worktree and platform.

## Decisions

### T1. Assertion evaluation: vendored

Copy agent-device's predicate, visibility, absence and React Native merge code (MIT) into `src/vendor/agent-device/`.
Keep the LICENSE and a header naming the source commit in each file.
Copy the matching upstream unit tests to prove parity.
A sync script diffs the vendored files against a chosen upstream version.
Send an upstream PR exporting these from `agent-device/selectors`, then delete the vendored copy and import instead.

### T2. Session: the agent's own

Capture from the agent's session with `noRecord` on snapshots.
The skill tells agents that refs are stale after a capture and to use selectors.

### T3. iOS resolution: native density

Capture at native pixel density so annotation text and lines stay crisp.
A later `--scale` option may shrink output after drawing.

### T4. Rendering: SVG plus `@resvg/resvg-wasm`

Generate one SVG containing the screenshot and the annotations, rasterize with resvg-wasm (about 2.5 MB, no native binaries).
Pass the bundled font via `fontBuffers`; WASM cannot load system fonts, so output is identical on every OS.
device-proof's own code owns layout: anchoring, label placement, collision avoidance and contrast.

### T5. CLI

```
device-proof capture <spec.yaml> --step <name>
device-proof capture --box 'id="x"' --criterion "The expected control is visible" -o shot.png
device-proof validate <spec.yaml>
```

`validate` needs no device.
There is no `report` command (T14).
One-off captures require `--criterion` and validate it before contacting the device (T23).

### T6. Spec structure

```yaml
out: evidence/cart                # optional, default evidence/<spec-name>
criteria:
  - criterion: "Cart total updates when quantity changes"
    steps:
      before:
        annotate: [ ... ]
      after:
        annotate:
          - arrow: { to: 'id="cart-total"', text: "Total: £12.00", expect: { text: "£12.00" } }
```

Step names are unique across the file.
T42 defines their portable filename format.
T44 defines the base directory for relative output paths.
The spec never contains actions.

### T7. Output per step

- `<step>.png`: annotated.
- `<step>.raw.png`: unannotated.
- `<step>.snapshot.json`: the snapshot used.
- `manifest.json`: shared, updated after every step.

Raw images and snapshots let anyone audit an annotation against what was captured, and double as test fixtures.

### T8. Stability check

1. `client.command.wait({ stable: true })`.
2. Snapshot, screenshot, snapshot.
3. Compare the two snapshots, ignoring refs.
4. If they differ, retry up to 3 times, then return an error.

### T9. Session targeting

Default to passing `cwd` and `platform` exactly as the CLI does, so device-proof attaches to the agent's implicit session with no setup.
`--session <name>` for named sessions.
Needs one runtime test to confirm.

### T10. Testing

- **Unit:** coordinate mapping, selector anchoring, label placement, vendored predicates (with upstream tests), spec validation, stability comparison, outcomes and exit codes.
- **Golden image:** stored screenshot, snapshot and spec inputs rendered and compared pixel for pixel against reviewed reference images.
- **End to end:** a fixture app driven by agent-device on a real iOS simulator and Android emulator in CI (macOS runner for iOS).

### T11. Annotation style: markers and legend

Chosen from three prototypes rendered on a real fortress-mobile-app capture (`prototypes/annotation-style/`).
- On screen: numbered markers and outlined boxes, with white halos for contrast.
  The approved T22 refinement assigns colors to regions and uses result symbols and border styles for outcomes.
- Below the screenshot: a legend panel with the outcome badge, the criterion, and one row per annotation or standalone check (text plus check result, failures showing expected and actual).
  A grouped marker retains a separate legend row for each of its numbers.
- No text covers the UI being proven.
- Arrows stay available as a primitive for direction and gestures.
- `mask` renders as a hatched block labelled "masked".

Prototype findings:
1. iOS anchoring at density 3 landed on the correct pixels for every target (visual check, not automated).
2. Rendering took 365-579 ms per 1179x2556 image including PNG encode; files were 1.6-2 MB.
3. fortress-mobile-app exposes no `identifier`s; one element had no label at all; React Native reported some elements twice.
4. Text width must be measured from glyphs and long text must wrap; the prototype's estimate truncated the criterion.
5. Accessibility rects can differ from what a reviewer sees as the element (the raised Deposit tab).
6. Android was not captured: no APK was available.

### T12. Output stays local

device-proof writes files with relative paths and never uploads or knows about MRs.
Getting evidence into an MR, chat or CI is the caller's job (`fh`, an MR skill).

### T13. One image per step

Each step produces its own annotated image with its own legend.
A combined per-criterion image (steps side by side, shared legend) is a v1.1 candidate for pasting into chat.

### T14. No report.md

Dropped.
Style C's legend makes each image self-explanatory, and `manifest.json` serves machines.
Callers build any summary page from the manifest.

### T15. agent-device is a peer dependency

npm (v7+) and pnpm install it automatically on a fresh install; users who already have agent-device reuse their copy.
Yarn Berry users add it themselves.

Why one copy matters (from `src/daemon-client/daemon-launch-spec.ts`, `resolveDaemonTakeover`):
- A client whose version differs from the running daemon either replaces the daemon (if the client is newer, or the daemon is older) or is refused (`refuseNewer`, if the daemon is newer and alive).
- Replacing the daemon mid-run would drop the agent's live session.

So device-proof, before its first call, compares the agent-device version it resolved with the running daemon's version.
On a mismatch it stops with a clear error naming both versions, instead of letting the client replace the daemon.
This also covers the case of a global agent-device CLI next to a different project-local copy.

### T16. Manifest schema

Audience: machines (the agent, harnesses such as `fh`, CI).
Humans read the annotated images.

```json
{
  "schemaVersion": 1,
  "spec": "evidence/cart.yaml",
  "result": "failed",
  "device": { "platform": "ios", "name": "iPhone 15 Pro", "os": "18.4", "pixelDensity": 3 },
  "versions": { "deviceProof": "0.1.0", "agentDevice": "0.21.27" },
  "criteria": [
    {
      "criterion": "Cart total updates when quantity changes",
      "result": "failed",
      "steps": [
        {
          "step": "after",
          "capturedAt": "2026-10-14T10:02:11Z",
          "result": "failed",
          "image": "after.png",
          "raw": "after.raw.png",
          "snapshot": "after.snapshot.json",
          "annotations": [
            {
              "n": 1, "type": "box", "target": "id=\"cart-total\"",
              "rect": { "x": 30, "y": 60, "width": 300, "height": 132 },
              "expect": { "text": "£12.00" }, "actual": { "text": "£6.00" }, "result": "fail"
            }
          ]
        }
      ]
    }
  ]
}
```

- `rect` is in screenshot pixels.
- `n` matches a number in the image marker and its individual legend row; T22 allows several numbers to share one marker.
- A step that errored carries a structured error; T49 refines this contract to retain completed check results alongside entry errors.
- `capture` prints the step object as JSON to stdout, so the agent need not read the file mid-run.

Result precedence, first match wins, for criteria and for the whole manifest:
1. `error`: any step could not produce evidence.
2. `failed`: any check failed.
3. `incomplete`: any step in the spec has not been captured yet.
4. `passed`: every step captured and every check passed.

Exit codes per `capture`: 0 passed, 1 failed, 2 error.
T26 adds explicit check counts so callers can distinguish assertion-free captures from captures with passing checks.

### T17. Module layout

```
device-proof/
├─ src/
│  ├─ cli/                  # argument parsing for capture and validate; exit codes
│  ├─ spec/                 # YAML loading, zod schema, generated JSON Schema, validation errors
│  ├─ capture/              # agent-device client, session targeting, daemon version check, stability check
│  ├─ resolve/              # selector to node to screenshot-pixel rect; candidates for errors
│  ├─ check/                # runs the vendored predicates; expected, actual, result
│  ├─ layout/               # marker placement, legend rows, text measuring and wrapping (pure)
│  ├─ render/               # SVG building and resvg-wasm rasterising, bundled Inter font
│  ├─ manifest/             # read and update manifest.json, result precedence
│  ├─ vendor/agent-device/  # vendored check code, LICENSE, source commit
│  └─ index.ts              # Node API: capture(), validate()
├─ skills/device-proof/SKILL.md
├─ test/{unit,golden,e2e,fixtures}/
└─ scripts/sync-vendor.ts
```

Everything except `capture/` and `cli/` is pure: no device, no file writes.
Text is measured from the bundled Inter font's glyph widths with `opentype.js`.
The spec schema is defined in zod; the JSON Schema file is generated from it.

### T18. Skill

- Lives in the GitHub repo at `skills/device-proof/SKILL.md`, with `name` and `description` frontmatter.
- Not in the npm package, matching agent-device.
  Users install it with `npx skills add <owner>/device-proof` (Vercel's `skills` CLI), which clones the repo, finds `SKILL.md` in standard locations, and installs it into the chosen agents at project or global scope.
  No catalog publishing is required; pushing to the repo is the release.
- Kept short and stable: when to use device-proof, prerequisites (agent-device and its skill), the workflow, outcome rules, integrity rules, and masking.
- Outcome rules: passed means done; failed means fix the app; error means fix the selector, spec or add a `testID`, never change app behavior to clear an error.
- Integrity rules: never edit images or `manifest.json` by hand; never weaken an `expect` to turn a failure into a pass (change it only if the criterion was misread, and say so); report failures as they are.
- The detailed, version-specific reference (spec format, annotation types, checks, examples) lives in `device-proof help`, which ships with the binary.

### T19. Standalone absence checks

Agreed on 2026-10-14 during implementation-plan review.
Steps may contain standalone checks, so an `absent` expectation does not require a drawable annotation target.
A successful absence check appears in the legend without an on-screen marker.
Annotations still require a drawable target: asking to box a missing element is an evidence error, while successfully proving that element absent is a passing check.
T36 defines the spec fields for standalone checks; their manifest representation remains contract-review work.

### T20. Nearby annotation markers

Agreed on 2026-10-14 during implementation-plan review.
When targets are nearby, place their numbered badges on separate outer edges so the badges remain distinguishable.
Keep each box anchored to its actual target bounds.
T22 defines the approved color and identical-bounds treatment.

### T21. Detail-view fallback for dense overlap

Agreed on 2026-10-14 during implementation-plan review.
For dense overlapping annotations, retain a numbered overview and add individual detail views beneath it, each highlighting one target with its corresponding checks.
All views come from the same captured frame and remain in one evidence image per step.
The user accepted this fallback after reviewing the five-target prototype.
Activate the fallback for a connected overlap group containing three or more distinct resolved targets.
Overlap means positive shared area in the visible target rectangles, including containment; touching edges alone do not count.
Connections are transitive: A overlapping B and B overlapping C makes one group.
Multiple checks on the same resolved target count as one target, while distinct targets with identical rectangles remain separate targets.
Only the qualifying groups receive detail views; unrelated annotations retain their normal presentation.

### T22. Region colors, explicit results, and grouped tags

Agreed on 2026-10-14 after reviewing the [grouped-tag prototype](prototypes/annotation-overlap/grouped.png).
This refines T11: color identifies a highlighted region instead of encoding pass or failure.
Different regions use distinct colors, while identical rendered rectangles share one color and one outline.
Retain white halos so annotation edges and tags remain distinguishable from matching app backgrounds.

Identical bounds use one tag containing the individual annotation/check numbers and their own result symbols, such as `1 ✓, 2 ×, 5 ✓, 9 ✓`.
Every check retains its own legend row with explicit PASS or FAIL wording; failures include expected and actual values.
For checked regions, use a solid outline when all attached checks pass and a dashed outline when any attached check fails.
The dashed shared outline indicates at least one failure, while the tag and legend identify the individual failed checks.
Long tags wrap or move outside the target with a connector, keeping all numbers visible.

Grouping affects drawing only; selectors, resolved component identities, and individual check results remain separate.
Equal rectangles do not establish that two selectors refer to the same component.
The dense-overlap threshold in T21 remains based on distinct resolved targets, not the number of shared outlines.
T25 defines the presentation of annotations without checks.

### T23. Required criterion for one-off captures

Agreed on 2026-10-14 during implementation-plan review.
One-off captures require a non-empty `--criterion` argument, just as YAML captures require a criterion.
Reject missing or blank criteria as validation errors before contacting the device.
Use the supplied criterion verbatim in the normalized capture spec, image legend, and manifest.
Do not infer it from the selector or output filename.

### T24. Hidden checks without drawable targets

Agreed on 2026-10-14 during implementation-plan review.
A successful standalone `hidden` check appears in the legend without an on-screen marker when there is no visible target to mark.
This extends the absence-check presentation in T19 without changing the upstream predicate's semantics.
Explicit drawing annotations continue to require drawable targets.

### T25. Informational annotations

Agreed on 2026-10-14 after reviewing the [informational annotation prototype](prototypes/annotation-overlap/info.png).
An annotation without an assertion displays its number without a checkmark or cross and has an INFO legend row.
A region with no attached checks uses a dotted outline.
A region that also has checks retains T22's solid/all-pass and dashed/any-failure rule.
Informational entries keep their numbers without result symbols inside a shared tag, such as `1, 2 ✓, 3 ×`.
INFO describes context that was highlighted; it does not represent a passing test.

### T26. Explicit check counts

Agreed on 2026-10-14 during implementation-plan review.
Report total evaluated checks, passed checks, and failed checks in the manifest.
The total represents checks that completed evaluation with a pass or fail result, so total equals passed plus failed.
A passing check met its expectation; a failing check was evaluated and did not meet its expectation.
Informational annotations do not count as checks.
Checks in uncaptured steps do not count as having run.
An evidence-production error remains an error under T16 and must not be manufactured into a failed assertion.
Expose counts for steps and aggregate them for criteria and the manifest from the current recorded results, without counting replaced captures twice.
The existing result precedence and exit codes remain unchanged; zero checks must be explicit even when the successful capture result is `passed`.

### T27. Selective evidence reuse after spec changes

Agreed on 2026-10-14 during implementation-plan review.
Meaningful spec edits do not require restarting every capture or choosing a new output folder.
Retain evidence for unaffected steps and invalidate results affected by the changed spec.

- A change to a step's selector, annotation, or check invalidates that step.
- A newly added step is incomplete until captured; unaffected existing steps retain their evidence.
- A change to a criterion or shared setting invalidates every step affected by it.
- Changes to comments or formatting alone do not invalidate evidence.

An invalidated step must be captured again before its result can contribute to the current criterion or manifest outcome.
Exclude its old results from current check counts and treat it as incomplete under T16.
Preserve the original capture time and provenance for reused evidence so reuse does not imply a fresh observation.

Spec compatibility alone cannot establish that the app is unchanged.
When the app build changes, recapture the affected verification flow even if its spec text is unchanged.
The mechanism for identifying app builds and the extent of an affected flow must be established before enabling automatic reuse; inspect the available runtime metadata during M0.
Do not infer unchanged app behavior solely from unchanged selectors or expectations.
T28 defines device and tool-version compatibility.
T29 defines retention of superseded files.

### T28. Environment compatibility for evidence reuse

Agreed on 2026-10-14 during implementation-plan review.
Reuse requires the same device configuration and the same device-proof and agent-device versions.
A change of platform or device, OS version, display configuration, or either tool version requires fresh captures for the run.
Old results must not contribute to the current run's outcomes or check counts after such a change.
Ordinary app navigation between steps is expected and does not itself invalidate earlier evidence.
M0 establishes the metadata needed to identify the device and its relevant configuration reliably.
T27 separately governs spec changes and changed app builds.

### T29. Bounded local evidence history and cleanup

Agreed on 2026-10-14 during implementation-plan review.
When a step is captured again, retain the superseded attempt as local history, subject to configurable retention limits.
Only the current attempt contributes to the current manifest's results and check counts; a newer error supersedes an older pass as the current result.

Default history limits per output folder:

- At most three previous attempts per step.
- Historical attempts expire seven days after their recorded capture time.
- Historical artifacts have a combined 500 MB budget; remove oldest historical attempts first when over budget.

T43 defines the spec fields for configuring these limits.
All limits apply together, so the count or size limit may remove an attempt before it reaches seven days old.
Current attempts are protected from automatic history cleanup, regardless of age or size.
The history budget covers package-managed historical screenshots, snapshots, and any package-managed recording copies.
Referenced external recordings remain caller-owned and are never deleted by history cleanup.

Run history cleanup after a new attempt and its manifest update are safely saved, and when the dedicated cleanup command is invoked.
There is no background timer or cleanup daemon.
Use the stored capture timestamp and the current clock to calculate elapsed age; seven days means seven times 24 hours, not a file modification date or a calendar-date boundary.
Expired files in an idle output folder remain until the next capture or cleanup command.

Provide a dedicated cleanup command with a deletion preview before applying explicit cleanup, including cleanup of finished runs' current evidence.
Delete only managed artifacts eligible for the selected cleanup scope and preserve artifacts still referenced by protected current attempts.
Document retention configuration, opportunistic cleanup, and finished-run cleanup in CLI help and the agent skill.

### T30. Exclusive access to an evidence folder

Agreed on 2026-10-14 during implementation-plan review.
Allow one capture or cleanup command at a time per evidence output folder.
A second command targeting the same folder fails immediately with a clear folder-busy error and exit code 2.
It does not wait silently, capture from the device, or change that folder's manifest or artifacts.
Report the busy error to the caller without overwriting evidence owned by the active command.
Hold exclusive access through the command's safe completion, including manifest updates and automatic history cleanup.
This prevents lost updates and avoids silently delaying a capture until the app may have moved to a different screen.

### T31. Uncertain clipping at screen edges

Agreed on 2026-10-15 after reviewing the M0 capture findings.
Keep regular snapshots and the upstream check semantics.
Draw the visible bounds reported by the snapshot and allow captures of targets touching a viewport edge.
When the original extent is unavailable, show the warning "Touches screen edge; full extent unknown" for those targets.
This warning also applies to intentionally edge-aligned elements because the available bounds cannot distinguish them from partially off-screen elements.
It describes uncertainty and must not assert that clipping is proven.
The warning alone does not fail an assertion or turn a capture into an evidence error.
Missing or fully off-screen annotation targets retain the existing evidence-error behavior.
Where the captured geometry proves partial clipping, retain the existing partial-visibility warning.

The M0 HTML uses coordinate diagnostics rather than the production annotation design.
T11 and T19-T25 remain the approved visual rules for M3 and M4, including region colors, grouped result tags, INFO presentation, and the legend below the capture.

### T32. One verification flow per spec

Agreed on 2026-10-15 during M1 contract review.
Each spec file represents one verification flow with a shared app-build identity.
The caller identifies the native build and any separately delivered JavaScript or OTA bundle.
A change to either identity invalidates every captured step in that spec, across all its criteria.
Other spec files remain independent verification flows.
Spec-only edits retain the selective invalidation rules in T27.

For example, changing the app build between a cart's `before` and `after` captures requires recapturing both steps.
Editing only the `after` assertion invalidates only `after`.
T33 defines behavior when identity is unavailable, and T34 defines the provenance fields and input mechanism.

### T33. Build identity required for multi-step captures

Agreed on 2026-10-15 during M1 contract review.
Capturing a step from a spec containing multiple steps requires complete build identity for the flow defined in T32.
Missing or incomplete identity produces an actionable validation error before contacting the device, explaining what is missing.
A single-step spec or one-off capture may omit build identity because it produces fresh evidence without combining observations from different captures.
Evidence with unknown build identity is never automatically reused.
T34 defines the representation of complete identity.

### T34. Separate caller-supplied build identity

Agreed on 2026-10-15 during M1 contract review.
The CLI accepts build identity through a separate JSON file supplied with `--build <file>`.
The Node API accepts the same object directly.
Keep this identity separate from the reusable verification spec.

```json
{
  "appId": "com.example.shop",
  "native": "sha256:<native-build-hash>",
  "runtime": { "kind": "embedded" }
}
```

`appId` identifies the app, and `native` identifies the installed native build.
Use `runtime: { "kind": "embedded" }` when the native build identity covers the runtime code.
For separately delivered JavaScript or OTA code, use `runtime: { "kind": "external", "revision": "sha256:<bundle-hash>" }`.
Explicitly declaring the runtime kind prevents an omitted bundle identity from silently appearing complete.
Identity values may be content hashes or immutable build-system identifiers.
The caller must identify the actual installed build and running bundle; a version label or source revision alone does not establish unchanged runtime code.
Schema validation checks the supplied structure and required values; it cannot prove that the supplied identities describe the running app.

For example, `device-proof capture cart.yaml --step before --build build.json` supplies the flow's identity for that capture.
Automated generation of this file, including convenient integration with development builds, has not been implemented or specified.

### T35. Complete environment identity for multi-step captures

Agreed on 2026-10-15 during M1 contract review.
Multi-step captures stop with an actionable error when device configuration cannot be established reliably for the compatibility checks in T28.
Report which required details are unavailable, such as persistent device identity, OS, or text-size settings.
Fresh single-step captures remain allowed where capture itself is possible, recording unavailable details as unknown.
Evidence whose environment compatibility cannot be established is never automatically reused.
Unknown values must not compare as evidence of an unchanged environment.

Unlike the caller-supplied build identity checked offline under T33, environment identity may require device metadata collection.
This rule does not promise detection before contacting the device.
It also does not relax the geometry requirements needed to produce correctly anchored evidence.
The exact environment fields and unavailable-metadata representation remain M1 contract work.

### T36. One predicate per expectation

Agreed on 2026-10-15 during M1 contract review.
Each `expect` contains exactly one check.
Additional checks use separate entries, even when they target the same element.
Steps accept standalone checks through a `checks` array, with each entry containing `target` and `expect`.

```yaml
checks:
  - target: 'id="cart-total"'
    expect: { visible: true }
  - target: 'id="cart-total"'
    expect: { text: "£12.00" }
  - target: 'id="error-banner"'
    expect: { absent: true }
```

State checks use `true` with one of `visible`, `hidden`, `exists`, `absent`, `editable`, `selected`, or `focused`.
Text checks use `text` with the expected string.
Each check retains its own PASS or FAIL result and contributes one evaluated check when evaluation completes, under T26.
The same single-check rule applies to expectations inside annotations.
An annotation without `expect` remains INFO under T25.
This defines the input shape without changing upstream predicate semantics or the drawing requirements in T19 and T24.

### T37. Annotation input shapes

Agreed on 2026-10-15 during M1 contract review.
Steps accept annotations through an `annotate` array.
Each entry contains exactly one of `box`, `marker`, `arrow`, `callout`, or `mask`, with the annotation settings nested beneath that key.

```yaml
annotate:
  - box:
      target: 'id="cart-total"'
      expect: { text: "£12.00" }
  - marker:
      target: 'id="checkout"'
  - arrow:
      to: 'id="quantity"'
      text: "Quantity control"
  - callout:
      target: 'id="delivery"'
      text: "Selected delivery option"
  - mask:
      target: 'id="account-number"'
```

Boxes, markers, callouts, and masks identify their target with `target`; arrows use `to`, preserving T6's syntax.
All five support an optional single-check `expect`, as defined in T36.
`text` is required for arrows and callouts, and optional for boxes, markers, and masks.
User-supplied text appears in the legend, following the approved visual rules in T11 and T19-T25.
Annotations without expectations remain INFO.
Every explicit annotation continues to require a drawable target, including when it carries an absence or hidden check.
Mask rendering retains T11's fixed "masked" label.

### T38. Crop to targets while preserving drawable evidence

Agreed on 2026-10-15 during M1 contract review after reviewing the [neutral crop preview](prototypes/crop-contract/index.html).

```yaml
crop:
  targets: ['id="cart-total"']
  padding: 24
```

`crop.targets` requires at least one selector.
Crop to the combined bounds of those targets and all drawable annotation/check targets, so cropping preserves the evidence.
Add configurable padding of 24 screenshot pixels by default, limiting the crop to the screenshot bounds.
Padding is a non-negative integer; zero is allowed.
Missing, ambiguous, or fully off-screen explicit crop targets produce an evidence error.
The existing partial-visibility and edge-uncertainty rules continue to apply.
Omitting `crop` retains the full screenshot when no shared crop default applies; T40 defines inheritance and explicit full-frame overrides.
Raw screenshots and snapshots remain complete, and the production legend sits below the cropped image under T11.
The preview establishes crop geometry only; production annotation rendering remains governed by the previously approved visual rules.

### T39. Match evidence by unique step name

Agreed on 2026-10-15 during M1 contract review.
Use each step's file-wide unique name to match it with earlier evidence in the flow.
Renaming a step creates a new, incomplete step requiring capture, even when its checks are identical.
Removing a step excludes its results from current outcomes and check counts and moves its evidence into bounded history under T29.
Reordering steps or criteria preserves evidence when the criterion wording and effective step settings remain unchanged.
Changing the step's criterion invalidates its evidence under T27.
Build and environment compatibility remain required under T32-T35.

For example, renaming `after` to `updated-total` requires a new capture.
Matching does not infer identity from similar names or identical checks.
T40 defines inherited settings; the complete normalized effective step configuration remains M1 implementation work.

### T40. Shared crop defaults and explicit step overrides

Agreed on 2026-10-15 during M1 contract review.
Crop is the only inherited setting in v1.
The spec may define a shared crop under `defaults.crop`.
Annotations and checks remain explicit within each step.

```yaml
defaults:
  crop:
    targets: ['id="cart"']
    padding: 24

criteria:
  - criterion: "Cart total updates when quantity changes"
    steps:
      before: {}
      after:
        crop: null
```

A step that omits `crop` inherits the shared default, or uses the full screenshot when no default exists.
Setting a step's `crop` to `null` explicitly selects the full screenshot.
A step's own crop object replaces the entire default crop.
Omitted padding in that object uses T38's default of 24 screenshot pixels, regardless of padding in the shared default.
Changing the shared default invalidates only steps whose effective crop changes.

### T41. Structural JSON Schema and complete offline validation

Agreed on 2026-10-15 during M1 contract review after verifying the JSON Schema export limitation recorded in [PLAN.md](PLAN.md).
Generated JSON Schema checks fields, types, required values, and annotation combinations.
The shared offline validator additionally checks rules spanning the file, including unique step names across criteria.
The CLI and capture preflight use that complete validator.
An editor's JSON Schema check may therefore accept a file that `device-proof validate` rejects.
Document this distinction explicitly in the generated schema and validation guidance.

Keep parity tests for structural rules and separate tests proving complete validation rejects semantic errors that the structural schema accepts.
This qualifies M1's original unqualified zod/JSON Schema parity requirement without relaxing the unique-step-name rule or the requirement that validation work offline.

### T42. Portable step names

Agreed on 2026-10-15 during M1 contract review.
Step names contain 1 to 64 ASCII characters, start with a lowercase letter, and otherwise contain only lowercase letters, digits, hyphens, and underscores.
Examples include `before`, `after`, and `cart-total-2`.
Reject reserved filenames: `con`, `prn`, `aux`, `nul`, `com1` through `com9`, and `lpt1` through `lpt9`.
These names remain reserved when an extension is appended, as documented in [Microsoft's filename rules](https://learn.microsoft.com/windows/win32/fileio/naming-a-file).
Other reserved forms containing punctuation or non-ASCII digits already fail the character rule.

Apply the same rule to spec step keys and one-off capture names.
Reject invalid names with a field location; preserve valid names verbatim instead of silently renaming them.
Lowercase names prevent case-only collisions, and excluding dots and path separators prevents artifact-suffix collisions and directory traversal through step names.
T39's uniqueness and evidence-matching rules remain in force.

### T43. Spec-level history retention settings

Agreed on 2026-10-15 during M1 contract review.
Configure history once per spec using a top-level `retention` object:

```yaml
retention:
  maxAttemptsPerStep: 3
  maxAgeDays: 7
  maxBytes: 500000000
```

Omitting the object or any field uses the defaults above.
Values must be nonnegative safe integers, with no coercion from strings or other types.
All limits apply together; setting any limit to zero disables history.
`maxAttemptsPerStep` counts previous attempts only, excluding the current attempt.
`maxAgeDays` uses elapsed 24-hour days from capture time, and `maxBytes` measures actual bytes across managed historical artifacts in the output folder.
The default byte budget is 500 MB in decimal units.

Current evidence and caller-owned recordings remain protected under T29.
Retention settings control history cleanup and do not change a step's effective capture configuration or invalidate otherwise reusable evidence.
Saving a spec alone never deletes history; T29's safe-save and explicit-cleanup triggers still apply.
History eligibility and filesystem cleanup remain M2 and M5 work respectively.

### T44. Output paths relative to the spec

Agreed on 2026-10-15 during M1 contract review.
Resolve a relative YAML `out` path from the directory containing the supplied spec path.
For `specs/cart.yaml`, `out: evidence/cart` resolves to `specs/evidence/cart`.
When `out` is omitted, use `evidence/<spec-name>` in that same directory, where `<spec-name>` is the spec filename without its final extension.
Changing the command's working directory while referring to the same spec path preserves this output location.
Absolute output paths remain absolute.

Resolve paths supplied through CLI arguments from the command's working directory, including the spec argument itself, build-identity files, and one-off output paths.
Preserve spaces in supplied paths; shell expansion is the invoking shell's responsibility.
Reject blank paths and embedded null characters before filesystem or device work.
The internal resolver takes an explicit absolute working directory and performs lexical resolution only.
It does not read files, create folders, or resolve symlinks; M5 remains responsible for recognizing filesystem aliases when locking an output folder.

### T45. Per-capture video references

Agreed on 2026-10-15 during M1 contract review.
Attach existing local video recordings to a capture with repeatable `--recording <path>` flags or the matching Node API `recordings` array of paths.
Omitting recordings means an empty list.
Recordings are per-capture inputs, separate from YAML and effective step configuration.
CLI recording paths resolve from the invocation directory under T44.

The manifest references the caller's existing files; device-proof does not copy, annotate, or modify them.
Caller-owned recordings remain excluded from history cleanup even if a referenced file sits inside the evidence folder.
Missing, unreadable, or non-regular files fail preflight before device access.
Input validation reports the recording's list position and preflight identifies the path that failed.
This check establishes file readability at preflight time; it does not decode or validate video content, and external files remain under caller control afterwards.
Video annotation is outside the v1 milestone plan.

### T46. Errors before evidence capture

Agreed on 2026-10-15 during M1 contract review.
When an operation fails before evidence capture, return `result: error` with a structured `error` and any validated, known `step` or `criterion`.
Omit unknown context and unavailable device or artifact fields instead of emitting placeholders or invented paths.
Preserve known criterion wording verbatim.
The structured error has a machine-readable `code`, an actionable `message`, and optional nonempty `issues` containing field-location arrays and messages.
Field locations use string keys and zero-based array indexes; an empty location identifies the whole input.

The first implemented codes are `INVALID_INPUT` for schema validation and `RECORDING_UNAVAILABLE` for recording file preflight.
Return every schema issue, including whole-file semantic errors, while keeping the originating field locations.
Internal exception causes and stacks stay outside the JSON result.
T16's exit code 2 remains the capture error outcome.
The [pre-capture error example](../examples/pre-capture-error.json) demonstrates known step and criterion context without device or artifact claims.
Partial errors after capture, additional error codes, and manifest persistence remain separate M1/M5 work.

### T47. One owner per evidence folder

Agreed on 2026-10-15 during M1 contract review.
Each evidence folder belongs to one spec file or one one-off capture name.
Reject a capture from a different owner before device access or evidence changes, with an actionable error directing the caller to another output folder.
A spec capture and a one-off capture are different owners even when their step names match.
Repeated captures by the same owner remain allowed under the existing reuse and retention rules.

Represent ownership as `{ kind: "spec", specPath }` or `{ kind: "one-off", step }`.
Identify a spec by its canonical absolute path, resolving symlinks at the filesystem boundary before comparing owners.
Edits at that path preserve ownership; copying or moving the spec to another canonical path creates a different owner.
Ownership compatibility alone never establishes evidence reuse: T27/T28 still govern configuration, build, and environment compatibility.

Malformed saved ownership must fail closed instead of making a folder appear unowned.
The implementation reports `OUTPUT_OWNER_MISMATCH` or `OUTPUT_OWNER_INVALID`; unavailable spec paths report `SPEC_UNAVAILABLE`.
M5 must check and persist ownership while holding T30's exclusive folder lock, preserve existing evidence on refusal, and never infer a reusable empty folder from a malformed existing manifest.
Actual folder claiming, manifest persistence, and filesystem alias checks for output folders remain M5 work.

### T48. Shared numbering for annotations and standalone checks

Agreed on 2026-10-15 during M1 contract review.
For each step, number annotations first in their array order, followed by standalone checks in their array order.
Use one continuous sequence starting at 1, shared by image markers, legend entries, and manifest records.
Numbering restarts for each step.

Informational annotations receive numbers even though they carry no assertion or pass/fail result.
Legend-only absence and hidden checks receive numbers even when they have no drawable target.
Repeated targets retain separate entry numbers; T22's grouped tags list those numbers while keeping individual legend rows and results.
Numbering alone does not imply that a target resolves, has visible bounds, or passes its assertion.
Reordering entries changes their numbers and remains a semantic step edit under T27/T40.

The [numbering example](../examples/numbering.json) assigns 1 to the informational cart marker, 2 to the total assertion's box, 3 to the standalone absence check, and 4 to the standalone hidden check.
The pure numbering helper is shared input for subsequent evaluation, manifest construction, and layout; those integrations remain M2/M3 work.

### T49. Preserve completed checks alongside entry errors

Agreed on 2026-10-15 during M1 contract review.
If an entry cannot resolve, continue evaluating independent entries against the same accepted snapshot and retain all completed assertion results.
The overall step remains `error` whenever an entry has an evidence-production error, even if other assertions passed or failed.
This supersedes T16's original statement that an error replaces annotation results.

Store completed assertions separately from entry errors, linking both to T48's entry number `n`.
Completed assertions retain `expect`, `actual`, and `result: pass | fail`.
Entry errors retain `n`, a machine-readable `code`, and an actionable `message`.
An assertion that completed before a drawing error may appear in both collections under the same number.
Never turn an unresolved or unevaluated assertion into a pass or fail.
Every asserted entry must have a completed result or an explicit error before producing its evaluation summary.

T26's counts include completed assertions only; INFO entries and assertions that could not run contribute zero.
Check totals remain `passed + failed`, and each assertion contributes at most once per attempt.
Preserve original expectations and actual values, and reject inconsistent records instead of silently repairing their result.
The [partial-evaluation example](../examples/partial-evaluation.json) retains one failing text check and one passing absence check around an ambiguous-target error: total 2, passed 1, failed 1, overall error.

The implemented fragment defines evaluation results and errors, not a complete saved manifest or a claim that capture/render/save succeeded.
Generated record schemas validate structure; the complete evaluation validator additionally checks consistency with the numbered step and between expected, actual, and reported outcomes.
M2 must implement continued evaluation and diagnostic candidate details; M5 must preserve available raw artifacts and apply any later rendering or persistence errors.

### T50. Partial annotated images with explicit errors

Agreed on 2026-10-15 during M1 contract review.
When some annotation/check entries fail, still render the usable entries if the screenshot and effective crop are usable.
The image must show an ERROR outcome badge and explicit error rows in the legend.
Keep T48's original numbers, including legend-only unresolved entries, and never invent markers for missing, ambiguous, or fully off-screen targets.
Completed assertion results remain available under T49.

If any requested mask cannot be applied, omit the entire annotated image.
Require positive drawable readiness for every mask before attempting rendering; an absent error record alone does not prove that a mask can be applied.
A failed or unavailable assertion attached to an otherwise drawable mask does not prevent masking; retain its failed/error outcome while applying the mask.
The renderer must also fail the whole image if mask application fails during rendering, and persistence must never publish an intermediate image with a missing mask.

An unusable screenshot or crop likewise suppresses the annotated image instead of silently substituting another view.
Preserve available raw evidence and diagnostics under the existing error contract.
An omitted current image must have no image path in its result and must never reuse an earlier capture's image path.
The pure image policy determines eligibility only; actual rendering, visual verification, and atomic saving remain M3-M5 work.

### T51. Public offline validation API and CLI

Agreed on 2026-10-15 during M1 contract review.
Node's `validate(input)` accepts YAML text or a parsed spec object and returns a synchronous discriminated result:

```ts
import { validate } from "device-proof";

const result = validate(yamlText); // A parsed object is also accepted.
if (result.valid) {
  // result.spec contains validated fields and schema defaults.
} else {
  // result.error contains code, message, and optional field issues.
}
```

The API performs no file or device access and does not log diagnostics.
Ordinary invalid specs return `{ valid: false, error }` rather than throwing.
Success returns `{ valid: true, spec }` with schema defaults applied and caller input preserved.
Shared crop inheritance remains represented by `defaults`; capture obtains each effective configuration through T40's normalization.
Relative paths stay as supplied until T44's path-resolution boundary.

`device-proof validate <spec.yaml>` reads one local UTF-8 file and calls that same validator.
It writes one JSON result to stdout, writes readable diagnostics to stderr on failure, and exits 0 for valid input or 2 for validation, argument, or file-access errors.
Use `--` before a filename that starts with a hyphen.
Validation creates no evidence files and never loads or contacts the device client.
The [cart example](../examples/cart.yaml) is executable with the local development entry point after building:

```sh
npm run build
./bin/device-proof.mjs validate examples/cart.yaml
```

Use YAML 1.2 core syntax with exactly one document, string mapping keys, and unique keys.
The pinned `yaml` 2.9.0 parser supplies source locations and parser diagnostics; its configuration follows the [parser documentation](https://eemeli.org/yaml/).
Reject parser errors and warnings, including duplicate keys and unresolved tags, instead of silently dropping or reinterpreting content.
Ordinary anchors/aliases are supported with the parser's alias-expansion limit of 100; merge-key inheritance is disabled in favor of T40's explicit defaults.
YAML failures use `INVALID_YAML`, schema and semantic failures use `INVALID_INPUT`, and CLI file-access failures use `SPEC_UNAVAILABLE`.
Issues retain their field paths and, for YAML where available, a one-based `location: { line, column }`.
Missing fields use the nearest available parent location; object inputs do not receive invented source positions.

This API validates the current spec contract offline; selector resolution, capture preflight, and the complete persisted manifest remain their assigned milestone work.

### T52. Automatic read-only environment collection

Agreed on 2026-10-16 during M1 contract review.
Automatically collect environment details missing from agent-device capture responses using local simulator/emulator tools.
Bind every supplemental query to the device selected by the current agent-device session.
For supported local targets, use read-only Apple simulator and Android ADB queries to establish settings such as appearance and text size.
Keep collection behind the capture boundary in T17; offline spec validation continues to perform no device or filesystem access.

Metadata collection must not boot a simulator, change device settings, navigate the app, or select a different device to make a query succeed.
Use bounded commands and treat missing tools, unsupported targets, failed queries, and unrecognized responses as unavailable metadata with actionable diagnostics.
An unavailable field is never evidence that the environment matches a previous capture.
Apply T35 when required compatibility information remains unavailable: stop multi-step captures and allow fresh single-step captures where capture itself remains possible, recording the missing information.
Local tooling does not establish metadata support for remote or physical targets automatically.

The M0 evidence and additional pinned-source review are recorded in [CAPTURE-SPIKE.md](CAPTURE-SPIKE.md#build-and-environment-provenance).
T53 defines the environment compatibility record; production query execution and capture integration belong to M5.

### T53. Explicit unknown environment fields and reasons

Agreed on 2026-10-16 during M1 contract review.
Keep every required environment field explicit and store `null` when its value cannot be established.
Record exactly one field-specific reason for each null in `unavailable`, using `{ path, message }`.
A reason must identify an actual null observation; duplicate reasons, missing reasons, and reasons contradicting known values are invalid.
Two unknown values never establish compatible environments, even when their reasons are identical.
Under T35, any required unknown prevents multi-step capture and automatic evidence reuse; a fresh single-step capture remains possible if its other capture requirements are satisfied.

The [environment schema](../src/manifest/environment.ts) represents the compatibility facts required by T28, T35, and the M0 findings:

| Field | Known representation |
|---|---|
| `device.platform` | Native platform identifier |
| `device.identity` | `{ scope, id }`, a persistent identity scoped to its host/provider and simulator set as applicable |
| `device.osVersion` | Observed OS version identifier |
| `display.pixelWidth`, `display.pixelHeight` | Active display pixel dimensions at the observed rotation, before screenshot resizing or cropping |
| `display.pixelDensity` | Native UI scale; separate from rectangle projection |
| `display.rotation` | `portrait`, `portrait-upside-down`, `landscape-left`, or `landscape-right` |
| `display.appearance` | Effective `light` or `dark` appearance |
| `display.textSize` | Exact iOS content-size category or Android numeric font scale; other platforms retain a native unit and value |
| `versions.deviceProof`, `versions.agentDevice` | Tool version identifiers |

Every field above is required but nullable, including the compound identity and text-size observations.
An incomplete compound observation is stored as one null with a reason at its field path.
Identity scope and IDs must come from reliable capture metadata; a nonblank string passing schema validation does not prove that it identifies the actual device.
An emulator port alone does not establish persistent identity.
Preserve exact values instead of rounding text size to an upstream category or treating configured automatic appearance as an effective appearance reading.
The full manifest can carry additional descriptive metadata separately from these compatibility facts.

See the illustrative [complete record](../examples/environment.complete.json) and [partial record](../examples/environment.partial.json).
These are contract examples, not new device observations.
The generated [JSON Schema](../src/manifest/environment.schema.json) validates structure; `environmentSchema` additionally enforces null/reason agreement and native text-size representation, following T41's distinction between structural and complete validation.
`assessEnvironment` returns validated observations, completeness, and admission through the environment gate for the supplied step count.
`environmentsMatch` requires complete records and exact agreement across all compatibility facts, independently of object key order.
This comparison covers environment compatibility only; build identity, effective step configuration, capture readiness, and manifest reconciliation remain separate requirements.

## Upstream candidates

1. Export `evaluateIsPredicate` and the visibility model from `agent-device/selectors`.
2. `noRecord` on `screenshot`.
3. A single call that captures snapshot and screenshot together.
4. The Android `--overlay-refs` plus `--scale` mapping, once reproduced.

## Still to design

The implementation sequence and verification gates are recorded in [PLAN.md](PLAN.md).
Its remaining contract work is assigned to M0 and M1 and must be resolved before dependent implementation.
