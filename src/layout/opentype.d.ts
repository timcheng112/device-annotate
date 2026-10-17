/** Narrow declaration for the pinned runtime API used by layout. */
declare module 'opentype.js' {
  type Glyph = { index: number; advanceWidth?: number };
  type Font = { unitsPerEm: number; ascender: number; descender: number;
    charToGlyphIndex(character: string): number; charToGlyph(character: string): Glyph };
  const opentype: { parse(bytes: ArrayBuffer): Font };
  export default opentype;
}
