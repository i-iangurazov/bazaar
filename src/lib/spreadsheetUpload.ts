export const spreadsheetUploadAccept = ".csv,text/csv,.xlsx,.xls";
export const spreadsheetUploadMaxBytes = 10 * 1024 * 1024;

const allowedExtensions = new Set(["csv", "xlsx", "xls"]);
const allowedMimeTypes = new Set([
  "text/csv",
  "text/plain",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
]);

export type SpreadsheetUploadValidation =
  | { ok: true; extension: "csv" | "xlsx" | "xls" }
  | { ok: false; code: "fileInvalidType" | "fileEmpty" | "importTooLarge" };

export const validateSpreadsheetUploadFile = (
  file: Pick<File, "name" | "size" | "type">,
): SpreadsheetUploadValidation => {
  if (!Number.isFinite(file.size) || file.size < 1) {
    return { ok: false, code: "fileEmpty" };
  }
  if (file.size > spreadsheetUploadMaxBytes) {
    return { ok: false, code: "importTooLarge" };
  }

  const extension = file.name.trim().toLowerCase().split(".").pop() ?? "";
  if (!allowedExtensions.has(extension)) {
    return { ok: false, code: "fileInvalidType" };
  }
  const mimeType = file.type.toLowerCase().split(";")[0]?.trim() ?? "";
  if (mimeType && !allowedMimeTypes.has(mimeType)) {
    return { ok: false, code: "fileInvalidType" };
  }
  return { ok: true, extension: extension as "csv" | "xlsx" | "xls" };
};
