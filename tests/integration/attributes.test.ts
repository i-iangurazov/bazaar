import { beforeEach, describe, expect, it } from "vitest";

import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("attribute definitions", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates and updates attribute definitions", async () => {
    const { org, managerUser } = await seedBase();
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    const created = await caller.attributes.create({
      key: "color",
      labelRu: "Цвет",
      labelKg: "Түс",
      type: "SELECT",
      optionsRu: ["Красный", "Синий"],
      optionsKg: ["Кызыл", "Көк"],
      required: true,
    });

    expect(created.key).toBe("color");

    const updated = await caller.attributes.update({
      id: created.id,
      key: "color",
      labelRu: "Цвет",
      labelKg: "Түс",
      type: "SELECT",
      optionsRu: ["Красный", "Синий", "Зеленый"],
      optionsKg: ["Кызыл", "Көк", "Жашыл"],
      required: false,
    });

    expect(updated.optionsRu).toHaveLength(3);
    expect(updated.required).toBe(false);

    const list = await caller.attributes.list();
    expect(list).toHaveLength(1);
  });
});
