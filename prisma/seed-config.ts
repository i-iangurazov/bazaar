export type SeedEnvironment = Readonly<Record<string, string | undefined>>;

export type DevelopmentSeedUser = {
  email: string;
  name: string;
  password: string;
};

export type DevelopmentSeedConfiguration = {
  users: {
    admin: DevelopmentSeedUser;
    manager: DevelopmentSeedUser;
    staff: DevelopmentSeedUser;
    platformOwner: DevelopmentSeedUser;
  };
};

type SeedUserKey = keyof DevelopmentSeedConfiguration["users"];

type SeedUserDefinition = {
  key: SeedUserKey;
  emailEnvironmentVariable: string;
  passwordEnvironmentVariable: string;
  name: string;
};

const SEED_USER_DEFINITIONS = [
  {
    key: "admin",
    emailEnvironmentVariable: "SEED_ADMIN_EMAIL",
    passwordEnvironmentVariable: "SEED_ADMIN_PASSWORD",
    name: "Admin User",
  },
  {
    key: "manager",
    emailEnvironmentVariable: "SEED_MANAGER_EMAIL",
    passwordEnvironmentVariable: "SEED_MANAGER_PASSWORD",
    name: "Manager User",
  },
  {
    key: "staff",
    emailEnvironmentVariable: "SEED_STAFF_EMAIL",
    passwordEnvironmentVariable: "SEED_STAFF_PASSWORD",
    name: "Staff User",
  },
  {
    key: "platformOwner",
    emailEnvironmentVariable: "SEED_PLATFORM_OWNER_EMAIL",
    passwordEnvironmentVariable: "SEED_PLATFORM_OWNER_PASSWORD",
    name: "Platform Owner",
  },
] as const satisfies readonly SeedUserDefinition[];

const LOCAL_SEED_NODE_ENVIRONMENTS = new Set(["development", "test"]);
const MINIMUM_SEED_PASSWORD_LENGTH = 20;
const MAXIMUM_SEED_PASSWORD_LENGTH = 128;
const DISALLOWED_PASSWORD_FRAGMENTS = [
  "admin",
  "bazaar",
  "changeme",
  "demo",
  "example",
  "letmein",
  "manager",
  "owner",
  "password",
  "qwerty",
  "staff",
  "welcome",
];

export class SeedConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedConfigurationError";
  }
}

const requireEnvironmentValue = (environment: SeedEnvironment, variableName: string) => {
  const value = environment[variableName];
  if (!value?.trim()) {
    throw new SeedConfigurationError(`${variableName} is required for local demo seeding.`);
  }
  return value;
};

const validateEmail = (email: string, variableName: string) => {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new SeedConfigurationError(`${variableName} must contain a valid email address.`);
  }
  return normalized;
};

const validatePassword = (password: string, variableName: string, email: string) => {
  const length = Array.from(password).length;
  const hasRequiredCharacterClasses =
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9\s]/.test(password);
  const normalized = password.toLowerCase();
  const emailLocalPart = email.split("@", 1)[0] ?? "";
  const containsIdentity = emailLocalPart.length >= 4 && normalized.includes(emailLocalPart);
  const containsDisallowedFragment = DISALLOWED_PASSWORD_FRAGMENTS.some((fragment) =>
    normalized.includes(fragment),
  );

  if (
    length < MINIMUM_SEED_PASSWORD_LENGTH ||
    length > MAXIMUM_SEED_PASSWORD_LENGTH ||
    /\s/.test(password) ||
    !hasRequiredCharacterClasses ||
    containsIdentity ||
    containsDisallowedFragment
  ) {
    throw new SeedConfigurationError(
      `${variableName} must be ${MINIMUM_SEED_PASSWORD_LENGTH}-${MAXIMUM_SEED_PASSWORD_LENGTH} characters, contain upper-case, lower-case, numeric, and symbol characters, contain no whitespace or account identifier, and not use a common credential phrase.`,
    );
  }

  return password;
};

const assertLocalSeedTarget = (environment: SeedEnvironment) => {
  const nodeEnvironment = environment.NODE_ENV?.trim().toLowerCase() ?? "";
  if (!LOCAL_SEED_NODE_ENVIRONMENTS.has(nodeEnvironment)) {
    throw new SeedConfigurationError(
      "Demo seeding is allowed only when NODE_ENV is explicitly development or test.",
    );
  }

  if (environment.VERCEL_ENV?.trim()) {
    throw new SeedConfigurationError("Demo seeding is disabled for every Vercel deployment.");
  }

  if (environment.SEED_DEMO_DATA !== "1") {
    throw new SeedConfigurationError(
      "Set SEED_DEMO_DATA=1 to explicitly opt in to local demo seeding.",
    );
  }
};

export const resolveDevelopmentSeedConfiguration = (
  environment: SeedEnvironment,
): DevelopmentSeedConfiguration => {
  assertLocalSeedTarget(environment);

  const users = Object.fromEntries(
    SEED_USER_DEFINITIONS.map((definition) => {
      const email = validateEmail(
        requireEnvironmentValue(environment, definition.emailEnvironmentVariable),
        definition.emailEnvironmentVariable,
      );
      const password = validatePassword(
        requireEnvironmentValue(environment, definition.passwordEnvironmentVariable),
        definition.passwordEnvironmentVariable,
        email,
      );
      const name =
        definition.key === "platformOwner"
          ? environment.SEED_PLATFORM_OWNER_NAME?.trim() || definition.name
          : definition.name;

      return [definition.key, { email, name, password }];
    }),
  ) as DevelopmentSeedConfiguration["users"];

  const uniqueEmails = new Set(Object.values(users).map((user) => user.email));
  if (uniqueEmails.size !== SEED_USER_DEFINITIONS.length) {
    throw new SeedConfigurationError("Every seeded user must have a unique email address.");
  }

  const normalizedPasswords = Object.values(users).map((user) => user.password.toLowerCase());
  if (new Set(normalizedPasswords).size !== SEED_USER_DEFINITIONS.length) {
    throw new SeedConfigurationError(
      "Every seeded user must have a unique password, including the platform owner.",
    );
  }

  const platformOwnerAllowlist = new Set(
    (environment.PLATFORM_OWNER_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  if (!platformOwnerAllowlist.has(users.platformOwner.email)) {
    throw new SeedConfigurationError(
      "PLATFORM_OWNER_EMAILS must include SEED_PLATFORM_OWNER_EMAIL before seeding.",
    );
  }

  return { users };
};

export const runWithDevelopmentSeedConfiguration = async <Result>(
  environment: SeedEnvironment,
  operation: (configuration: DevelopmentSeedConfiguration) => Promise<Result>,
) => operation(resolveDevelopmentSeedConfiguration(environment));

export const getSafeSeedFailureMessage = (error: unknown) => {
  if (error instanceof SeedConfigurationError) {
    return `[seed] Configuration rejected: ${error.message}`;
  }
  return "[seed] Seed failed. Environment values and credentials were not logged.";
};
