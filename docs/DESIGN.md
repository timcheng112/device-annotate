# device-proof: technical design

Status: in progress.
Requirements live in [REQUIREMENTS.md](REQUIREMENTS.md).
Facts about agent-device come from reading its source at commit `3d48bb99` (2026-10-14).
Nothing below has been verified at runtime yet.

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
device-proof capture --box 'id="x"' -o shot.png
device-proof validate <spec.yaml>
```

`validate` needs no device.
There is no `report` command (T14).

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
Presentation of annotations without checks remains a contract-review detail in PLAN.md.

## Upstream candidates

1. Export `evaluateIsPredicate` and the visibility model from `agent-device/selectors`.
2. `noRecord` on `screenshot`.
3. A single call that captures snapshot and screenshot together.
4. The Android `--overlay-refs` plus `--scale` mapping, once reproduced.

## Still to design

Implementation planning is in progress in [PLAN.md](PLAN.md).
Its review queue tracks remaining contract clarifications.
