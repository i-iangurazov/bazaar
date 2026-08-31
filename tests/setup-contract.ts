import { File } from "node:buffer";

import {
  configureTestRuntimeEnvironment,
  installTestNetworkGuard,
} from "./helpers/testRuntimeIsolation";

if (typeof globalThis.File === "undefined") {
  globalThis.File = File as unknown as typeof globalThis.File;
}

if (process.env.RUN_DB_TESTS === "1" || process.env.ALLOW_TEST_DB_RESET === "1") {
  throw new Error("[test-runtime-isolation] Contract lanes cannot enable database mutation.");
}

delete process.env.DATABASE_URL;
delete process.env.DATABASE_TEST_URL;

configureTestRuntimeEnvironment(process.env);
installTestNetworkGuard(process.env);
