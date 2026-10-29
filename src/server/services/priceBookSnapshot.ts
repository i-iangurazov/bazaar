import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip, gunzipSync } from "node:zlib";
import { StringDecoder } from "node:string_decoder";
import { AppError } from "./errors";

type Rows = { prices: unknown[]; types: unknown[]; items: unknown[] };
const unavailable = () => new AppError("priceBookSnapshotUnavailable", "CONFLICT", 409);
/** Bounded chunks keep a 100,000-position snapshot out of a single huge JSON string. */
export async function encodePriceBookSnapshot<T extends Rows>(state: T) {
  const { prices, types, items, ...metadata } = state;
  async function* lines() {
    yield `${JSON.stringify({ ...metadata, prices: [], types: [], items: [] })}\n`;
    for (const [tag, rows] of [
      ["p", prices],
      ["t", types],
      ["i", items],
    ] as const) {
      for (let i = 0; i < rows.length; i += 500)
        yield rows
          .slice(i, i + 500)
          .map((row) => JSON.stringify([tag, row]))
          .join("\n") + "\n";
    }
  }
  const chunks: Buffer[] = [];
  await pipeline(
    Readable.from(lines()),
    createGzip({ level: 1 }),
    new Writable({
      write(chunk, _encoding, next) {
        chunks.push(Buffer.from(chunk));
        next();
      },
    }),
  );
  return Buffer.concat(chunks);
}

export async function decodePriceBookSnapshot<T extends Rows>(
  snapshot: Uint8Array,
  format: string,
  maxBytes = 256 * 1024 ** 2,
): Promise<T> {
  try {
    if (format === "gzip-json-v1")
      return JSON.parse(gunzipSync(snapshot, { maxOutputLength: maxBytes }).toString("utf8")) as T;
    if (format !== "ndjson-gzip-v2") throw unavailable();
    const stream = Readable.from([snapshot]).pipe(createGunzip());
    const decoder = new StringDecoder("utf8");
    let pending = "",
      total = 0,
      state: T | undefined;
    const consume = (line: string) => {
      if (!line) return;
      const row = JSON.parse(line);
      if (!state) {
        if (
          !row ||
          !["prices", "types", "items"].every((k) => Array.isArray(row[k]) && !row[k].length)
        )
          throw unavailable();
        state = row as T;
        return;
      }
      if (!Array.isArray(row) || row.length !== 2 || !row[1] || typeof row[1] !== "object")
        throw unavailable();
      if (row[0] === "p") state.prices.push(row[1]);
      else if (row[0] === "t") state.types.push(row[1]);
      else if (row[0] === "i") state.items.push(row[1]);
      else throw unavailable();
    };
    try {
      for await (const chunk of stream) {
        total += (chunk as Buffer).length;
        if (total > maxBytes) {
          stream.destroy();
          throw unavailable();
        }
        pending += decoder.write(chunk as Buffer);
        let end: number;
        while ((end = pending.indexOf("\n")) !== -1) {
          consume(pending.slice(0, end));
          pending = pending.slice(end + 1);
        }
        if (pending.length > 32 * 1024 ** 2) {
          stream.destroy();
          throw unavailable();
        }
      }
      pending += decoder.end();
      consume(pending);
      if (!state) throw unavailable();
      return state;
    } finally {
      stream.destroy();
    }
  } catch {
    throw unavailable();
  }
}
