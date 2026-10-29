import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

export default mergeConfig(base, defineConfig({
  test: {
    globalSetup: "./scripts/pooling/setup.ts",
    include: [
      "tests/integration/database-pooling.test.ts",
      "tests/integration/fractional-quantities.test.ts",
      "tests/integration/inventory.test.ts",
      "tests/integration/store-isolation.test.ts",
      "tests/integration/large-transfer.test.ts",
      "tests/integration/store-product-visibility.test.ts",
      "tests/integration/product-price-types.test.ts",
      "tests/integration/price-books.test.ts",
      "tests/integration/catalog-pricing-regressions.test.ts",
      "tests/integration/transfer-line-context.test.ts",
    ],
  },
}));
