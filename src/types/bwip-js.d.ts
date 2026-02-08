declare module "bwip-js" {
  export type BwipOptions = Record<string, unknown>;

  export const toBuffer: (options: BwipOptions) => Promise<Buffer>;

  const bwip: { toBuffer: typeof toBuffer };
  export default bwip;
}
