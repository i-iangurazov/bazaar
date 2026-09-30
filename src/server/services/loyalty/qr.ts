type BwipModule = { toBuffer: (options: Record<string, unknown>) => Promise<Buffer> };

/** Renders a QR PNG on the server (browser bundling of bwip-js is unreliable). */
export const renderQrPng = async (text: string) => {
  const bwipModule = (await import("bwip-js")) as unknown as BwipModule & { default?: BwipModule };
  const bwip = bwipModule.default ?? bwipModule;
  // A square QR: passing `height` for a 2D barcode distorts the module grid.
  return bwip.toBuffer({ bcid: "qrcode", text, scale: 4, includetext: false });
};

export const renderQrDataUrl = async (text: string) =>
  `data:image/png;base64,${(await renderQrPng(text)).toString("base64")}`;
