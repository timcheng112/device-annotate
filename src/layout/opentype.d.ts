/** Narrow declaration for the pinned runtime API used by layout. */
declare module 'opentype.js' {
  type Glyph = { index: number; advanceWidth?: number; getPath(x: number, y: number, size: number): { toPathData(precision?: number): string } };
  type Font = { unitsPerEm: number; ascender: number; descender: number;
    glyphs: { get(index: number): Glyph }; charToGlyphIndex(character: string): number; charToGlyph(character: string): Glyph };
  const opentype: { parse(bytes: ArrayBuffer): Font };
  export default opentype;
}
