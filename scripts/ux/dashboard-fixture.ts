const businessDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Bishkek",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const businessDate = (date: Date) => {
  const parts = Object.fromEntries(
    businessDateFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
};

/** Independent test oracle for the UX fixture's one completed sale. */
export function dashboardFixtureExpectation({
  completedAt,
  now,
  saleTotal,
}: {
  completedAt: Date | string;
  now: Date;
  saleTotal: number;
}) {
  const saleBusinessDate = businessDate(
    typeof completedAt === "string" ? new Date(completedAt) : completedAt,
  );
  const currentBusinessDate = businessDate(now);
  const completedToday = saleBusinessDate === currentBusinessDate;
  return {
    saleBusinessDate,
    currentBusinessDate,
    todaySales: completedToday ? saleTotal : 0,
    todayReceipts: completedToday ? 1 : 0,
  };
}
