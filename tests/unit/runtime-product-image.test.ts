import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { GET } from "@/app/uploads/imported-products/[...path]/route";

const organization = `runtime-image-${randomUUID()}`;
const root = join(process.cwd(), "public/uploads/imported-products", organization);
const directory = join(root, "products/unassigned");
const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const fileName = `${createHash("sha1").update(image).digest("hex")}.jpg`;
const get = (path: string[]) =>
  GET(new Request("http://localhost/uploads/imported-products/test"), { params: { path } });
beforeAll(() => mkdir(directory, { recursive: true }));
afterAll(() => rm(root, { recursive: true, force: true }));
describe("runtime local product images", () => {
  it("serves an upload created after route initialization using its unchanged public URL", async () => {
    await writeFile(join(directory, fileName), image);
    const response = await get([organization, "products", "unassigned", fileName]);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(image);
  });
  it.each([
    ["..", "products", "unassigned", fileName],
    [organization, "..", "unassigned", fileName],
    [organization, "products", "../private", fileName],
    [organization, "products", "unassigned", "../../.env"],
    [organization, "products", "unassigned", `${"a".repeat(40)}.svg`],
    [organization, "products", "unassigned", `${"a".repeat(40)}.html`],
    [organization, "products", "unassigned", "secret.jpg"],
    [organization, "products", "unassigned", "a.jpg", "extra"],
  ])("rejects paths outside the generated raster filename contract: %j", async (...path) => {
    expect((await get(path)).status).toBe(404);
  });
  it("does not follow a symlink outside the public image root", async () => {
    const target = join(process.cwd(), "package.json"),
      name = `${"b".repeat(40)}.png`;
    await symlink(target, join(directory, name));
    expect((await get([organization, "products", "unassigned", name])).status).toBe(404);
  });
  it("returns not found for a missing valid image", async () => {
    expect(
      (await get([organization, "products", "unassigned", `${"c".repeat(40)}.webp`])).status,
    ).toBe(404);
  });
});
