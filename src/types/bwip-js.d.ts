declare module "bwip-js" {
  export type BwipOptions = Record<string, unknown>;

  export const toBuffer: (options: BwipOptions) => Promise<Buffer>;
  /** Browser-only helpers used by the customer loyalty card. */
  export const toDataURL: (options: BwipOptions) => string;
  export const toCanvas: (
    canvas: HTMLCanvasElement | string,
    options: BwipOptions,
  ) => void;

  const bwip: {
    toBuffer: typeof toBuffer;
    toDataURL: typeof toDataURL;
    toCanvas: typeof toCanvas;
  };
  export default bwip;
}
