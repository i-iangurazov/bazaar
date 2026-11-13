import kgzUp from "./catalogs/kgz-up-2026-11-13.json";

/** Public commercial data used only by the server policy loader. Configuration
 * accepts a versioned identifier, never an arbitrary file or remote URL. */
export function approvedTemporaryUpgradeCatalog(source: string): unknown {
  if (source !== "KGZ_UP_2026_11_13_V1" || kgzUp.registrationVerified !== true) return null;
  return kgzUp.policy;
}
