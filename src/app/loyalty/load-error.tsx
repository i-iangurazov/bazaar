"use client";

import { useRouter } from "next/navigation";
import { QueryErrorState } from "@/components/query-error-state";

export function LoyaltyLoadError() {
  const router = useRouter();
  return <QueryErrorState onRetry={() => router.refresh()} />;
}
