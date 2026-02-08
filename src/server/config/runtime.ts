const isBuildPhase = () =>
  process.env.NEXT_PHASE === "phase-production-build" || process.env.npm_lifecycle_event === "build";

export const isProductionRuntime = () => process.env.NODE_ENV === "production" && !isBuildPhase();
