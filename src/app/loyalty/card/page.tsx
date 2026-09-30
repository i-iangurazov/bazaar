import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import { LoyaltyCard } from "./card-view";
import { LOYALTY_SESSION_COOKIE, getCardView } from "@/server/services/loyalty/memberAuth";

export const dynamic = "force-dynamic";

const LoyaltyCardPage = async () => {
  const token = cookies().get(LOYALTY_SESSION_COOKIE)?.value ?? "";
  const t = await getTranslations("loyalty");
  let view = null;
  try {
    view = token ? await getCardView(token) : null;
  } catch {
    view = null;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-5 px-5 py-10">
      <h1 className="text-2xl font-semibold">{t("cardTitle")}</h1>
      {view ? (
        <LoyaltyCard view={view} />
      ) : (
        <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          {t("noSession")}
        </div>
      )}
    </main>
  );
};

export default LoyaltyCardPage;
