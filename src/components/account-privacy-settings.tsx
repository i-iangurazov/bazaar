"use client";

import { useState } from "react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { isIOS } from "@/lib/native/platform";
import { AiPrivacyConsent } from "./ai-privacy-consent";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Spinner } from "./ui/spinner";

export function AccountPrivacySettings() {
  const t = useTranslations("accountPrivacy");
  const errors = useTranslations("errors");
  const common = useTranslations("common");
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [successorUserId, setSuccessorUserId] = useState<string>();
  const [deleted, setDeleted] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const preview = trpc.userSettings.accountDeletionPreview.useQuery(undefined, { enabled: open && !deleted, staleTime: 0, retry: false });
  const finishSignOut = async () => {
    try { await signOut({ callbackUrl: "/account-deleted" }); }
    catch { setSignOutFailed(true); }
  };
  const deletion = trpc.userSettings.deleteMyAccount.useMutation({
    onSuccess: async () => {
      setDeleted(true);
      setPassword("");
      setConfirmation("");
      // Persisted private Baam drafts must not remain on a shared device.
      try {
        for (const storage of [localStorage, sessionStorage]) {
          const scope = `${session?.user.organizationId}:${session?.user.id}`;
          for (const key of Object.keys(storage)) {
            if (key === `baam-dialog:${scope}` || key.startsWith(`baam-draft:${scope}:`)) storage.removeItem(key);
          }
        }
      } catch { /* A storage-disabled browser still gets a server-side erasure. */ }
      queryClient.clear();
      await finishSignOut();
    },
  });
  const manageApple = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!isIOS()) return;
    event.preventDefault();
    try {
      const billing = await import("@/lib/native/appleBilling");
      if (await billing.isAppleBillingAvailable()) {
        await billing.showAppleSubscriptionManagement();
        return;
      }
    } catch { /* Apple's account page remains available when the bridge is unavailable. */ }
    window.location.assign("https://apps.apple.com/account/subscriptions");
  };

  return <Card id="privacy-and-account" className="bazaar-admin-surface scroll-mt-24">
    <CardHeader><CardTitle>{t("title")}</CardTitle></CardHeader>
    <CardContent className="space-y-6">
      <AiPrivacyConsent showStatus />
      <div className="space-y-3">
        <h3 className="font-semibold">{t("deleteTitle")}</h3>
        <p className="text-sm leading-6 text-muted-foreground">{t("deleteSummary")}</p>
        <Button variant="destructive" onClick={() => setOpen(true)}>{t("deleteOpen")}</Button>
      </div>
      <Dialog open={open} onOpenChange={(next) => {
        if (deletion.isLoading || deleted) return;
        setOpen(next);
        setPassword(""); setConfirmation(""); setSuccessorUserId(undefined); deletion.reset();
      }}>
        <DialogContent size="md" showClose={!deletion.isLoading && !deleted}>
          <DialogHeader>
            <DialogTitle>{deleted ? t("deletedTitle") : t("deleteTitle")}</DialogTitle>
          </DialogHeader>
          {deleted ? <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
            <DialogDescription>{t("deletedBody")}</DialogDescription>
            <p className="text-sm">{t("appleWarning")}</p>
            <a className="inline-flex min-h-11 items-center text-primary underline" href="https://apps.apple.com/account/subscriptions" onClick={(event) => void manageApple(event)} target="_blank" rel="noopener noreferrer">{t("manageApple")}</a>
            {signOutFailed ? <Button onClick={() => void finishSignOut()}>{t("finishSignOut")}</Button> : <Spinner />}
          </div> : <form className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5" onSubmit={(event) => {
            event.preventDefault();
            if (!preview.data || confirmation !== "DELETE") return;
            deletion.mutate({ password, confirmation: "DELETE", successorUserId: preview.data.requiresSuccessor ? successorUserId : undefined });
          }}>
            <DialogDescription>{t("deleteSummary")}</DialogDescription>
            <p className="text-sm leading-6">{t("retention")}</p>
            <p className="text-sm leading-6">{t("appleWarning")}</p>
            <a className="inline-flex min-h-11 items-center text-sm text-primary underline" href="https://apps.apple.com/account/subscriptions" onClick={(event) => void manageApple(event)} target="_blank" rel="noopener noreferrer">{t("manageApple")}</a>
            <Link href="/privacy" target="_blank" className="ml-3 inline-flex min-h-11 items-center text-sm text-primary underline">{t("privacyPolicy")}</Link>
            {preview.isLoading ? <p className="flex items-center gap-2 text-sm"><Spinner className="h-4 w-4" />{common("loading")}</p> : null}
            {preview.error ? <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>{translateError(errors, preview.error)}</p><Button variant="outline" type="button" onClick={() => void preview.refetch()}>{common("tryAgain")}</Button>
            </div> : null}
            {preview.data?.soleOwner ? <p className="text-sm leading-6">{t("soleOwner")}</p> : null}
            {preview.data?.requiresSuccessor ? <div className="space-y-2">
              <Label htmlFor="deletion-successor">{t("successor")}</Label>
              <Select value={successorUserId} onValueChange={setSuccessorUserId} disabled={deletion.isLoading}>
                <SelectTrigger id="deletion-successor"><SelectValue placeholder={t("chooseSuccessor")} /></SelectTrigger>
                <SelectContent>{preview.data.successors.map((user) => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">{t("successorWarning")}</p>
            </div> : null}
            <div className="space-y-2"><Label htmlFor="deletion-password">{t("password")}</Label>
              <Input id="deletion-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={deletion.isLoading} required maxLength={1024} /></div>
            <div className="space-y-2"><Label htmlFor="deletion-confirmation">{t("confirmation")}</Label>
              <Input id="deletion-confirmation" autoComplete="off" spellCheck={false} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} disabled={deletion.isLoading} required /></div>
            {deletion.error ? <p className="text-sm text-destructive" role="alert">{translateError(errors, deletion.error)}</p> : null}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button type="button" variant="outline" disabled={deletion.isLoading} onClick={() => { setOpen(false); setPassword(""); setConfirmation(""); deletion.reset(); }}>{common("cancel")}</Button>
              <Button type="submit" variant="destructive" disabled={!preview.data || deletion.isLoading || !password || confirmation !== "DELETE" || (preview.data.requiresSuccessor && !successorUserId)}>
                {deletion.isLoading ? <Spinner className="h-4 w-4" /> : null}{t("deleteConfirm")}
              </Button>
            </div>
          </form>}
        </DialogContent>
      </Dialog>
    </CardContent>
  </Card>;
}
