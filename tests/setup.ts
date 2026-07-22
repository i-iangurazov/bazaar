import { File } from "node:buffer";

import {
  assertDatabaseTestExecutionPolicy,
  assertSafeTestDatabaseReset,
} from "./helpers/testDatabaseSafety";

if (typeof globalThis.File === "undefined") {
  globalThis.File = File as unknown as typeof globalThis.File;
}

const shouldRunDbTests = assertDatabaseTestExecutionPolicy();

if (process.env.DATABASE_TEST_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_TEST_URL;
}

if (shouldRunDbTests) {
  assertSafeTestDatabaseReset();
}

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET ?? "test-secret";
process.env.IMAGE_STORAGE_PROVIDER = "local";
