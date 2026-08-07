import { getLogger } from "@/server/logging";
import { AppError } from "@/server/services/errors";

export const mapBazaarApiError = (error: unknown, endpoint: string) => {
  if (error instanceof AppError && error.status >= 400 && error.status < 500) {
    return { message: error.message, status: error.status };
  }

  getLogger().error({ endpoint, error }, "Bazaar API request failed");
  return { message: "genericMessage", status: 500 };
};
