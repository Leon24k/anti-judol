/** Minimal typings for gifenc@1.0.3 (only what scripts/demo.ts uses). */
declare module "gifenc" {
  export type Palette = number[][];
  export interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, opts: { palette: Palette; delay?: number }): void;
    finish(): void;
    bytes(): Uint8Array;
  }
  export function GIFEncoder(): Encoder;
  export function quantize(rgba: Uint8Array | Buffer, maxColors: number, opts?: { format?: "rgb565" | "rgb444" | "rgba4444" }): Palette;
  export function applyPalette(rgba: Uint8Array | Buffer, palette: Palette, format?: "rgb565" | "rgb444" | "rgba4444"): Uint8Array;
}
