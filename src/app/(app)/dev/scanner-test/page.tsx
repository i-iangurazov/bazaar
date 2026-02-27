import { notFound } from "next/navigation";

import { getServerAuthToken } from "@/server/auth/token";
import { ScannerTestClient } from "./scanner-test-client";

const ScannerTestPage = async () => {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const token = await getServerAuthToken();
  if (token?.role !== "ADMIN") {
    notFound();
  }

  return <ScannerTestClient />;
};

export default ScannerTestPage;
