import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";

import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("unit and attribute lifecycle safety", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("trims units, rejects blank/duplicate input, and guards in-use removal", async () => {
    const { org, baseUnit, managerUser } = await seedBase();
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    await expect(
      caller.units.create({ code: "   ", labelRu: "   ", labelKg: "   " }),
    ).rejects.toThrow();
    expect(await prisma.unit.count({ where: { organizationId: org.id, code: "" } })).toBe(0);

    const created = await caller.units.create({
      code: "  kg-box  ",
      labelRu: "  Коробка  ",
      labelKg: "  Кыргыз кутусу  ",
    });
    expect(created).toMatchObject({
      organizationId: org.id,
      code: "kg-box",
      labelRu: "Коробка",
      labelKg: "Кыргыз кутусу",
    });
    await expect(
      caller.units.create({
        code: "kg-box",
        labelRu: "Дубликат",
        labelKg: "Кайталанма",
      }),
    ).rejects.toMatchObject({ message: "unitCodeExists" });
    expect(await prisma.unit.count({ where: { organizationId: org.id, code: "kg-box" } })).toBe(1);

    const updated = await caller.units.update({
      unitId: `  ${created.id}  `,
      labelRu: "  Кор.  ",
      labelKg: "  Куту  ",
    });
    expect(updated).toMatchObject({ code: "kg-box", labelRu: "Кор.", labelKg: "Куту" });

    await expect(caller.units.remove({ unitId: baseUnit.id })).rejects.toMatchObject({
      message: "unitInUse",
    });
    expect(await prisma.unit.count({ where: { id: baseUnit.id } })).toBe(1);
    await caller.units.remove({ unitId: created.id });
    expect(await prisma.unit.count({ where: { id: created.id } })).toBe(0);
  });

  it("trims attributes and blocks normalized, legacy JSON, and template usage", async () => {
    const { org, product, managerUser } = await seedBase();
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    await expect(
      caller.attributes.create({
        key: "   ",
        labelRu: "   ",
        labelKg: "   ",
        type: "TEXT",
      }),
    ).rejects.toThrow();
    expect(
      await prisma.attributeDefinition.count({
        where: { organizationId: org.id, key: "" },
      }),
    ).toBe(0);

    const created = await caller.attributes.create({
      key: "  KYRGYZ_SIZE  ",
      labelRu: "  Размер  ",
      labelKg: "  Кыргыз өлчөмү  ",
      type: "SELECT",
      optionsRu: ["  Большой  "],
      optionsKg: ["  Чоң  "],
    });
    expect(created).toMatchObject({
      organizationId: org.id,
      key: "kyrgyz_size",
      labelRu: "Размер",
      labelKg: "Кыргыз өлчөмү",
      optionsRu: ["Большой"],
      optionsKg: ["Чоң"],
    });
    await expect(
      caller.attributes.create({
        key: "KYRGYZ_SIZE",
        labelRu: "Дубликат",
        labelKg: "Кайталанма",
        type: "TEXT",
      }),
    ).rejects.toMatchObject({ message: "attributeExists" });

    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        attributes: { kyrgyz_size: "Чоң" },
      },
    });
    await prisma.variantAttributeValue.create({
      data: {
        organizationId: org.id,
        productId: product.id,
        variantId: variant.id,
        key: created.key,
        value: "Чоң",
      },
    });
    await expect(caller.attributes.remove({ id: created.id })).rejects.toMatchObject({
      message: "attributeInUse",
    });

    const legacyOnly = await caller.attributes.create({
      key: "legacy_only",
      labelRu: "Наследие",
      labelKg: "Эски маани",
      type: "TEXT",
    });
    await prisma.productVariant.create({
      data: { productId: product.id, attributes: { legacy_only: "Эски" } },
    });
    await expect(caller.attributes.remove({ id: legacyOnly.id })).rejects.toMatchObject({
      message: "attributeInUse",
    });

    const templateOnly = await caller.attributes.create({
      key: "template_only",
      labelRu: "Шаблон",
      labelKg: "Калып",
      type: "TEXT",
    });
    await prisma.categoryAttributeTemplate.create({
      data: {
        organizationId: org.id,
        category: "QA category",
        attributeKey: templateOnly.key,
      },
    });
    await expect(caller.attributes.remove({ id: templateOnly.id })).rejects.toMatchObject({
      message: "attributeInUse",
    });

    const disposable = await caller.attributes.create({
      key: "disposable",
      labelRu: "Удаляемый",
      labelKg: "Өчүрүлүүчү",
      type: "TEXT",
    });
    await caller.attributes.remove({ id: `  ${disposable.id}  ` });
    expect(await prisma.attributeDefinition.count({ where: { id: disposable.id } })).toBe(0);
  });
});
