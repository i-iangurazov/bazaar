import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      organizationId: string;
      preferredLocale?: string;
      themePreference?: string;
      isPlatformOwner?: boolean;
      isOrgOwner?: boolean;
      name?: string | null;
      email?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    organizationId?: string;
    preferredLocale?: string;
    themePreference?: string;
    isPlatformOwner?: boolean;
    isOrgOwner?: boolean;
  }
}
