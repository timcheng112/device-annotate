# Pure evidence layout

`layoutStep` consumes an effective step, the verbatim criterion, M2's accepted checks/errors/geometry, and glyph metrics.
It validates those records and recomputes image eligibility rather than trusting a stale cached image-policy decision.
An omitted result contains the omission reasons and no views.
A layout result contains one overview, zero or more detail views, and a legend beneath every view.
This is an internal seam; the public capture API remains M5 work.

## Coordinates and placement

View `source` rectangles address the original screenshot.
View frames, outlines, masks, tags, arrows, and legend text use final evidence-image pixels.
Frames display screenshot pixels at 1:1 scale.
Typography, strokes, spacing, and outer padding scale by `max(1, round(screenshot.width / 400))` to stay readable beside native-resolution captures.
The base outer padding is 16 pixels.
Detail sources include 24 pixels around the target, limited to the accepted crop.
The original accepted geometry remains unchanged.

Positive-area overlap includes containment and transitive connections.
Distinct target identities determine the three-target threshold, even when drawing groups share identical rectangles.
Repeated checks on one target never increase that threshold.
Detail views retain original numbers and region colors and show one target identity each.
All intersecting masks apply to every view, including detail views for other identities.
Render masks as opaque blocks before adding hatching, labels, outlines, and markers.
Rendering must abort if any required mask cannot be applied.

Tags try the top, right, bottom, and left outer edges in stable order, preferring directions away from nearby targets.
Candidates must clear all target rectangles and previous tags, including their halo spacing.
If none fits, the tag moves to a growing margin to the right of the image with a connector to the actual target edge.
The canvas grows to contain every tag and every legend row.
Number/result pairs stay together when grouped tags wrap.

Region colors follow a fixed hue sequence, independent of check outcomes.
They are emitted as RGB hex values, darkened when necessary to retain at least 4.5:1 contrast for white tag text.
All region edges and tags require white halos; tag text is white on the region color.
INFO tags have numbers only; completed checks use the bundled checkmark or cross, and unavailable checks use `!` with explicit ERROR diagnostics below.
Outlines are dotted without completed checks, solid when all completed checks pass, and dashed when any completed check fails.
The overall outcome and legend rows preserve error precedence and completed results independently.

## Text and rendering boundary

`createTextMetrics` accepts font bytes from the caller and performs no filesystem access.
The bundled font and its provenance are documented in [the font directory](../render/fonts/README.md).
Each text line retains its original text, display text, exact glyph indices, advances, and horizontal positions.
The renderer must use these positions and the identical font bytes, preserving whitespace rather than asking a host text engine to reflow or reshape the text.
Vertical layout uses a base 24-pixel line height and 16-pixel font size, multiplied by the screenshot-width scale.
The baseline should be the line top plus the supplied font's ascender at that size.
Criterion and annotation source strings remain available verbatim, and expected/actual values use lossless JSON strings.
No text or record is truncated.

The approved current scope focuses on English.
Characters absent from Inter display as Unicode escapes, and broader fallback-font coverage is deferred.
M4 implements rendering, image decoding, SVG escaping, rasterization, visual QA, and golden images in `src/render/` and `test/golden/`.
The tests here verify layout records and geometry, without claiming rendered-image correctness.
