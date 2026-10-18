# device-annotate

**Annotated screenshots and video checklists for native apps.**
Built for coding agents, so “verified” comes with evidence you can inspect.

I wanted Playwright-style annotated evidence for native devices.
This adds that verification layer on top of [agent-device](https://github.com/callstack/agent-device).

## What it does

- **Annotate screenshots:** numbered boxes, arrows, markers, labels, and image masks.
- **Check UI state:** explicit PASS/FAIL results with expected versus actual values.
- **Explain recordings:** a running checklist below the video, with results as checks finish.
- **Keep the evidence:** raw captures, UI snapshots, and JSON results for agents and reviewers.

## Use it for

- **Features:** check acceptance criteria before saying “done”.
- **Bug fixes:** show the failing state and the verified fix.
- **Reviews:** attach readable evidence to a PR or handoff.

## Examples

### Screenshot

<a href="https://raw.githubusercontent.com/timcheng112/device-annotate/8ffbee2be5b556a184514ddfa5b0071f33034803/test/golden/approved/primitives-mixed.png">
  <img src="https://raw.githubusercontent.com/timcheng112/device-annotate/8ffbee2be5b556a184514ddfa5b0071f33034803/test/golden/approved/primitives-mixed.png" width="480" alt="Native screen with numbered annotations, PASS/FAIL checks, and expected versus actual details.">
</a>

### Video

<a href="https://raw.githubusercontent.com/timcheng112/device-annotate/a5ffe77ea79bc0420ab9c421a4664a8b4b32cb42/docs/examples/running-checklist.mp4">
  <img src="https://raw.githubusercontent.com/timcheng112/device-annotate/a5ffe77ea79bc0420ab9c421a4664a8b4b32cb42/docs/examples/running-checklist.gif" width="480" alt="Android recording with a running checklist that accumulates PASS, FAIL, and INFO results below the video.">
</a>

Real Android recording, including a deliberately failed check.
[Watch the full MP4](https://raw.githubusercontent.com/timcheng112/device-annotate/a5ffe77ea79bc0420ab9c421a4664a8b4b32cb42/docs/examples/running-checklist.mp4).

## Try it

Requires Node.js 22.12+ and a matching agent-device 0.21.27 daemon.
Video also needs FFmpeg with libx264 and ffprobe.

```sh
npm install -g device-annotate agent-device@0.21.27
```

Open your app and navigate with agent-device, then save `cart.yaml`:

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

Swap in your selector and expected text, then run from the session’s working directory:

```sh
device-annotate validate cart.yaml
device-annotate capture cart.yaml --step total --platform android
```

For agents: **implement → navigate → capture/check → inspect → report**.
The [agent skill](https://github.com/timcheng112/device-annotate/blob/plan/implementation/skills/device-annotate/SKILL.md) guides that Verify phase.
Use `device-annotate help` for video commands, multi-step flows, the Node API, and recovery.

## Device support

| Device | Screenshots | Video checklist |
| --- | --- | --- |
| Android emulator | Verified, including multi-step flows | Verified |
| iOS simulator | Verified for single steps | Verified for single steps |
| Physical Android device | Unverified | Unverified |
| Physical iPhone / iPad | Unverified | Unverified |

iOS multi-step flows are currently blocked by unavailable display metadata.

## Before you start

Video checklists require 0.2.0 or later.
Masks affect annotated images only; raw captures and all video remain unredacted.
Use seeded data and review evidence before sharing.

[MIT](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
