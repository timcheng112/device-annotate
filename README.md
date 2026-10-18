# device-annotate

Capture native mobile screenshots with agent-device, then annotate them with numbered highlights, acceptance criteria, and explicit PASS, FAIL, and INFO results.
Write criteria and checks in YAML, prepare your app with agent-device, and let device-annotate capture and render a self-contained evidence image plus a machine-readable manifest.
Recordings created separately with agent-device can be attached as evidence references; device-annotate does not create or annotate videos.

- Highlight targets with numbered boxes, markers, arrows, and callouts.
- Check visibility, presence, text, and other snapshot-supported states.
- Keep overlapping targets readable with grouped tags and individual detail views.
- Mask regions in annotated images while retaining separate raw audit artifacts.
- Track multi-step evidence, compatible recaptures, and bounded attempt history.
- Use the CLI or the typed Node.js API.

Capture observes an existing app session.
It does not tap, navigate, boot a device, activate an app, or replace a running daemon.

## Example output

These images come from neutral test fixtures rendered by device-annotate.
Click an image to open it at full resolution.

### Numbered annotations and explicit results

The shared tags preserve each entry's number and result.
The legend separates PASS, FAIL, and INFO, shows expected and actual values, and labels the masked region.

<a href="https://raw.githubusercontent.com/timcheng112/device-annotate/8ffbee2be5b556a184514ddfa5b0071f33034803/test/golden/approved/primitives-mixed.png">
  <img src="https://raw.githubusercontent.com/timcheng112/device-annotate/8ffbee2be5b556a184514ddfa5b0071f33034803/test/golden/approved/primitives-mixed.png" width="480" alt="Annotated neutral screen with grouped numbered tags, passing and failing checks, informational highlights, a masked account region, and a detailed legend below the screenshot.">
</a>

<details>
<summary>See dense overlap and individual detail views</summary>

When several distinct targets overlap, an overview and individual detail views share one evidence image.
The masked account region stays covered in every view.

<a href="https://raw.githubusercontent.com/timcheng112/device-annotate/8ffbee2be5b556a184514ddfa5b0071f33034803/test/golden/approved/dense-masked.png">
  <img src="https://raw.githubusercontent.com/timcheng112/device-annotate/8ffbee2be5b556a184514ddfa5b0071f33034803/test/golden/approved/dense-masked.png" width="480" alt="Neutral order summary with overlapping numbered regions, separate detail views for each target, a mask preserved across views, and passing check results.">
</a>

</details>

## Installation

Requires **Node.js 22.12 or later** and **agent-device 0.21.27**.
The installed agent-device version and its running local daemon must match.
Prepare your simulator/emulator, app, and session with agent-device before capturing evidence.

Version 0.1.0 is being prepared for its first npm release.
Until a release is published, build and install a local tarball from this checkout:

```sh
npm ci
npm pack
npm install -g ./device-annotate-0.1.0.tgz agent-device@0.21.27
device-annotate help
```

After npm publication, the corresponding registry installation will be:

```sh
npm install -g device-annotate agent-device@0.21.27
```

For the Node API, install into your project instead of using `-g`.
The package is ESM and includes TypeScript declarations.

## Quick start

First use agent-device to open your app and navigate to the screen you want to verify.
Run capture from the same working directory as the existing session, or supply `--session` with its exact address.
Use `--platform ios` or `--platform android` when selecting the device.

### Highlight a control

Replace `cart-total` with a stable selector from your app:

```sh
device-annotate capture \
  --step total \
  --criterion 'The cart total is displayed' \
  --box 'id="cart-total"' \
  --platform android \
  --out evidence/cart-total
```

This produces an **INFO annotation**: it highlights the target without evaluating an assertion.
Use a spec to verify the target's actual state or text.

### Capture an assertion

Save this as `cart.yaml` and adapt the selector and expected text to your app:

```yaml
out: evidence/cart
criteria:
  - criterion: The cart total is £12.00
    steps:
      total:
        annotate:
          - box:
              target: 'id="cart-total"'
              text: Cart total
              expect: { text: '£12.00' }
```

Validate the spec offline, then capture the prepared screen:

```sh
device-annotate validate cart.yaml
device-annotate capture cart.yaml --step total --platform android
```

The image includes the criterion, numbered targets, explicit results, and expected/actual details.
`out` in YAML resolves relative to the spec file; CLI `--out` resolves from your working directory.
Use separate output folders for independent specs or one-off captures.

## What gets saved

The output folder contains `manifest.json` and per-attempt artifacts.
Read artifact paths from the manifest rather than assuming a fixed image filename.

| Artifact | Purpose |
| --- | --- |
| Annotated PNG | Reviewable evidence with numbered regions, a criterion, and result details |
| Raw screenshot | Original full-frame capture for auditing |
| Snapshot JSON | Captured UI structure used for target resolution and checks |
| `manifest.json` | Current results, check counts, artifact references, errors, and attempt history |

Region colors identify targets, independently of results.
Checked regions use solid borders when all checks pass and dashed borders when any check fails.
Regions with no checks use dotted borders; INFO entries contribute no passing assertions.
Identical bounds share a tag while each entry retains its own legend row and result.

A capture error can preserve completed independent checks and available raw evidence.
If a required mask cannot be applied, the annotated image is omitted.

## Annotations and checks

Each annotation contains one primitive.
Every primitive accepts an optional `expect`; omitting it produces INFO.

