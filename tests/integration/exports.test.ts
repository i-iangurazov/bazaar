import { promises as fs } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { ExportType } from "@prisma/client";
import * as XLSX from "xlsx";

import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";
import { runJob } from "../../src/server/jobs";
import { prisma } from "../../src/server/db/prisma";
import { resolveExportJobDownload } from "../../src/server/services/exports";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("exports", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("generates every export type with BOM and stable headers", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const periodStart = new Date("2025-01-01T00:00:00Z");
    const periodEnd = new Date("2025-01-31T23:59:59Z");
    await prisma.periodClose.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        periodStart,
        periodEnd,
        closedById: adminUser.id,
        totals: { movementCount: 0, skuCount: 0, salesTotalKgs: 0, purchasesTotalKgs: 0 },
      },
    });

    const headers: Record<ExportType, string> = {
      INVENTORY_MOVEMENTS_LEDGER:
        "ID организации,Код магазина,Магазин,ID движения,Тип движения,Дата движения,Артикул,Артикул варианта,Товар,Вариант,Штрихкод,Изменение кол-ва,Ед.,Цена за ед. KGS,Сумма себестоимости KGS,Цена продажи KGS,Причина,Тип документа,Номер документа,Пользователь,ID запроса",
      INVENTORY_BALANCES_AT_DATE:
        "ID организации,Код магазина,Артикул,Артикул варианта,Товар,В наличии,Ед.,Средняя себестоимость KGS,Стоимость остатков KGS",
      PURCHASES_RECEIPTS:
        "ID организации,Код магазина,Поставщик,ИНН поставщика,Номер закупки,Дата приемки,Артикул,Кол-во,Ед.,Цена за ед. KGS,Сумма строки KGS",
      PRICE_LIST:
        "ID организации,Код магазина,Артикул,Товар,Базовая цена KGS,Цена магазина KGS,Цена продажи KGS,Средняя себестоимость KGS,Маржа %,Наценка %",
      SALES_SUMMARY: "Дата,Магазин,Продано шт.,Операций",
      STOCK_MOVEMENTS:
        "Дата,Магазин,Артикул,Товар,Вариант,Тип движения,Изменение кол-ва,Основание,Автор",
      PURCHASES:
        "ID закупки,Статус,Создано,Дата приемки,Магазин,Поставщик,Артикул,Товар,Вариант,Заказано,Принято,Цена за ед. KGS,Сумма строки KGS",
      INVENTORY_ON_HAND:
        "Магазин,Артикул,Товар,Вариант,В наличии,В заказе,Мин. остаток,Точка заказа,Цена продажи KGS",
      PERIOD_CLOSE_REPORT:
        "Магазин,Начало периода,Конец периода,Закрыто,Операций,Товаров,Продажи KGS,Закупки KGS",
      RECEIPTS_FOR_KKM: "ID чека,Дата,Магазин,Артикул,Товар,Вариант,Кол-во",
      RECEIPTS_REGISTRY:
        "ID организации,Код магазина,Магазин,Номер чека,Создано,Завершено,Статус,Код кассы,Касса,Кассир,Валюта,Курс к KGS,Итого KGS,Наличные KGS,Карта KGS,Перевод KGS,Другое KGS,Статус ККМ,Фискальный статус,Фискальный режим,Фискальный номер,ID чека провайдера,Ошибка фискализации",
      SHIFT_X_REPORT:
        "ID организации,Код магазина,Тип отчета,ID смены,Статус,Валюта,Курс к KGS,Код кассы,Касса,Открыта,Открыл,Закрыто,Закрыл,Кол-во продаж,Продажи KGS,Продажи наличными KGS,Безналичные продажи KGS,Продажи картой KGS,Продажи переводом KGS,Прочие продажи KGS,Кол-во возвратов,Возвраты KGS,Возвраты наличными KGS,Безналичные возвраты KGS,Возвраты на карту KGS,Возвраты переводом KGS,Прочие возвраты KGS,Безналичный итог KGS,Наличные на открытии KGS,Внесения KGS,Изъятия KGS,Расчетная наличность KGS,Сверхизъятие KGS,Пересчитанная наличность KGS,Расхождение KGS",
      SHIFT_Z_REPORT:
        "ID организации,Код магазина,Тип отчета,ID смены,Статус,Валюта,Курс к KGS,Код кассы,Касса,Открыта,Открыл,Закрыто,Закрыл,Кол-во продаж,Продажи KGS,Продажи наличными KGS,Безналичные продажи KGS,Продажи картой KGS,Продажи переводом KGS,Прочие продажи KGS,Кол-во возвратов,Возвраты KGS,Возвраты наличными KGS,Безналичные возвраты KGS,Возвраты на карту KGS,Возвраты переводом KGS,Прочие возвраты KGS,Безналичный итог KGS,Наличные на открытии KGS,Внесения KGS,Изъятия KGS,Расчетная наличность KGS,Сверхизъятие KGS,Пересчитанная наличность KGS,Расхождение KGS",
      SALES_BY_DAY: "ID организации,Код магазина,Дата,Чеков,Выручка KGS",
      SALES_BY_ITEM:
        "ID организации,Код магазина,Артикул,Товар,Артикул варианта,Вариант,Кол-во,Выручка KGS",
      RETURNS_BY_DAY: "ID организации,Код магазина,Дата,Кол-во возвратов,Возвраты KGS",
      RETURNS_BY_ITEM:
        "ID организации,Код магазина,Артикул,Товар,Артикул варианта,Вариант,Кол-во,Возвраты KGS",
      CASH_DRAWER_MOVEMENTS:
        "ID организации,Код магазина,Создано,ID смены,Код кассы,Касса,Тип,Валюта,Курс к KGS,Сумма KGS,Причина,Создал",
      MARKING_SALES_REGISTRY:
        "ID организации,Код магазина,Зафиксировано,Номер чека,Чек создан,Артикул,Товар,Кол-во,Код маркировки,Зафиксировал",
      ETTN_REFERENCES:
        "ID организации,Код магазина,Создано,Тип документа,ID документа,Номер ЭТТН,Дата ЭТТН,Примечание,Создал",
      ESF_REFERENCES:
        "ID организации,Код магазина,Создано,Тип документа,ID документа,Номер ЭСФ,Дата ЭСФ,Контрагент,Создал",
    };

    expect(Object.keys(headers).sort()).toEqual(Object.values(ExportType).sort());

    for (const type of Object.values(ExportType)) {
      const created = await caller.exports.create({
        storeId: store.id,
        type,
        format: "csv",
        periodStart,
        periodEnd,
      });

      await runJob("export-job", { jobId: created.id });
      const job = await caller.exports.get({ jobId: created.id });

      expect(job).not.toBeNull();
      if (!job) {
        throw new Error("export job missing");
      }

      expect(job.status).toBe("DONE");
      expect(job.storagePath).toBeTruthy();
      expect(job.downloadAvailable).toBe(true);
      expect(job.downloadUrl).toBe(`/api/exports/${job.id}`);
      expect(job.downloadUnavailableReason).toBeNull();

      const csv = await fs.readFile(job.storagePath ?? "", "utf8");
      expect(job.mimeType).toBe("text/csv;charset=utf-8");
      expect(job.fileName?.endsWith(".csv")).toBe(true);
      expect(csv.startsWith("\ufeff")).toBe(true);
      const header = csv.replace(/^\ufeff/, "").split(/\r?\n/)[0]?.trim();
      expect(header).toBe(headers[type]);
    }
  }, 60_000);

  it("generates XLSX exports with stable headers", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const created = await caller.exports.create({
      storeId: store.id,
      type: ExportType.PRICE_LIST,
      format: "xlsx",
      periodStart: new Date("2025-01-01T00:00:00Z"),
      periodEnd: new Date("2025-01-31T23:59:59Z"),
    });

    await runJob("export-job", { jobId: created.id });
    const job = await caller.exports.get({ jobId: created.id });

    expect(job).not.toBeNull();
    if (!job) {
      throw new Error("export job missing");
    }
    expect(job.status).toBe("DONE");
    expect(job.downloadAvailable).toBe(true);
    expect(job.downloadUrl).toBe(`/api/exports/${job.id}`);
    expect(job.downloadUnavailableReason).toBeNull();
    const xlsx = await fs.readFile(job.storagePath ?? "");
    expect(job.mimeType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(job.fileName?.endsWith(".xlsx")).toBe(true);
    const workbook = XLSX.read(xlsx, { type: "buffer" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
    const values = XLSX.utils.sheet_to_json<string[]>(firstSheet, {
      header: 1,
      blankrows: false,
    });
    const header = (values[0] ?? []).map(String).join(",");
    expect(header).toBe(
      "ID организации,Код магазина,Артикул,Товар,Базовая цена KGS,Цена магазина KGS,Цена продажи KGS,Средняя себестоимость KGS,Маржа %,Наценка %",
    );
  });

  it("enforces RBAC on export generation", async () => {
    const { org, store, staffUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: staffUser.id,
      email: staffUser.email,
      role: staffUser.role,
      organizationId: org.id,
    });

    await expect(
      caller.exports.create({
        storeId: store.id,
        type: ExportType.INVENTORY_MOVEMENTS_LEDGER,
        periodStart: new Date("2025-01-01T00:00:00Z"),
        periodEnd: new Date("2025-01-31T23:59:59Z"),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("marks completed exports unavailable when the generated file is missing", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const created = await caller.exports.create({
      storeId: store.id,
      type: ExportType.PRICE_LIST,
      format: "csv",
      periodStart: new Date("2025-01-01T00:00:00Z"),
      periodEnd: new Date("2025-01-31T23:59:59Z"),
    });

    await runJob("export-job", { jobId: created.id });
    const completed = await caller.exports.get({ jobId: created.id });
    expect(completed?.storagePath).toBeTruthy();
    if (!completed?.storagePath) {
      throw new Error("export storage path missing");
    }
    await fs.unlink(completed.storagePath);

    const missing = await caller.exports.get({ jobId: created.id });
    expect(missing?.status).toBe("DONE");
    expect(missing?.downloadAvailable).toBe(false);
    expect(missing?.downloadUrl).toBeNull();
    expect(missing?.downloadUnavailableReason).toBe("exportFileMissing");
  });

  it("regenerates a missing completed export when the download route is opened", async () => {
    const { org, store, adminUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const created = await caller.exports.create({
      storeId: store.id,
      type: ExportType.PRICE_LIST,
      format: "csv",
      periodStart: new Date("2025-01-01T00:00:00Z"),
      periodEnd: new Date("2025-01-31T23:59:59Z"),
    });

    await runJob("export-job", { jobId: created.id });
    const completed = await caller.exports.get({ jobId: created.id });
    expect(completed?.storagePath).toBeTruthy();
    if (!completed?.storagePath) {
      throw new Error("export storage path missing");
    }
    await fs.unlink(completed.storagePath);

    const download = await resolveExportJobDownload({
      organizationId: org.id,
      jobId: created.id,
      user: {
        id: adminUser.id,
        organizationId: org.id,
        role: adminUser.role,
        isOrgOwner: true,
        isPlatformOwner: false,
      },
    });

    const chunks: Buffer[] = [];
    for await (const chunk of download.stream) {
      chunks.push(Buffer.from(chunk));
    }
    const csv = Buffer.concat(chunks).toString("utf8");

    expect(download.fileName).toBe(
      `price-list-2025-01-01_to_2025-01-31-${created.id.slice(0, 8)}.csv`,
    );
    expect(download.fileSize).toBe(Buffer.byteLength(csv));
    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(csv).toContain("ID организации,Код магазина,Артикул,Товар");

    const refreshed = await caller.exports.get({ jobId: created.id });
    expect(refreshed?.downloadAvailable).toBe(true);
    expect(refreshed?.downloadUrl).toBe(`/api/exports/${created.id}`);
    expect(refreshed?.downloadUnavailableReason).toBeNull();
  });
});
