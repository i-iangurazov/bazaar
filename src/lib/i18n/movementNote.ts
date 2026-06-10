import type { Formats, TranslationValues } from "next-intl";

import { parseWriteOffMovementNote } from "@/lib/inventory/writeOff";

type Translator = (key: string, values?: TranslationValues, formats?: Formats) => string;

const STOCK_COUNT_PREFIX = "stockCount:";
const STOCK_COUNT_LEGACY_PREFIX = "Stock count ";
const BUNDLE_PREFIX = "bundleAssemble:";
const BUNDLE_LEGACY_PREFIX = "Bundle assemble ";

const extractSuffix = (value: string, prefix: string) => value.slice(prefix.length).trim();

export const formatMovementNote = (tInventory: Translator, note?: string | null) => {
  if (!note) {
    return "";
  }
  const trimmed = note.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed === "importRollback") {
    return tInventory("movementNoteImportRollback");
  }

  const writeOffNote = parseWriteOffMovementNote(trimmed);
  if (writeOffNote) {
    const label = tInventory("movementNoteWriteOff", { reason: writeOffNote.reason });
    return writeOffNote.comment ? `${label} • ${writeOffNote.comment}` : label;
  }

  if (trimmed.startsWith(STOCK_COUNT_PREFIX)) {
    const code = extractSuffix(trimmed, STOCK_COUNT_PREFIX);
    return tInventory("movementNoteStockCount", { code });
  }
  if (trimmed.startsWith(STOCK_COUNT_LEGACY_PREFIX)) {
    const code = extractSuffix(trimmed, STOCK_COUNT_LEGACY_PREFIX);
    return tInventory("movementNoteStockCount", { code });
  }

  if (trimmed.startsWith(BUNDLE_PREFIX)) {
    const sku = extractSuffix(trimmed, BUNDLE_PREFIX);
    return tInventory("movementNoteBundleAssemble", { sku });
  }
  if (trimmed.startsWith(BUNDLE_LEGACY_PREFIX)) {
    const sku = extractSuffix(trimmed, BUNDLE_LEGACY_PREFIX);
    return tInventory("movementNoteBundleAssemble", { sku });
  }

  return trimmed;
};
