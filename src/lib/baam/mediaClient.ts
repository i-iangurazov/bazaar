import { prepareManagedProductImageForUpload } from "@/lib/productImageClientUpload";
export type BaamImage = { id: string; url: string; name: string };
export async function uploadBaamImage(
  file: File,
  conversationId: string,
  locale: string,
  progress: (value: number) => void,
): Promise<BaamImage> {
  progress(0);
  const prepared = await prepareManagedProductImageForUpload({
    file,
    maxImageBytes: 3 * 1024 * 1024,
    maxInputImageBytes: 32 * 1024 * 1024,
  });
  if (!prepared.ok) throw new Error(prepared.code);
  const form = new FormData();
  form.append("conversationId", conversationId);
  form.append("locale", locale);
  form.append("kind", "image");
  form.append("file", prepared.file, prepared.file.name);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/baam/media");
    xhr.timeout = 60000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) progress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onerror = () => reject(new Error("network"));
    xhr.ontimeout = () => reject(new Error("network"));
    xhr.onload = () => {
      try {
        const result = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300)
          throw new Error(result.message ?? "baamMediaFailed");
        progress(100);
        resolve(result);
      } catch (e) {
        reject(e);
      }
    };
    xhr.send(form);
  });
}
