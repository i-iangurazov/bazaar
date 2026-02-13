"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormStack } from "@/components/form-layout";

const resolveToken = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/\/invite\/([^/?#]+)/i);
  if (match?.[1]) {
    return match[1];
  }
  const parts = trimmed.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? null;
};

const InviteEntryPage = () => {
  const t = useTranslations("invite");
  const router = useRouter();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4 py-8 sm:py-12">
      <div className="flex justify-end">
        <LanguageSwitcher />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("entryTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("entrySubtitle")}</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const token = resolveToken(input);
              if (!token) {
                setError(t("entryInvalid"));
                return;
              }
              setError(null);
              router.push(`/invite/${token}`);
            }}
          >
            <FormStack>
              <div className="space-y-1">
                <Label htmlFor="invite-token">{t("entryLabel")}</Label>
                <Input
                  id="invite-token"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder={t("entryPlaceholder")}
                />
              </div>
              {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
              <Button type="submit" className="w-full">
                {t("entrySubmit")}
              </Button>
              <p className="text-xs text-muted-foreground">{t("entryHint")}</p>
            </FormStack>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default InviteEntryPage;
