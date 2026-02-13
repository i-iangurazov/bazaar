import type { Role } from "@prisma/client";

const roleRank: Record<Role, number> = {
  ADMIN: 3,
  MANAGER: 2,
  CASHIER: 1,
  STAFF: 1,
};

export const hasRole = (role: Role, required: Role) => roleRank[role] >= roleRank[required];

export const requireRole = (role: Role, allowed: Role[]) => allowed.includes(role);
