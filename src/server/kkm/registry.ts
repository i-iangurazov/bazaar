import { AppError } from "@/server/services/errors";
import type { KkmAdapter } from "@/server/kkm/adapter";

const stubAdapter: KkmAdapter = {
  health: async () => ({ ok: false, message: "kkmNotConfigured" }),
  fiscalizeReceipt: async () => {
    throw new AppError("kkmNotConfigured", "BAD_REQUEST", 400);
  },
};

export const getKkmAdapter = (providerKey?: string | null): KkmAdapter => {
  if (!providerKey || providerKey === "stub") {
    return stubAdapter;
  }
  return stubAdapter;
};
