const splitEmails = (value: string) =>
  value
    .split(/[,;\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

export const getPlatformOwnerEmails = () => {
  const envValue = process.env.PLATFORM_OWNER_EMAILS?.trim() ?? "";
  if (!envValue) {
    return new Set<string>();
  }
  return new Set(splitEmails(envValue));
};

export const isPlatformOwnerEmail = (email?: string | null) => {
  if (!email) {
    return false;
  }
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return getPlatformOwnerEmails().has(normalized);
};
