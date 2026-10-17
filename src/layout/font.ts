import opentype from 'opentype.js';

export type GlyphPlacement = { index: number; x: number; advance: number };
export type TextLine = { text: string; displayText: string; width: number; glyphs: GlyphPlacement[] };
export type TextMetrics = ReturnType<typeof createTextMetrics>;

/** The caller loads the bundled bytes. Layout never reads files or host fonts. */
export function createTextMetrics(bytes: ArrayBuffer) {
  const font = opentype.parse(bytes);
  function line(text: string, size: number): TextLine {
    if (!Number.isFinite(size) || size <= 0) throw new Error('Font size must be positive and finite.');
    // Explicit escapes retain unsupported characters as readable evidence rather than tofu.
    const displayText = [...text].map((character) => font.charToGlyphIndex(character) > 0
      ? character : `\\u{${character.codePointAt(0)!.toString(16).toUpperCase()}}`).join('');
    const glyphs: GlyphPlacement[] = [];
    let width = 0;
    for (const character of displayText) {
      const glyph = font.charToGlyph(character);
      const advance = (glyph.advanceWidth ?? font.unitsPerEm) * size / font.unitsPerEm;
      glyphs.push({ index: glyph.index, x: width, advance });
      width += advance;
    }
    // Explicit glyph positions deliberately disable shaping/kerning differences in renderers.
    return { text, displayText, width, glyphs };
  }
  function wrap(text: string, size: number, maxWidth: number): TextLine[] {
    if (!Number.isFinite(maxWidth) || maxWidth <= 0) throw new Error('Text width must be positive and finite.');
    const lines: TextLine[] = [];
    for (const paragraph of text.split('\n')) {
      let pending = '', pendingWidth = 0;
      const widths = new Map<string, number>();
      const widthOf = (character: string) => {
        let width = widths.get(character);
        if (width === undefined) { width = line(character, size).width; widths.set(character, width); }
        return width;
      };
      const flush = () => { lines.push(line(pending, size)); pending = ''; pendingWidth = 0; };
      for (const token of paragraph.match(/\s+|\S+/gu) ?? []) {
        const tokenWidth = [...token].reduce((sum, character) => sum + widthOf(character), 0);
        if (pending && pendingWidth + tokenWidth > maxWidth) flush();
        for (const character of token) {
          const width = widthOf(character);
          if (pending && pendingWidth + width > maxWidth) flush();
          if (width > maxWidth) throw new Error('Text column is narrower than one glyph or Unicode escape.');
          pending += character; pendingWidth += width;
        }
      }
      lines.push(line(pending, size));
    }
    return lines;
  }
  return { line, wrap, family: 'Inter', unitsPerEm: font.unitsPerEm,
    ascent: font.ascender / font.unitsPerEm, descent: -font.descender / font.unitsPerEm };
}
