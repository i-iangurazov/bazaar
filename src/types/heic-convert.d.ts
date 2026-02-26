declare module "heic-convert" {
  type ConvertOptions = {
    buffer: Buffer | Uint8Array | ArrayBuffer;
    format: "JPEG" | "PNG";
    quality?: number;
  };

  type ConvertFunction = (options: ConvertOptions) => Promise<Buffer | Uint8Array>;

  const convert: ConvertFunction;
  export = convert;
}
