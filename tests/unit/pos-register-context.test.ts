import { describe, expect, it } from "vitest";

import {
  buildPosRegisterStorageKey,
  resolvePosRegisterContext,
} from "@/lib/posRegisterContext";

const registers = [
  { id: "register-a", isActive: true },
  { id: "register-b", isActive: true },
  { id: "register-disabled", isActive: false },
];

describe("POS register context", () => {
  it("scopes the browser preference by organization and authenticated user", () => {
    expect(buildPosRegisterStorageKey({ organizationId: "org-a", userId: "user-a" })).toBe(
      "bazaar:pos:register:org-a:user-a",
    );
    expect(buildPosRegisterStorageKey({ organizationId: "org-a", userId: "user-b" })).not.toBe(
      buildPosRegisterStorageKey({ organizationId: "org-a", userId: "user-a" }),
    );
    expect(buildPosRegisterStorageKey({ organizationId: null, userId: "user-a" })).toBeNull();
  });

  it("gives a valid explicit URL register priority over persisted and server preferences", () => {
    expect(
      resolvePosRegisterContext({
        explicitRegisterId: "register-b",
        persistedRegisterId: "register-a",
        serverPreferenceId: "register-a",
        registers,
      }),
    ).toMatchObject({ registerId: "register-b", source: "explicit", issue: null });
  });

  it("restores a valid persisted register for the current user", () => {
    expect(
      resolvePosRegisterContext({
        persistedRegisterId: "register-a",
        serverPreferenceId: "register-b",
        registers,
      }),
    ).toMatchObject({ registerId: "register-a", source: "persisted", issue: null });
  });

  it("clears an unavailable persisted register and does not pick another one", () => {
    expect(
      resolvePosRegisterContext({
        persistedRegisterId: "register-disabled",
        registers,
      }),
    ).toEqual({
      registerId: null,
      source: "selector",
      issue: "invalid-persisted",
      clearPersistedRegister: true,
    });
  });

  it("does not fall back when an explicit register is inaccessible", () => {
    expect(
      resolvePosRegisterContext({ explicitRegisterId: "other-org-register", registers }),
    ).toMatchObject({ registerId: null, source: "selector", issue: "invalid-explicit" });
  });

  it("auto-selects only when exactly one active register is accessible", () => {
    expect(
      resolvePosRegisterContext({
        registers: [
          { id: "only-register", isActive: true },
          { id: "disabled", isActive: false },
        ],
      }),
    ).toMatchObject({ registerId: "only-register", source: "only-accessible" });

    expect(resolvePosRegisterContext({ registers })).toMatchObject({
      registerId: null,
      source: "selector",
      issue: null,
    });
  });
});
