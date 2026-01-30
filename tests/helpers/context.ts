import type { Role } from "@prisma/client";
import { randomUUID } from "crypto";

import { appRouter } from "@/server/trpc/routers/_app";
import { prisma } from "@/server/db/prisma";
import { getLogger } from "@/server/logging";

export const createTestCaller = (user?: {
  id: string;
  email: string;
  role: Role;
  organizationId: string;
}) => {
  const requestId = randomUUID();
  const ctx = {
    prisma,
    user: user ?? null,
    impersonator: null,
    impersonationSessionId: null,
    requestId,
    logger: getLogger(requestId),
  };
  return appRouter.createCaller(ctx);
};
