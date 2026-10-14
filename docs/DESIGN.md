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
- A step that errored carries `"error": { "code", "message", "candidates" }` instead of annotation results.
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
The exact spec and manifest fields for standalone checks remain to be defined during contract review.

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

## Upstream candidates

1. Export `evaluateIsPredicate` and the visibility model from `agent-device/selectors`.
2. `noRecord` on `screenshot`.
3. A single call that captures snapshot and screenshot together.
4. The Android `--overlay-refs` plus `--scale` mapping, once reproduced.

## Still to design

The implementation sequence and verification gates are recorded in [PLAN.md](PLAN.md).
Its remaining contract work is assigned to M0 and M1 and must be resolved before dependent implementation.
