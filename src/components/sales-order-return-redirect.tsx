"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";

import { Spinner } from "@/components/ui/spinner";

export const SalesOrderReturnRedirect = ({ href, label }: { href: string; label: string }) => {
  const router = useRouter();

  useEffect(() => {
    router.replace(href);
  }, [href, router]);

  return (
    <div className="flex min-h-48 items-center justify-center" role="status">
      <Spinner className="h-5 w-5" />
      <span className="sr-only">{label}</span>
    </div>
  );
};
