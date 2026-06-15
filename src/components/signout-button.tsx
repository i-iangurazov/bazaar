"use client";

import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { SignOutIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

export const SignOutButton = ({ className }: { className?: string }) => {
  const t = useTranslations("common");
  const queryClient = useQueryClient();

  return (
    <Button
      variant="secondary"
      className={cn(
        "w-full justify-start gap-2 text-left group-data-[state=collapsed]/sidebar-wrapper:justify-center group-data-[state=collapsed]/sidebar-wrapper:px-0",
        className,
      )}
      onClick={() => {
        queryClient.clear();
        void signOut({ callbackUrl: "/login" });
      }}
    >
      <SignOutIcon className="h-4 w-4" aria-hidden />
      <span className="group-data-[state=collapsed]/sidebar-wrapper:sr-only">{t("signOut")}</span>
    </Button>
  );
};
