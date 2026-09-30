import { getTranslations } from "next-intl/server";
import Link from "next/link";

import { LoyaltyJoinForm } from "./join-form";
import { resolveJoinTarget } from "@/server/services/loyalty/memberAuth";

export const dynamic = "force-dynamic";

const JoinPage = async ({ params }: { params: { programStoreId: string } }) => {
  const [target, t] = await Promise.all([
    resolveJoinTarget(params.programStoreId),
    getTranslations("loyalty"),
  ]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5 py-10">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold">{t("joinTitle")}</h1>
        <p className="text-sm text-muted-foreground">
          {target?.enabled ? t("joinSubtitle", { store: target.storeName }) : t("unavailable")}
        </p>
      </div>
      {target?.enabled ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <LoyaltyJoinForm programStoreId={target.programStoreId} />
          <p className="mt-4 text-xs text-muted-foreground">{t("joinHint")}</p>
          <Link
            href="/loyalty/card"
            className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
          >
            {t("haveCard")}
          </Link>
        </div>
      ) : null}
    </main>
  );
};

export default JoinPage;
