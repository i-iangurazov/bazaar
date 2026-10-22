// An exact orthographic/number alias, never edit-distance or fuzzy matching.
// Resolution still happens against authorized catalog rows, with ambiguity kept.
export function baamSpokenSkuKey(value: string) {
  const numbers: Record<string, string> = {
    ноль: "0",
    zero: "0",
    нөл: "0",
    один: "1",
    одна: "1",
    one: "1",
    бир: "1",
    два: "2",
    две: "2",
    two: "2",
    эки: "2",
    три: "3",
    three: "3",
    үч: "3",
    четыре: "4",
    four: "4",
    төрт: "4",
    пять: "5",
    five: "5",
    беш: "5",
    шесть: "6",
    six: "6",
    алты: "6",
    семь: "7",
    seven: "7",
    жети: "7",
    восемь: "8",
    eight: "8",
    сегиз: "8",
    девять: "9",
    nine: "9",
    тогуз: "9",
    десять: "10",
    ten: "10",
    он: "10",
  };
  const match = /^([\p{L}]+(?:[\s._-]+[\p{L}]+)*?)(?:[\s._-]*(\d+)|[\s._-]+([\p{L}]+))$/u.exec(
    value.normalize("NFKC").trim().toLowerCase(),
  );
  if (!match) return null;
  const suffix = match[2] ?? numbers[match[3]];
  if (!suffix || !/^\d{1,12}$/.test(suffix)) return null;
  const native = match[1].replace(/[\s._-]/g, "");
  const letters: Record<string, string> = {
    а: "a",
    б: "b",
    в: "v",
    г: "g",
    д: "d",
    е: "e",
    ё: "e",
    ж: "zh",
    з: "z",
    и: "i",
    й: "j",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "h",
    ц: "ts",
    ч: "ch",
    ш: "sh",
    щ: "shch",
    ы: "y",
    э: "e",
    ю: "yu",
    я: "ya",
    ө: "o",
    ү: "u",
    ң: "ng",
  };
  const roman = [...native].map((c) => letters[c] ?? c).join("");
  if (!/^[a-z]+$/.test(roman)) return null;
  return {
    key: roman + String(Number(suffix)),
    prefixes: [...new Set([native.slice(0, 2), roman.slice(0, 2)])],
  };
}
