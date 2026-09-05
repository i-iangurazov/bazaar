import { describe, expect, it } from "vitest";
import { planProductionMigrations } from "../../scripts/deployment/migrations";

const baseline = { name: "baseline", checksum: "unchanged" };
const addition = { name: "reviewed-addition", checksum: "new" };
const record = { migration_name: baseline.name, checksum: baseline.checksum, finished_at: new Date(), rolled_back_at: null };

describe("production migration release guard", () => {
  it("applies only the reviewed pending additions and makes repeated builds a no-op", () => {
    expect(planProductionMigrations([baseline, addition], [record], { [addition.name]: addition.checksum })).toEqual([addition.name]);
    expect(planProductionMigrations([baseline], [record], {})).toEqual([]);
  });
  it("rejects an older unexpected pending migration instead of deploying all migrations blindly", () => {
    expect(() => planProductionMigrations([baseline, addition], [], { [addition.name]: addition.checksum })).toThrow("unapproved");
  });
  it("blocks unfinished, changed, or newer database history", () => {
    expect(() => planProductionMigrations([baseline], [{ ...record, finished_at: null }], {})).toThrow("Unfinished");
    expect(() => planProductionMigrations([baseline], [{ ...record, checksum: "changed" }], {})).toThrow("differs");
    expect(() => planProductionMigrations([], [record], {})).toThrow("differs");
  });
  it("permits an explicitly reviewed retry after a migration was formally rolled back", () => {
    expect(planProductionMigrations([baseline], [{ ...record, finished_at: null, rolled_back_at: new Date() }], { [baseline.name]: baseline.checksum })).toEqual([baseline.name]);
  });
  it("requires both reviewed release migration files to be present", () => {
    expect(() => planProductionMigrations([baseline], [record])).toThrow("missing");
  });
  it("rejects changed pending SQL even when the migration name is approved", () => {
    expect(() => planProductionMigrations([addition], [], { [addition.name]: "reviewed-original" })).toThrow("SQL changed");
  });
});