| Primitive | Target field | Text |
| --- | --- | --- |
| `box` | `target` | Optional |
| `marker` | `target` | Optional |
| `arrow` | `to` | Required |
| `callout` | `target` | Required |
| `mask` | `target` | Optional |

An expectation contains exactly one predicate: `visible`, `hidden`, `exists`, `absent`, `editable`, `selected`, `focused`, or `text`.
State predicates accept `true`; `text` accepts an exact nonempty string, including its whitespace.
Checks use agent-device snapshot semantics.

Use standalone checks for absence without a drawable target:

```yaml
criteria:
  - criterion: The checkout error is absent
    steps:
      checkout:
        checks:
          - target: 'id="checkout-error"'
            expect: { absent: true }
```

Drawing annotations always need drawable targets.
Missing or ambiguous targets produce errors with diagnostics.
Prefer stable IDs/testIDs; capture refreshes snapshots, so previously obtained element refs may become stale.

## Results and exit codes

| Capture exit code | Result | Meaning |
| --- | --- | --- |
| `0` | `passed` | This step's evidence completed and all evaluated checks passed |
| `1` | `failed` | One or more evaluated assertions failed |
| `2` | `error` | Input, session, target, capture, or evidence production failed |

A successful zero-check capture establishes that evidence was produced; it proves no assertion.
Capture reports the requested step's result, so inspect the manifest before declaring a multi-step flow complete.
Commands emit JSON on stdout and human diagnostics on stderr.
Offline validation exits `0` for valid input and `2` for invalid input.

## Multi-step evidence and platform support

A spec can describe multiple named steps.
Navigate between screens with agent-device, then capture each step explicitly.
Multi-step specs require a separate build identity that identifies the installed native build and any separately delivered runtime code:

```json
{
  "appId": "dev.example.cart",
  "native": "sha256:replace-with-the-installed-build-hash",
  "runtime": { "kind": "embedded" }
}
```

Save this as `build.json`, replace the example values with actual build provenance, and pass `--build build.json` to each capture.
For external JavaScript or other runtime code, use `runtime: {"kind":"external","revision":"immutable-runtime-hash"}`.
Single-step captures may omit build identity, but unknown identity cannot establish compatibility for reuse.

Compatible recaptures replace a step's current evidence and archive its previous attempt.
Changes to the spec, build, or environment invalidate affected evidence.

| Platform | Verified behavior |
| --- | --- |
| Android emulator | Single-step and multi-step capture, recapture, and compatible evidence reuse |
| iOS simulator | Single-step capture and observe-only refusal when the app/runner is unavailable |
| Physical devices | Unverified |

The tested iOS toolchain cannot reliably expose active display rotation and pixel dimensions, so multi-step iOS captures are refused.
On iOS, the app must already be foreground and the observe-only runner prepared.
Rendering uses bundled Inter fonts with an English-first scope; unsupported characters display as Unicode escapes while source text is preserved.

## Node.js API

```js
import { readFile } from 'node:fs/promises';
import { validate, capture, cleanup } from 'device-annotate';

const yaml = await readFile('cart.yaml', 'utf8');
const validation = validate(yaml);
if (!validation.valid) throw new Error(JSON.stringify(validation.error));

const attempt = await capture({
  specPath: 'cart.yaml',
  step: 'total',
  platform: 'android',
});
console.log(attempt);

// Preview eligible history cleanup without deleting files.
const preview = await cleanup({ outDir: 'evidence/cart' });
console.log(preview);
```

`validate` accepts YAML text or a parsed spec object and performs no device or filesystem IO.
`capture` also accepts `session`, `cwd`, `out`, `build`, and `recordings`.
For one-off API captures, supply `step`, `criterion`, `out`, and `config: {annotate, checks, crop}` instead of `specPath`.
`cleanup` accepts `outDir`, `apply`, and `finished`; both booleans default to `false`.

## Privacy and cleanup

**Masks redact annotated images only.**
Raw screenshots and snapshots remain unredacted audit artifacts.
Use seeded test data and review artifacts before sharing.
There is no telemetry or upload; capture uses a verified local daemon over loopback and read-only local platform tooling.

History defaults to at most three previous attempts per step, seven elapsed days, and 500 MB across historical artifacts.
Current evidence and caller-owned recordings remain protected from automatic pruning.

```sh
# Preview eligible historical deletions.
device-annotate cleanup evidence/cart

# Apply those deletions.
device-annotate cleanup evidence/cart --apply

# Preview removal of a completed run, including its current evidence.
device-annotate cleanup evidence/cart --finished
```

Add `--apply` to the finished-run command only when the completed run can be discarded.
See installed help for configurable retention, crop rules, recording references, and error recovery.

## Reference and development

Run `device-annotate help` for the installed version's complete offline reference.
Structural JSON Schemas ship in `src/spec/` and `src/manifest/`; CLI validation also checks whole-file rules.
The repository's [agent skill](https://github.com/timcheng112/device-annotate/blob/plan/implementation/skills/device-annotate/SKILL.md) is available separately and excluded from the npm package.

```sh
npm ci
npm run check
npm run check:package
npm run benchmark:render
```

The package check builds a tarball and exercises the installed CLI, API, rendering, and cleanup in an isolated consumer.
Use `npm run check:package -- --offline` when dependency tarballs and registry metadata are already cached.
Packing and verification do not publish the package.

## License

MIT.
See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md) for bundled font, vendored code, and rendering dependency licenses.
