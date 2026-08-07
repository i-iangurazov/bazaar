import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";

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

  it("atomically migrates variant JSON and normalized references when a key changes", async () => {
    const { org, product, managerUser } = await seedBase();
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });
    const definition = await caller.attributes.create({
      key: "color",
      labelRu: "Цвет",
      labelKg: "Түс",
      type: "SELECT",
      optionsRu: ["Красный", "Синий"],
      optionsKg: ["Кызыл", "Көк"],
    });
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        name: "Red",
        attributes: { color: "Красный", retained: "yes" },
      },
    });
    await prisma.variantAttributeValue.create({
      data: {
        organizationId: org.id,
        productId: product.id,
        variantId: variant.id,
        key: "color",
        value: "Красный",
      },
    });
    await prisma.categoryAttributeTemplate.create({
      data: {
        organizationId: org.id,
        category: "Clothing",
        attributeKey: "color",
      },
    });

    const updated = await caller.attributes.update({
      id: definition.id,
      key: "shade",
      labelRu: "Оттенок",
      labelKg: "Өң",
      type: "SELECT",
      optionsRu: ["Красный", "Синий", "Зеленый"],
      optionsKg: ["Кызыл", "Көк", "Жашыл"],
    });

    const [storedVariant, normalized, template, audits] = await Promise.all([
      prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } }),
      prisma.variantAttributeValue.findUniqueOrThrow({
        where: { variantId_key: { variantId: variant.id, key: "shade" } },
      }),
      prisma.categoryAttributeTemplate.findUniqueOrThrow({
        where: {
          organizationId_category_attributeKey: {
            organizationId: org.id,
            category: "Clothing",
            attributeKey: "shade",
          },
        },
      }),
      prisma.auditLog.findMany({
        where: { organizationId: org.id, action: "ATTRIBUTE_UPDATE", entityId: definition.id },
      }),
    ]);

    expect(updated.key).toBe("shade");
    expect(storedVariant.attributes).toEqual({ shade: "Красный", retained: "yes" });
    expect(normalized.value).toBe("Красный");
    expect(template.attributeKey).toBe("shade");
    expect(audits).toHaveLength(1);
  });

  it("rejects incompatible edits of an in-use option without partial state", async () => {
    const { org, product, managerUser } = await seedBase();
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });
    const definition = await caller.attributes.create({
      key: "color",
      labelRu: "Цвет",
      labelKg: "Түс",
      type: "SELECT",
      optionsRu: ["Красный", "Синий"],
      optionsKg: ["Кызыл", "Көк"],
    });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, attributes: { color: "Красный" } },
    });
    await prisma.variantAttributeValue.create({
      data: {
        organizationId: org.id,
        productId: product.id,
        variantId: variant.id,
        key: "color",
        value: "Красный",
      },
    });
    const auditCountBefore = await prisma.auditLog.count();

    await expect(
      caller.attributes.update({
        id: definition.id,
        key: "shade",
        labelRu: "Оттенок",
        labelKg: "Өң",
        type: "SELECT",
        optionsRu: ["Синий"],
        optionsKg: ["Көк"],
      }),
    ).rejects.toMatchObject({ message: "attributeInUse" });

    const [storedDefinition, storedVariant, normalized, auditCountAfter] = await Promise.all([
      prisma.attributeDefinition.findUniqueOrThrow({ where: { id: definition.id } }),
      prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } }),
      prisma.variantAttributeValue.findUniqueOrThrow({
        where: { variantId_key: { variantId: variant.id, key: "color" } },
      }),
      prisma.auditLog.count(),
    ]);
    expect(storedDefinition.key).toBe("color");
    expect(storedDefinition.optionsRu).toEqual(["Красный", "Синий"]);
    expect(storedVariant.attributes).toEqual({ color: "Красный" });
    expect(normalized.value).toBe("Красный");
    expect(auditCountAfter).toBe(auditCountBefore);
  });

  it("rejects a rename that would overwrite an existing variant JSON key", async () => {
    const { org, product, managerUser } = await seedBase();
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });
    const definition = await caller.attributes.create({
      key: "color",
      labelRu: "Цвет",
      labelKg: "Түс",
      type: "TEXT",
    });
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        attributes: { color: "red", shade: "legacy" },
      },
    });
    await prisma.variantAttributeValue.create({
      data: {
        organizationId: org.id,
        productId: product.id,
        variantId: variant.id,
        key: "color",
        value: "red",
      },
    });

    await expect(
      caller.attributes.update({
        id: definition.id,
        key: "shade",
        labelRu: "Оттенок",
        labelKg: "Өң",
        type: "TEXT",
      }),
    ).rejects.toMatchObject({ message: "attributeExists" });

    const [storedDefinition, storedVariant] = await Promise.all([
      prisma.attributeDefinition.findUniqueOrThrow({ where: { id: definition.id } }),
      prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } }),
    ]);
    expect(storedDefinition.key).toBe("color");
    expect(storedVariant.attributes).toEqual({ color: "red", shade: "legacy" });
  });
});
