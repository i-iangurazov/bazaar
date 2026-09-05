import { addBusinessDays, businessDateKey } from "@/lib/timezone";

export const baamDatePresets = ["last7", "last30", "thisMonth", "lastMonth", "last2Months"] as const;
export type BaamDatePreset = (typeof baamDatePresets)[number];

/** Completed days/months match BAAM's server interpretation; this month runs through today. */
export const baamPresetRange = (preset: BaamDatePreset, today = businessDateKey(new Date())) => {
  const [year, month] = today.split("-").map(Number);
  const monthStart = (offset: number) => new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 10);
  if (preset === "thisMonth") return { dateFrom: monthStart(0), dateTo: today };
  if (preset === "lastMonth" || preset === "last2Months") return {
    dateFrom: monthStart(preset === "lastMonth" ? -1 : -2),
    dateTo: addBusinessDays(monthStart(0), -1),
  };
  return { dateFrom: addBusinessDays(today, preset === "last7" ? -7 : -30), dateTo: addBusinessDays(today, -1) };
};
