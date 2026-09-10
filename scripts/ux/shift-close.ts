import { readFile } from "node:fs/promises";
import { verifyShiftClosing } from "../pos-shift-close/browser";
import { assertUxDatabase, uxEnvironment } from "./environment";
Object.assign(process.env, uxEnvironment());
assertUxDatabase();
const fixture = JSON.parse(await readFile("artifacts/ux/fixture.json", "utf8"));
await verifyShiftClosing(
  process.env.UX_HTTPS === "1" ? "https://localhost:3122" : "http://localhost:3122",
  {
    ...fixture,
    users: (["CASHIER", "MANAGER", "ADMIN"] as const).map((role) => ({
      role,
      email: `${role.toLowerCase()}@test.local`,
      password: "BazaarUxTest123!",
    })),
  },
  "artifacts/ux/shift-close",
);
