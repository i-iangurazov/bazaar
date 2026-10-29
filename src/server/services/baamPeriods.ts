export function baamReportPeriod(period: string, now = new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bishkek",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const end = new Date(`${date}T00:00:00Z`);
  const start = new Date(end);
  if (period === "yesterday") {
    start.setUTCDate(start.getUTCDate() - 1);
    end.setUTCDate(end.getUTCDate() - 1);
  } else if (period === "week") start.setUTCDate(start.getUTCDate() - 6);
  else if (period === "month") start.setUTCDate(1);
  return { dateFrom: start.toISOString().slice(0, 10), dateTo: end.toISOString().slice(0, 10) };
}
