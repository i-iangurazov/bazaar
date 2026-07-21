export const POS_REGISTER_STORAGE_PREFIX = "bazaar:pos:register";

export type PosRegisterResolutionSource =
  | "explicit"
  | "persisted"
  | "server-preference"
  | "only-accessible"
  | "selector";

export type PosRegisterResolutionIssue = "invalid-explicit" | "invalid-persisted" | null;

type PosRegisterCandidate = {
  id: string;
  isActive: boolean;
};

export const buildPosRegisterStorageKey = ({
  organizationId,
  userId,
}: {
  organizationId?: string | null;
  userId?: string | null;
}) => {
  if (!organizationId || !userId) {
    return null;
  }
  return `${POS_REGISTER_STORAGE_PREFIX}:${organizationId}:${userId}`;
};

export const resolvePosRegisterContext = ({
  explicitRegisterId,
  persistedRegisterId,
  serverPreferenceId,
  registers,
}: {
  explicitRegisterId?: string | null;
  persistedRegisterId?: string | null;
  serverPreferenceId?: string | null;
  registers: readonly PosRegisterCandidate[];
}): {
  registerId: string | null;
  source: PosRegisterResolutionSource;
  issue: PosRegisterResolutionIssue;
  clearPersistedRegister: boolean;
} => {
  const activeRegisterIds = new Set(
    registers.filter((register) => register.isActive).map((register) => register.id),
  );

  if (explicitRegisterId) {
    if (activeRegisterIds.has(explicitRegisterId)) {
      return {
        registerId: explicitRegisterId,
        source: "explicit",
        issue: null,
        clearPersistedRegister: false,
      };
    }
    return {
      registerId: null,
      source: "selector",
      issue: "invalid-explicit",
      clearPersistedRegister: false,
    };
  }

  if (persistedRegisterId) {
    if (activeRegisterIds.has(persistedRegisterId)) {
      return {
        registerId: persistedRegisterId,
        source: "persisted",
        issue: null,
        clearPersistedRegister: false,
      };
    }
    return {
      registerId: null,
      source: "selector",
      issue: "invalid-persisted",
      clearPersistedRegister: true,
    };
  }

  if (serverPreferenceId && activeRegisterIds.has(serverPreferenceId)) {
    return {
      registerId: serverPreferenceId,
      source: "server-preference",
      issue: null,
      clearPersistedRegister: false,
    };
  }

  if (activeRegisterIds.size === 1) {
    return {
      registerId: Array.from(activeRegisterIds)[0] ?? null,
      source: "only-accessible",
      issue: null,
      clearPersistedRegister: false,
    };
  }

  return {
    registerId: null,
    source: "selector",
    issue: null,
    clearPersistedRegister: false,
  };
};
