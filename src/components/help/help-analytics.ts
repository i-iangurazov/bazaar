export type HelpEvent =
  | { type: "guide_view"; guideId: string; sourceRoute?: string }
  | { type: "search" | "zero_result"; query: string }
  | { type: "feedback"; guideId: string; helpful: boolean; sourceRoute?: string };

export const trackHelpEvent = (event: HelpEvent) => {
  if (typeof window === "undefined") return;
  const body = JSON.stringify(event);
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/help/events", new Blob([body], { type: "application/json" }));
    return;
  }
  void fetch("/api/help/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  });
};
