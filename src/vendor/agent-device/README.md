# Pinned agent-device checks

This directory preserves MIT-licensed code from agent-device 0.21.27 at commit `50e45f11bc6d388d272e672771acc33d9e56921d`.
The upstream license is in [LICENSE](LICENSE).
The source paths and both original/adapted SHA-256 hashes are recorded in [sources.json](sources.json).

Production code uses the published `agent-device/selectors` parser, matcher, visibility shorthand, and editable helper.
The vendored code supplies predicate evaluation, snapshot visibility, absence classification, and the narrow rules for a component reported twice.
Supporting snapshot types, rectangle helpers, and bounded identity formatting are included because those implementations depend on them.
No device client is invoked by this code.

[scripts/vendor-agent-device.mjs](../../../scripts/vendor-agent-device.mjs) defines every extraction and import adaptation.
The script copies predicate, visibility, and absence test bodies from upstream, plus the direct duplicate-reporting tests that exercise the extracted helper.
The duplicate-reporting fixture includes React Native positive and negative cases exercised by our resolution tests.
Test adaptations replace module paths and the Vitest runner; the two used `expect` methods delegate to Node strict assertions.
The unrelated `snapshotStateProvenance` and `inheritPostGestureOutcome` functions are omitted from the snapshot support file because they are unused and assume a different optional-property compiler setting.
The duplicate-reporting and identity modules include only their required declarations, with their bodies preserved.
`platform.ts` derives its types from the public peer API.

Generated files must be regenerated through the script.
After reviewing an upstream change, update the pinned revision and extraction rules together, regenerate, and run the full checks.

```sh
# Verify committed hashes without an upstream checkout.
npm run check:vendor

# Compare against the pinned source already available from M0.
npm run compare:vendor

# Compare against another locally available upstream revision, without writing.
node scripts/vendor-agent-device.mjs --upstream=/path/to/agent-device --revision=<commit>

# Regenerate from the reviewed pinned source and run all checks.
node scripts/vendor-agent-device.mjs --write
npm run check
```

The comparison and generation scripts perform no network requests.
Upstream export proposals and external contribution remain separately authorized work.
