import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const associatedPaths = [
  "/dashboard",
  "/products",
  "/inventory",
  "/pos",
  "/sales/orders",
  "/purchase-orders",
  "/customers",
  "/reports",
  "/operations/integrations",
  "/help",
  "/settings",
];

export const GET = () => {
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  const details = teamId
    ? [
        {
          appIDs: [`${teamId}.kg.bazaar.app`],
          components: associatedPaths.flatMap((path) => [{ "/": path }, { "/": `${path}/*` }]),
        },
      ]
    : [];
  return NextResponse.json(
    { applinks: { apps: [], details }, webcredentials: { apps: [] } },
    { headers: { "Cache-Control": "public, max-age=3600", "Content-Type": "application/json" } },
  );
};
