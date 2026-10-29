import type { InvalidateOptions } from "@tanstack/react-query";

// Inline saves await their post-write refresh before allowing the next edit.
// A later SSE notification must share that refresh, not cancel its promise and
// release the editor while the previous stock revision is still cached.
export const liveQueryRefreshOptions: InvalidateOptions = { cancelRefetch: false };
