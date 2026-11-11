import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

import { reportNativeDiagnostic } from "@/lib/native/diagnostics";
import { isPluginAvailable } from "@/lib/native/platform";

const safeFileName = (value: string) =>
  value
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "bazaar-file";

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("nativeFileReadFailed"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    };
    reader.readAsDataURL(blob);
  });

export type NativeShareResult = {
  status: "shared" | "cancelled" | "unavailable" | "failed" | "discarded";
};

const shareWasCancelled = (error: unknown) =>
  (typeof error === "string" ? error : error && typeof error === "object" && "message" in error ? error.message : null) ===
  "Share canceled";

export const shareBlobNative = async (input: {
  blob: Blob;
  fileName: string;
  title?: string;
  shouldShare?: () => boolean;
}): Promise<NativeShareResult> => {
  const isCurrent = () => !input.shouldShare || input.shouldShare();
  if (!isCurrent()) return { status: "discarded" };
  if (!isPluginAvailable("Filesystem") || !isPluginAvailable("Share")) return { status: "unavailable" };

  let path: string | undefined;
  try {
    const data = await blobToBase64(input.blob);
    if (!isCurrent()) return { status: "discarded" };
    path = `bazaar-share/${crypto.randomUUID()}-${safeFileName(input.fileName)}`;
    await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true });
    if (!isCurrent()) return { status: "discarded" };
    const uri = await Filesystem.getUri({ path, directory: Directory.Cache });
    if (!isCurrent()) return { status: "discarded" };
    try {
      await Share.share({
        title: input.title ?? "Bazaar",
        files: [uri.uri],
        dialogTitle: input.title ?? "Bazaar",
      });
    } catch (error) {
      // The native Share plugin rejects a dismissed sheet. It is a terminal
      // user action, not a failed preparation or a request for another download.
      if (shareWasCancelled(error)) return { status: "cancelled" };
      throw error;
    }
    return { status: "shared" };
  } catch {
    void reportNativeDiagnostic("native_share_failed");
    return { status: "failed" };
  } finally {
    if (path) {
      try {
        await Filesystem.deleteFile({ path, directory: Directory.Cache });
      } catch {
        // Cache cleanup is best effort and never exposes a permanent public URL.
      }
    }
  }
};
