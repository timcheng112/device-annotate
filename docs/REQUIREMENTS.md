# device-proof: requirements

Working name.
`device-proof` is free on npm as of 2026-10-14.

## Purpose

The verify phase for native mobile apps.
A coding agent produces annotated, asserted evidence that a change works, so a human can trust it without watching the agent build it.
It is the native equivalent of what Playwright gives `fh` for web and PWA.

Bug-report triage is a secondary use case, handled by a separate later project (see Roadmap).

## Boundary with agent-device

agent-device drives the app: open, tap, type, navigate, wait.
This package captures (through agent-device's Node API), runs agent-device's checks against that capture, annotates, and writes a manifest.
It writes local files only; where they go next (an MR, chat, CI) is the caller's concern.
It never taps or navigates.
The spec contains captures, annotations and assertions only, never actions.

The agent alternates between the two tools:

```
agent-device open MyApp --platform ios
<pkg> capture evidence/cart.yaml --step before
agent-device press 'label="Increase quantity"'
agent-device wait text "£12.00" 3000
<pkg> capture evidence/cart.yaml --step after
```

Exact command names and step invocation are decided in technical design.

## Why this package exists

An agent annotating screenshots ad hoc either guesses pixel coordinates by eye, which is unreliable, or writes a one-off script that redoes coordinate mapping, timing and styling every run.
This package makes those jobs deterministic code:

1. Element-anchored placement: selectors resolve to exact pixels.
2. Validation: missing, ambiguous or off-screen targets fail instead of producing misleading evidence.
3. Consistency: the same visual language on every run.
4. Video overlays (v1.1) that work reliably.
5. Criterion-to-evidence output that a harness can consume.

Neither agent-device nor Playwright ties an assertion to a picture.
agent-device's `is` reports pass or fail with no image.
Playwright's screenshots do not show which element was checked or what was expected.

## v1 functional requirements

1. **Capture.**
   Snapshot and screenshot together through agent-device's Node API, with a stability check (snapshot, screenshot, snapshot, compare).
   Retry a bounded number of times, then return an error.
2. **Spec.**
   A YAML file validated against a JSON Schema, plus CLI flags for one-off captures.
   Each capture group requires a `criterion` (an acceptance criterion, copied word for word from the plan where one exists).
3. **Selector anchoring.**
   Targets use agent-device selectors and resolve to screenshot pixels.
   Zero matches, multiple matches, or a fully off-screen target is an error.
   A partly off-screen target is a warning.
4. **Annotations.**
   Box, arrow with text, numbered marker, text callout, `mask` (solid box, as in Playwright), and crop to targets with padding.
5. **Assertions.**
   agent-device's `is` predicates, with the same names and semantics: `visible`, `hidden`, `exists`, `absent`, `editable`, `selected`, `focused`, `text`.
   They are evaluated against the same snapshot as the image.
   No predicates beyond what agent-device supports.
6. **Two outcomes.**
   - **Failed** (the app is wrong): the annotated image marks the assertion with a cross and explicit FAIL text, showing expected and actual values.
     Region colors identify annotations; result symbols and border styles communicate outcomes (DESIGN.md, T22).
     Exit code 1.
   - **Error** (the evidence could not be produced): raw screenshot plus a diagnosis, such as nearest candidate elements.
     Exit code 2.
7. **Manifest.**
   `manifest.json`, updated after every step.
   No human-facing report: each annotated image explains itself through its legend, and callers build any summary from the manifest.
   Each criterion lists its images, assertion results and outcome.
   Raw agent-device recordings are listed without annotation.
8. **Agent skill.**
   Teaches the spec format and the workflow.
   Tells agents to add `testID`s to elements they want to show as evidence.

## Non-functional requirements

- **Platforms.**
  The core works on any platform agent-device supports.
  | Tier | Platforms |
  |---|---|
  | Supported, tested in CI | iOS simulator, Android emulator |
  | Should work, untested | Physical devices, other agent-device platforms |
  | Not a goal | Web (Playwright covers it) |
- **Repeatable output.**
  Rendering is a pure function of image, rects and spec.
  Bundled font, fixed palette, contrast-aware colors, fixed label-placement rules, golden-image tests.
- **Interfaces.**
  CLI plus agent skill first, Node API underneath.
  MCP later.
- **Performance.**
  Less than 1 second added on top of capture.
- **License and privacy.**
  MIT.
  No network calls and no telemetry.
  No automatic redaction; seeded test data is the real protection.

## Out of scope for v1

- Driving the app (agent-device does this).
- Annotated video.
- Automatic redaction.
- Visual regression diffing.
- GUI.
- MCP server.

## Roadmap

- **v1.1: annotated video.**
  A `mark` command records timestamps and target rects during `agent-device record`.
  The package renders captions, highlights and step numbers with ffmpeg.
  Reuse agent-device's touch overlay if it already draws taps.
- **v2.**
  Quality gate that rejects weak evidence (blank screens, spinners, duplicate frames).
  MCP server.
  Support for other capture tools.
- **Separate project: bug triage.**
  Input is a screenshot or recording plus a comment.
  A feature map built from code and from a crawl of the running app matches the screen.
  agent-device reproduces the bug, this package annotates the reproduction, and the output is a report with cause, files, confidence, and what could not be reproduced.

## Open questions for technical design

1. Does agent-device's Node API expose its selector resolution and `is` logic for reuse, or must the package match their behavior itself?
2. How do snapshot coordinates relate to screenshot pixels per platform (scale, safe areas, status bar)?
3. Does agent-device record timestamped actions or touch overlays (affects v1.1)?
4. What to propose upstream to Callstack, and which pieces belong in agent-device itself.

## Plan for upstream

Open an issue on agent-device on day one, describing selector-anchored annotation and asking what belongs in core.
Build this package on the Node API, use it for real verification, then upstream the primitives that proved necessary.
