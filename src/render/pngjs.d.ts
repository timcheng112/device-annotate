/** The synchronous, in-memory PNG codec boundary used by rendering. */
declare module 'pngjs' {
  export type DecodedPng = { width: number; height: number; data: Buffer };
  export const PNG: { sync: {
    read(bytes: Buffer): DecodedPng;
    write(image: DecodedPng): Buffer;
  } };
}
