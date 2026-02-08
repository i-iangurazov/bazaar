const parseBool = (value: string | undefined) => {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

export const isEmailVerificationSkipped = () => parseBool(process.env.SKIP_EMAIL_VERIFICATION);

export const isEmailVerificationRequired = () => !isEmailVerificationSkipped();
