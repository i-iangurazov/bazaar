export const defaultTimeZone = "Asia/Bishkek";

const BUSINESS_TIME_ZONE_OFFSET_MINUTES = 6 * 60;
const MINUTE_MS = 60 * 1000;

const parseDateOnlyParts = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error("invalidDateOnly");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.toISOString().slice(0, 10) !== value) {
    throw new Error("invalidDateOnly");
  }
  return { year, month, day };
};

/** Converts a Bishkek calendar date to its UTC midnight boundary. */
export const businessDateOnlyToUtc = (value: string, extraDays = 0) => {
  const { year, month, day } = parseDateOnlyParts(value);
  return new Date(
    Date.UTC(year, month - 1, day + extraDays) - BUSINESS_TIME_ZONE_OFFSET_MINUTES * MINUTE_MS,
  );
};

export const businessDateOnlyEndUtc = (value: string) =>
  new Date(businessDateOnlyToUtc(value, 1).getTime() - 1);

const businessDateKey = (value: Date) =>
  new Date(value.getTime() + BUSINESS_TIME_ZONE_OFFSET_MINUTES * MINUTE_MS)
    .toISOString()
    .slice(0, 10);

export const resolveBusinessDayBounds = (now = new Date()) => {
  const today = businessDateKey(now);
  const todayStart = businessDateOnlyToUtc(today);
  return {
    today,
    todayStart,
    tomorrowStart: businessDateOnlyToUtc(today, 1),
    yesterdayStart: businessDateOnlyToUtc(today, -1),
    sevenDaysStart: businessDateOnlyToUtc(today, -6),
  };
};
