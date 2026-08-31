import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthBrand } from "@/components/auth-brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LoginForm } from "@/components/login-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRoleHomePath } from "@/lib/roleAccess";
import { getServerAuthToken } from "@/server/auth/token";

const LoginPage = async () => {
  const token = await getServerAuthToken();
  if (token) {
    redirect(
      token.isPlatformOwner
        ? "/platform"
        : getRoleHomePath({
            role: token.role,
            isOrgOwner: Boolean(token.isOrgOwner),
            isPlatformOwner: Boolean(token.isPlatformOwner),
          }),
    );
  }

  const t = await getTranslations("auth");
  const mode = process.env.SIGNUP_MODE ?? "invite_only";
  const isOpenMode = mode === "open";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 py-8 sm:py-12">
      <div className="flex w-full max-w-md justify-center">
        <AuthBrand />
      </div>
      <div className="flex w-full max-w-md justify-end">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle as="h1">{t("loginTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("loginSubtitle")}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <LoginForm />
          <div className="flex flex-col gap-2 text-sm text-muted-foreground">
            {isOpenMode ? (
              <Link href="/signup" className="font-semibold text-primary hover:text-primary/90">
                {t("createAccount")}
              </Link>
            ) : (
              <>
                <Link href="/signup" className="font-semibold text-primary hover:text-primary/90">
                  {t("requestAccess")}
                </Link>
                <Link href="/invite" className="font-semibold text-primary hover:text-primary/90">
                  {t("acceptInvite")}
                </Link>
                <span className="text-xs text-muted-foreground">{t("inviteHint")}</span>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default LoginPage;
