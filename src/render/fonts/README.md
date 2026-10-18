# Bundled Inter

`Inter-Regular.ttf` and `Inter-SemiBold.ttf` are copied unchanged from `extras/ttf/` in the official [Inter 4.1 release](https://github.com/rsms/inter/releases/tag/v4.1).
Its internal version is `Version 4.001;git-9221beed3`.
The accompanying `LICENSE.txt` is copied unchanged from that archive and permits bundling under the SIL Open Font License 1.1.

SHA-256:

- Release archive `Inter-4.1.zip`: `9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e`
- `Inter-Regular.ttf`: `40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82`
- `Inter-SemiBold.ttf`: `78a843fade9d4612a5567302fb595b56976eb5fcebf4fea5a5912d638bafcde3`
- `LICENSE.txt`: `262481e844521b326f5ecd053e59b98c8b2da78c8ee1bdbb6e8174305e54935a`

The pure layout accepts bytes parsed through pinned `opentype.js` 1.3.4.
The integration layer must load these same bytes for layout and rendering, without consulting host fonts.
Text lines contain explicit glyph indices and advances with shaping and kerning disabled so M4 can preserve measured positions exactly.
Characters outside Inter's coverage use visible Unicode code-point escapes, while the original source text remains in layout records.
This avoids silently substituting missing-glyph boxes or dropping evidence.
Result symbols `✓` and `×` are present in the bundled font.
M4 must render the supplied glyph positions, preserve whitespace, and retain the white halos and opaque masks described by layout.

The regular and semibold faces are measured and rendered independently.
Each text line carries its size and face so explicit glyph positions use the corresponding outline.
