import { notFound } from "next/navigation";

import { ScannerTestClient } from "./scanner-test-client";

const ScannerTestPage = () => {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <ScannerTestClient />;
};

export default ScannerTestPage;
