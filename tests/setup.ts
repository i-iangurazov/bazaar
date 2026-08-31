import { File } from "node:buffer";

import {
  assertDatabaseTestExecutionPolicy,
  assertSafeTestDatabaseReset,
} from "./helpers/testDatabaseSafety";
import {
  configureTestRuntimeEnvironment,
  installTestNetworkGuard,
} from "./helpers/testRuntimeIsolation";

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

configureTestRuntimeEnvironment(process.env);
installTestNetworkGuard(process.env);
