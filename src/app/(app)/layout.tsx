import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getServerAuthToken } from "@/server/auth/token";
import { prisma } from "@/server/db/prisma";

const AppLayout = async ({ children }: { children: React.ReactNode }) => {
  const token = await getServerAuthToken();
  if (!token) {
    redirect("/login");
  }

  const cookieStore = cookies();
  const impersonationId = cookieStore.get("impersonation_session")?.value ?? "";
  let role = String(token.role ?? "STAFF");
  let displayName = token.name ?? null;
  let displayEmail = token.email ?? null;
  let isOrgOwner = Boolean((token as { isOrgOwner?: boolean } | null)?.isOrgOwner);
  let impersonation:
    | {
        targetName?: string | null;
        targetEmail?: string | null;
        expiresAt: string;
      }
    | null = null;

  if (impersonationId && token.role === "ADMIN") {
    const session = await prisma.impersonationSession.findUnique({
      where: { id: impersonationId },
      include: { targetUser: { select: { name: true, email: true, role: true, isOrgOwner: true } } },
    });

    if (session && !session.revokedAt && session.expiresAt > new Date() && session.createdById === token.sub) {
      role = session.targetUser.role;
      displayName = session.targetUser.name ?? null;
      displayEmail = session.targetUser.email ?? null;
      isOrgOwner = session.targetUser.isOrgOwner;
      impersonation = {
        targetName: session.targetUser.name ?? null,
        targetEmail: session.targetUser.email ?? null,
        expiresAt: session.expiresAt.toISOString(),
      };
    }
  }

  return (
    <AppShell
      user={{
        name: displayName,
        email: displayEmail,
        role,
        organizationId: (token as { organizationId?: string | null } | null)?.organizationId ?? null,
        isPlatformOwner: Boolean((token as { isPlatformOwner?: boolean } | null)?.isPlatformOwner),
        isOrgOwner,
      }}
      impersonation={impersonation}
    >
      {children}
    </AppShell>
  );
};

export default AppLayout;
