"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoyaltyJoinForm({ programStoreId }: { programStoreId: string }) {
  const t = useTranslations("loyalty");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = async (path: string, body: unknown) => {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(payload?.message ?? "genericMessage");
    }
    return response;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (stage === "email") {
        await post("/api/loyalty/otp/request", { programStoreId, email });
        setStage("code");
      } else {
        await post("/api/loyalty/otp/verify", { programStoreId, email, code });
        router.push("/loyalty/card");
      }
    } catch (caught) {
      setError(caught instanceof Error && t.has(caught.message) ? t(caught.message) : t("genericMessage"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {stage === "email" ? (
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">{t("emailLabel")}</span>
          <Input
            type="email"
            required
            value={email}
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
      ) : (
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">{t("codeLabel", { email })}</span>
          <Input
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            autoComplete="one-time-code"
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          />
        </label>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={busy}>
        {stage === "email" ? t("getCode") : t("confirm")}
      </Button>
      {stage === "code" && (
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          disabled={busy}
          onClick={() => {
            setStage("email");
            setCode("");
          }}
        >
          {t("changeEmail")}
        </Button>
      )}
    </form>
  );
}
