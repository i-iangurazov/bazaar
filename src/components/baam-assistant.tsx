"use client";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { useLocale } from "next-intl";
import { baamCopy } from "@/lib/baam/copy";
import { BaamCompanionPanel } from "./baam-companion-panel";

export type BaamIdentity = {
  userId: string;
  organizationId: string;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
};
const CompanionContext = createContext<{ identity: BaamIdentity | null; loading: boolean }>({
  identity: null,
  loading: false,
});
export function BaamAssistantProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const user = session?.user;
  const authorized = Boolean(user && ["ADMIN", "MANAGER"].includes(user.role));
  const userId = authorized ? user!.id : "";
  const organizationId = authorized ? user!.organizationId : "";
  const key = `baam-dialog:${organizationId}:${userId}`;
  const [selection, setSelection] = useState<{ key: string; id: string | null }>();
  useEffect(() => {
    let id: string | null = null;
    if (authorized)
      try {
        id = localStorage.getItem(key);
      } catch {
        /* Server history works without browser storage. */
      }
    setSelection({ key, id });
  }, [key, authorized]);
  const setActiveId = useMemo(
    () => (id: string | null) => {
      setSelection({ key, id });
      try {
        if (id) localStorage.setItem(key, id);
        else localStorage.removeItem(key);
      } catch {
        /* Storage is optional. */
      }
    },
    [key],
  );
  // Keep the provider tree stable while NextAuth resolves. Replacing a wrapper
  // here used to remount AppShell children and discard an early launcher click.
  return (
    <CompanionContext.Provider
      value={{
        loading: status === "loading",
        identity: authorized
          ? {
              userId,
              organizationId,
              activeId: selection?.key === key ? selection.id : null,
              setActiveId,
            }
          : null,
      }}
    >
      {children}
    </CompanionContext.Provider>
  );
}
export function BaamAssistant({ compact = false }: { compact?: boolean }) {
  const { identity, loading } = useContext(CompanionContext);
  const locale = useLocale();
  if (!identity && loading)
    return (
      <div
        data-baam-session-loading
        role="status"
        aria-busy="true"
        className="p-6 text-sm text-muted-foreground"
      >
        {baamCopy(locale, "loading")}
      </div>
    );
  if (!identity)
    return (
      <p className="p-6 text-sm" role="alert">
        {baamCopy(locale, "forbidden")}
      </p>
    );
  return (
    <BaamCompanionPanel
      key={`${identity.organizationId}:${identity.userId}`}
      identity={identity}
      compact={compact}
    />
  );
}
