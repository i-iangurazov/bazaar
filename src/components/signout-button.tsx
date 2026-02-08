"use client";

import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { SignOutIcon } from "@/components/icons";
export const SignOutButton = () => {
  const t = useTranslations("common");

  return (
    <Button
      variant="secondary"
      className="w-full justify-start gap-2 text-left"
      onClick={() => signOut({ callbackUrl: "/login" })}
    >
      <SignOutIcon className="h-4 w-4" aria-hidden />
      {t("signOut")}
    </Button>
  );
};
