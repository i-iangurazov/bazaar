import assert from "node:assert/strict";
import type { Page } from "playwright";
import { expect } from "playwright/test";

export async function verifyPosSearchSelection(page: Page, touch = false) {
  const search = page.locator("input[role=combobox]").filter({ visible: true }).first();
  const query = "Смеситель GF-2106 Titan";
  const selection = () => search.evaluate((input: HTMLInputElement) => ({
    start: input.selectionStart!, end: input.selectionEnd!, length: input.value.length,
  }));
  const activate = async (position?: { x: number; y: number }) => {
    if (touch) await search.tap({ position });
    else await search.click({ position });
  };
  await expect(search).toBeEnabled({ timeout: 60_000 });
  await search.fill(query);
  await search.blur();
  await activate();
  assert.deepEqual(await selection(), { start: 0, end: query.length, length: query.length },
    "First focus must select the query for replacement");

  const box = await search.boundingBox();
  assert(box);
  await activate({ x: Math.min(55, box.width / 3), y: box.height / 2 });
  const caret = await selection();
  assert.equal(caret.start, caret.end, "Second interaction must place a caret");
  assert(caret.start < query.length, "Caret should be inside the query");
  await search.pressSequentially("X");
  await expect(search).toHaveValue(query.slice(0, caret.start) + "X" + query.slice(caret.end));

  if (!touch) {
    await search.fill(query);
    await search.dblclick({ position: { x: Math.min(55, box.width / 3), y: box.height / 2 } });
    const word = await selection();
    assert(word.end > word.start && word.end - word.start < query.length,
      "Native word selection must remain available");
    await search.pressSequentially("Кран");
    await expect(search).toHaveValue(query.slice(0, word.start) + "Кран" + query.slice(word.end));
  }

  await search.blur();
  await activate();
  const refocused = await selection();
  assert.equal(refocused.start, 0);
  assert.equal(refocused.end, refocused.length, "Re-entering must allow replacing the whole query");
  await search.locator("..").getByRole("button", { name: "Очистить поиск", exact: true }).click();
  await expect(search).toHaveValue("");
  assert(await search.evaluate(input => document.activeElement === input), "Clear must retain focus");
  await expect(search.locator("..").getByRole("button", { name: "Сканировать камерой", exact: true })).toBeVisible();
}
