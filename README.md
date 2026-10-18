# device-annotate

Local annotated screenshot evidence and assertions for native mobile apps, powered by agent-device.
Use agent-device to drive the app, then capture evidence with this package.

Requires Node >=22.12 and agent-device 0.21.27 with a matching running local daemon.
Run `device-annotate help` for the installed version's complete reference, examples, privacy rules, and platform limitations.

```sh
device-annotate validate cart.yaml
device-annotate capture cart.yaml --step after --platform android --build build.json
device-annotate cleanup evidence/cart
```

The Node API exports `validate`, `capture`, and `cleanup` with TypeScript declarations.
Generated structural schemas ship under `src/spec/` and `src/manifest/`; CLI validation additionally checks whole-file rules.
The agent skill lives at [skills/device-annotate/SKILL.md](skills/device-annotate/SKILL.md) in the repository and is excluded from the npm package.

Masks cover annotated images; raw screenshots and snapshots remain unredacted audit artifacts.
Use seeded data and review evidence before sharing.
There is no telemetry or upload; capture uses a verified local daemon and local platform tools.

iOS simulator and Android emulator verification is recorded in [the delivery record](docs/PLAN.delivery.md).
The tested iOS environment lacks required active display metadata for multi-step reuse, so those captures are refused.
Physical-device support is unverified.
See [third-party notices](THIRD_PARTY_NOTICES.md) for font, vendored code, and WASM dependency licensing.

For local verification, run `npm ci`, `npm run check`, and `npm run check:package`.
The package check packs into a temporary directory and installs into an isolated consumer using npm, then exercises the installed CLI, Node API, renderer, and cleanup.
Use `npm run check:package -- --offline` when both dependency tarballs and registry metadata are already cached.
A fresh CI cache populated only by `npm ci` may lack the registry metadata needed for offline dependency resolution.
The package remains private; packing and verification do not publish it.
