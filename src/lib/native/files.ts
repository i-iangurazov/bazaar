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

export const shareBlobNative = async (input: {
  blob: Blob;
  fileName: string;
  title?: string;
}): Promise<boolean> => {
  if (!isPluginAvailable("Filesystem") || !isPluginAvailable("Share")) return false;

  const path = `bazaar-share/${crypto.randomUUID()}-${safeFileName(input.fileName)}`;
  try {
    const data = await blobToBase64(input.blob);
    await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true });
    const uri = await Filesystem.getUri({ path, directory: Directory.Cache });
    await Share.share({
      title: input.title ?? "Bazaar",
      files: [uri.uri],
      dialogTitle: input.title ?? "Bazaar",
    });
    return true;
  } catch {
    void reportNativeDiagnostic("native_share_failed");
    return false;
  } finally {
    try {
      await Filesystem.deleteFile({ path, directory: Directory.Cache });
    } catch {
      // Cache cleanup is best effort and never exposes a permanent public URL.
    }
  }
};
