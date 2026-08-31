import { readFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED_STATUSES = new Set(["PASS", "PARTIAL", "FAIL", "BLOCKED", "N_A"]);
const DEFAULT_TRACKER = path.resolve("docs/production-readiness/readiness-current.json");
const DEFAULT_BASELINE = path.resolve("docs/production-readiness/readiness-baseline.json");

const parseArguments = () => {
  const args = process.argv.slice(2);
  const result = { tracker: DEFAULT_TRACKER, baseline: DEFAULT_BASELINE, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--tracker") {
      result.tracker = path.resolve(args[index + 1] ?? "");
      index += 1;
    } else if (value === "--baseline") {
      result.baseline = path.resolve(args[index + 1] ?? "");
      index += 1;
    } else if (value === "--json") {
      result.json = true;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return result;
};

const round = (value, places = 1) => {
  const multiplier = 10 ** places;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
};

const percentage = (numerator, denominator) =>
  denominator > 0 ? (numerator / denominator) * 100 : 0;

const validateTracker = (tracker, baseline) => {
  if (tracker.schemaVersion !== 1) {
    throw new Error(`Unsupported readiness schema: ${tracker.schemaVersion}`);
  }
  if (!Array.isArray(tracker.requirements) || tracker.requirements.length !== 230) {
    throw new Error(`Tracker must contain exactly 230 requirements`);
  }
  const ids = new Set();
  const baselineById = new Map(
    baseline.requirements.map((requirement) => [requirement.id, requirement]),
  );
  for (const requirement of tracker.requirements) {
    if (ids.has(requirement.id)) {
      throw new Error(`Duplicate requirement ID: ${requirement.id}`);
    }
    ids.add(requirement.id);
    const baselineRequirement = baselineById.get(requirement.id);
    if (!baselineRequirement) {
      throw new Error(`Requirement ${requirement.id} is absent from the immutable baseline`);
    }
    for (const field of [
      "sourceRow",
      "fingerprint",
      "category",
      "requirement",
      "riskWeight",
      "baselineStatus",
      "baselineExecuted",
    ]) {
      if (requirement[field] !== baselineRequirement[field]) {
        throw new Error(`Immutable field drift for ${requirement.id}: ${field}`);
      }
    }
    if (!ALLOWED_STATUSES.has(requirement.currentStatus)) {
      throw new Error(`Invalid status for ${requirement.id}: ${requirement.currentStatus}`);
    }
    if (![1, 3, 5].includes(requirement.riskWeight)) {
      throw new Error(`Invalid risk weight for ${requirement.id}: ${requirement.riskWeight}`);
    }
    if (!(requirement.category in tracker.scoringPolicy.categoryWeights)) {
      throw new Error(`Unknown category for ${requirement.id}: ${requirement.category}`);
    }
    if (requirement.currentStatus === "BLOCKED" && requirement.currentExecuted) {
      throw new Error(`${requirement.id} cannot be BLOCKED and executed`);
    }
    if (
      requirement.currentStatus === "N_A" &&
      !/not applicable|out of scope|not present/i.test(requirement.currentNotes ?? "")
    ) {
      throw new Error(`${requirement.id} needs a written N_A justification`);
    }
    if (!requirement.lastVerificationTimestamp) {
      throw new Error(`${requirement.id} is missing lastVerificationTimestamp`);
    }
    if (requirement.currentStatus !== requirement.baselineStatus) {
      if (!requirement.history.length) {
        throw new Error(`${requirement.id} changed status without a history entry`);
      }
      if (!requirement.evidence.current.length) {
        throw new Error(`${requirement.id} changed status without current evidence`);
      }
      if (requirement.currentStatus !== "BLOCKED" && !requirement.currentExecuted) {
        throw new Error(
          `${requirement.id} changed to an executed outcome but currentExecuted is false`,
        );
      }
    }
  }
  if (ids.size !== baselineById.size) {
    throw new Error("Current tracker requirement IDs do not align with the immutable baseline");
  }
};

const calculateRequirementScore = (tracker, requirements) => {
  const outcomeValues = tracker.scoringPolicy.outcomeValues;
  const applicable = requirements.filter((requirement) => requirement.currentStatus !== "N_A");
  const categoryResults = Object.entries(tracker.scoringPolicy.categoryWeights).map(
    ([category, categoryWeight]) => {
      const categoryRequirements = applicable.filter(
        (requirement) => requirement.category === category,
      );
      const riskDenominator = categoryRequirements.reduce(
        (sum, requirement) => sum + requirement.riskWeight,
        0,
      );
      const earnedRiskPoints = categoryRequirements.reduce(
        (sum, requirement) =>
          sum + outcomeValues[requirement.currentStatus] * requirement.riskWeight,
        0,
      );
      if (riskDenominator === 0) {
        throw new Error(`Category ${category} has no applicable requirements`);
      }
      const scoreExact = percentage(earnedRiskPoints, riskDenominator);
      return {
        category,
        categoryWeight,
        requirements: categoryRequirements.length,
        riskDenominator,
        earnedRiskPoints,
        score: round(scoreExact),
        scoreExact,
        contribution: round(scoreExact * categoryWeight, 2),
        contributionExact: scoreExact * categoryWeight,
      };
    },
  );
  const rawOverall = categoryResults.reduce((sum, category) => sum + category.contributionExact, 0);
  return { applicable, categoryResults, rawOverall: round(rawOverall) };
};

const calculateCoverage = (requirements) => {
  const applicable = requirements.filter((requirement) => requirement.currentStatus !== "N_A");
  const executed = applicable.filter((requirement) => requirement.currentExecuted).length;
  const passed = applicable.filter((requirement) => requirement.currentStatus === "PASS").length;
  return {
    applicable: applicable.length,
    executed,
    passed,
    executionPercent: round(percentage(executed, applicable.length)),
    verifiedPassPercent: round(percentage(passed, applicable.length)),
  };
};

const calculateDimension = (requirements, dimension) => {
  const matching = requirements.filter(
    (requirement) =>
      requirement.currentStatus !== "N_A" && requirement.dimensions.includes(dimension),
  );
  const executed = matching.filter((requirement) => requirement.currentExecuted).length;
  const passed = matching.filter((requirement) => requirement.currentStatus === "PASS").length;
  return {
    total: matching.length,
    executed,
    passed,
    executionPercent: round(percentage(executed, matching.length)),
    verifiedPassPercent: round(percentage(passed, matching.length)),
  };
};

const calculateRouteCoverage = (routes) => {
  const calculate = (matrix) => ({
    ...matrix,
    executed: matrix.PASS + matrix.PARTIAL + matrix.FAIL,
    executionPercent: round(percentage(matrix.PASS + matrix.PARTIAL + matrix.FAIL, matrix.total)),
    verifiedPassPercent: round(percentage(matrix.PASS, matrix.total)),
  });
  return { exact: calculate(routes.exact), canonical: calculate(routes.canonical) };
};

const openDefects = (tracker, ownership = null) =>
  tracker.defects.filter(
    (defect) =>
      defect.currentStatus !== "RESOLVED" && (ownership === null || defect.ownership === ownership),
  );

const calculateDefectCounts = (defects) => {
  const counts = { BLOCKER: 0, CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const defect of defects) {
    if (!(defect.severity in counts)) {
      throw new Error(`Unknown defect severity for ${defect.id}: ${defect.severity}`);
    }
    counts[defect.severity] += 1;
  }
  return { ...counts, total: defects.length };
};

const calculateCap = (tracker, defects) => {
  const critical = defects.some(
    (defect) => defect.severity === "BLOCKER" || defect.severity === "CRITICAL",
  );
  if (critical) {
    return {
      value: tracker.scoringPolicy.caps.unresolvedBlockerOrCritical,
      reason: "Unresolved BLOCKER or CRITICAL defect",
    };
  }
  const protectedDomains = new Set(tracker.scoringPolicy.caps.protectedDomains);
  const protectedHigh = defects.some(
    (defect) =>
      defect.severity === "HIGH" &&
      defect.gateDomains.some((domain) => protectedDomains.has(domain)),
  );
  if (protectedHigh) {
    return {
      value: tracker.scoringPolicy.caps.unresolvedHighInProtectedDomain,
      reason:
        "Unresolved HIGH defect in authentication, tenant, money, stock, fiscal, or data domain",
    };
  }
  return { value: 100, reason: null };
};

const statusCounts = (requirements) =>
  Object.fromEntries(
    ["PASS", "PARTIAL", "FAIL", "BLOCKED", "N_A"].map((status) => [
      status,
      requirements.filter((requirement) => requirement.currentStatus === status).length,
    ]),
  );

const interpretVerdict = ({ finalScore, coverage, critical, defects, gates }) => {
  if (coverage.executionPercent < gates.minimumExecutionForVerifiedVerdictPercent) {
    return "Not ready — insufficiently verified";
  }
  if (critical.executionPercent < gates.minimumCriticalWorkflowExecutionForProductionReadyPercent) {
    return "Not ready — critical workflows insufficiently verified";
  }
  if (finalScore >= 90 && defects.BLOCKER === 0 && defects.CRITICAL === 0 && defects.HIGH === 0) {
    return "Production ready";
  }
  if (finalScore >= 80) return "Near ready — do not onboard paying clients yet";
  if (finalScore >= 65) return "Not ready — significant remediation required";
  return "High production risk";
};

const main = async () => {
  const args = parseArguments();
  const [tracker, baseline] = await Promise.all([
    readFile(args.tracker, "utf8").then(JSON.parse),
    readFile(args.baseline, "utf8").then(JSON.parse),
  ]);
  validateTracker(tracker, baseline);

  const official = calculateRequirementScore(tracker, tracker.requirements);
  const coverage = calculateCoverage(tracker.requirements);
  const critical = calculateDimension(tracker.requirements, "CRITICAL_WORKFLOW");
  const defects = openDefects(tracker);
  const defectCounts = calculateDefectCounts(defects);
  const cap = calculateCap(tracker, defects);
  const finalScore = round(Math.min(official.rawOverall, cap.value));

  const applicationRequirements = tracker.requirements.filter(
    (requirement) => requirement.applicationOwned,
  );
  const application = calculateRequirementScore(tracker, applicationRequirements);

  const result = {
    tracker: args.tracker,
    snapshotGeneratedAt: tracker.generatedAt,
    overallReadiness: finalScore,
    rawOverallReadiness: official.rawOverall,
    appliedCap: cap.value < 100 ? cap : null,
    applicationOwnedReadiness: application.rawOverall,
    rawApplicationOwnedReadiness: application.rawOverall,
    applicationOwnedAppliedCap: null,
    counts: statusCounts(tracker.requirements),
    coverage,
    criticalWorkflowCoverage: critical,
    routeCoverage: calculateRouteCoverage(tracker.supportingMetrics.routes),
    roleCoverage: calculateDimension(tracker.requirements, "ROLE"),
    responsiveCoverage: calculateDimension(tracker.requirements, "RESPONSIVE"),
    localizationCoverage: calculateDimension(tracker.requirements, "LOCALIZATION"),
    workflowSupportingMetrics: tracker.supportingMetrics.workflows,
    roleSupportingMetrics: tracker.supportingMetrics.roles,
    responsiveSupportingMetrics: tracker.supportingMetrics.responsive,
    localizationSupportingMetrics: tracker.supportingMetrics.localization,
    defectCounts,
    categoryResults: official.categoryResults,
    verdict: interpretVerdict({
      finalScore,
      coverage,
      critical,
      defects: defectCounts,
      gates: tracker.scoringPolicy.gates,
    }),
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Overall readiness: ${result.overallReadiness.toFixed(1)}%`);
  console.log(`Raw overall readiness: ${result.rawOverallReadiness.toFixed(1)}%`);
  console.log(`Application-owned readiness: ${result.applicationOwnedReadiness.toFixed(1)}%`);
  console.log(
    `Execution coverage: ${coverage.executed}/${coverage.applicable} = ${coverage.executionPercent.toFixed(1)}%`,
  );
  console.log(
    `Verified pass rate: ${coverage.passed}/${coverage.applicable} = ${coverage.verifiedPassPercent.toFixed(1)}%`,
  );
  console.log(
    `Critical workflow coverage: ${critical.passed}/${critical.total} = ${critical.verifiedPassPercent.toFixed(1)}% verified; ${critical.executed}/${critical.total} = ${critical.executionPercent.toFixed(1)}% executed`,
  );
  console.log(
    `Outcomes: PASS ${result.counts.PASS}; PARTIAL ${result.counts.PARTIAL}; FAIL ${result.counts.FAIL}; BLOCKED ${result.counts.BLOCKED}; N/A ${result.counts.N_A}`,
  );
  console.log(
    `Defects: BLOCKER ${defectCounts.BLOCKER}; CRITICAL ${defectCounts.CRITICAL}; HIGH ${defectCounts.HIGH}; MEDIUM ${defectCounts.MEDIUM}; LOW ${defectCounts.LOW}`,
  );
  if (result.appliedCap) {
    console.log(`Applied cap: ${result.appliedCap.value}% — ${result.appliedCap.reason}`);
  }
  console.log(`Verdict: ${result.verdict}`);
};

await main();
