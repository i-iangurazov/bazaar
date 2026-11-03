import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function summarize(input) {
  if (input.currency !== "KGS" || !Array.isArray(input.events) || !Array.isArray(input.spend))
    throw new Error("Expected KGS spend and verified events");
  const campaign = "kg_store_launch_202611";
  const events = input.events.filter((e) => e.campaign === campaign);
  const spend = input.spend.filter((e) => e.campaign === campaign);
  if (spend.some((s) => !Number.isFinite(s.amount) || s.amount < 0))
    throw new Error("Invalid spend");
  for (const event of events) {
    if (
      !["organic_social", "paid_social", "unknown"].includes(event.medium) ||
      !event.entityId ||
      !event.evidence ||
      !["lead", "qualified", "demo", "registration", "subscription"].includes(event.kind)
    )
      throw new Error("Each outcome needs a deduplicated entity and evidence");
  }
  const groups = [
    ...new Set([
      ...events.map((e) => `${e.medium}:${e.content}`),
      ...spend.map((s) => `paid_social:${s.content}`),
    ]),
  ];
  const count = (rows, kind) =>
    new Set(rows.filter((e) => e.kind === kind).map((e) => e.entityId)).size;
  const table = groups.map((key) => {
    const [medium, content] = key.split(":");
    const rows = events.filter((e) => e.medium === medium && e.content === content);
    const cost =
      medium === "paid_social"
        ? spend.filter((s) => s.content === content).reduce((sum, s) => sum + s.amount, 0)
        : 0;
    const qualified = count(rows, "qualified"),
      registrations = count(rows, "registration"),
      subscriptions = count(rows, "subscription");
    const ratio = (denominator) =>
      medium === "paid_social" && denominator && cost > 0
        ? Math.round((cost / denominator) * 100) / 100
        : null;
    return {
      medium,
      content,
      leads: count(rows, "lead"),
      qualified,
      demosHeld: count(rows, "demo"),
      registeredOrganizations: registrations,
      confirmedSubscriptions: subscriptions,
      spendKgs: cost,
      cpqlKgs: ratio(qualified),
      costPerRegistrationKgs: ratio(registrations),
      mediaCacKgs: ratio(subscriptions),
    };
  });
  return {
    campaign,
    currency: "KGS",
    rows: table,
    unique: {
      leads: count(events, "lead"),
      qualified: count(events, "qualified"),
      registeredOrganizations: count(events, "registration"),
      confirmedSubscriptions: count(events, "subscription"),
    },
    note: "null = no measurable paid cost or denominator. CAC includes media only. Do not sum group counts when the same business appears in several groups.",
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2])
    throw new Error("Pass a private metrics JSON file; see the runbook schema.");
  console.log(
    JSON.stringify(summarize(JSON.parse(await readFile(process.argv[2], "utf8"))), null, 2),
  );
}
