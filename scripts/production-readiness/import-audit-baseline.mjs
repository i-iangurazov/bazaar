import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import Papa from "papaparse";

const CATEGORY_WEIGHTS = {
  "Core functional correctness": 0.3,
  "End-to-end workflows and data integrity": 0.2,
  "Authorization, security and tenant isolation": 0.15,
  "Reliability and error handling": 0.1,
  "UX and responsive behavior": 0.1,
  "Reporting, integrations and operational readiness": 0.05,
  "Accessibility and localization": 0.05,
  "Performance, PWA and infrastructure": 0.05,
};

const ALLOWED_STATUSES = new Set(["PASS", "PARTIAL", "FAIL", "BLOCKED", "N_A"]);
const EXTERNAL_DEPENDENCIES = new Map([
  [
    83,
    "Authorized non-production fiscal/KKM connector, tax fixture, and safe receipt-transmission target",
  ],
  [118, "Authorized email-delivery sandbox, sender identity, and test inbox"],
  [180, "Authorized provider sandbox credentials and non-production integration target"],
  [182, "Authorized billing-provider sandbox and non-production payment method"],
]);

const SOURCE_FILES = [
  "production-readiness-audit.md",
  "scoring-requirements.csv",
  "scoring-calculation.md",
  "scoring-calculation.json",
  "defect-register.md",
  "defect-register.json",
  "route-matrix-exact-132.csv",
  "route-matrix-canonical-116.csv",
  "workflow-matrix.csv",
];

const parseArguments = () => {
  const args = process.argv.slice(2);
  const result = { source: null, output: null };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--source") {
      result.source = args[index + 1] ?? null;
      index += 1;
    } else if (value === "--output") {
      result.output = args[index + 1] ?? null;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  if (!result.source || !result.output) {
    throw new Error(
      "Usage: node scripts/production-readiness/import-audit-baseline.mjs --source <audit-dir> --output <tracker-dir>",
    );
  }
  return result;
};

const fileExists = async (filePath) => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const inferResponsibleModule = (requirement, category) => {
  const text = requirement.toLowerCase();
  if (
    /weighted-average|inventory valuation|purchase-cost|stock|receiv|transfer|write-off|movement/.test(
      text,
    )
  ) {
    return "src/server/services/inventory.ts; src/server/services/productCost.ts; src/server/services/products.ts";
  }
  if (/report|export|analytics|profit|margin/.test(text)) {
    return "src/server/services/reports.ts; src/server/services/exports.ts; src/server/services/analytics.ts";
  }
  if (/privacy|legal|landing|sitemap|public/.test(text)) {
    return "src/app; src/components/marketing; src/app/sitemap.ts";
  }
  if (/guide|help|instruction/.test(text)) {
    return "src/app/help; src/lib/help; src/components/help";
  }
  if (/login|logout|session|role|permission|tenant|owner|token|invite|signup|auth/.test(text)) {
    return "src/middleware.ts; src/server/auth; src/server/trpc";
  }
  if (/pos|receipt|cash|shift|debt|fiscal|kkm/.test(text)) {
    return "src/server/services/pos.ts; src/app/(app)/pos";
  }
  if (/order|customer/.test(text)) {
    return "src/server/services/salesOrders.ts; src/app/(app)/sales/orders; src/app/(app)/customers";
  }
  if (/purchase|supplier/.test(text)) {
    return "src/server/services/purchaseOrders.ts; src/app/(app)/purchase-orders; src/app/(app)/suppliers";
  }
  if (/integration|billing/.test(text)) {
    return "src/server/services; src/app/(app)/operations/integrations; src/app/(app)/billing";
  }
  if (category === "Accessibility and localization") {
    return "src/components; src/app; messages";
  }
  if (category === "UX and responsive behavior") {
    return "src/components; src/app";
  }
  if (category === "Performance, PWA and infrastructure") {
    return "src/app; public; next.config.mjs; vercel.json";
  }
  return "src/app; src/components; src/server";
};

const inferValidationCommand = (requirement) => {
  const text = requirement.toLowerCase();
  if (/weighted-average|inventory valuation|stock|receiv|transfer|write-off|movement/.test(text)) {
    return "pnpm exec vitest run tests/integration/inventory.test.ts tests/integration/hardening-agent2-b2-cost.test.ts";
  }
  if (/report|export|analytics|profit|margin/.test(text)) {
    return "pnpm exec vitest run tests/integration/reports.test.ts tests/integration/exports.test.ts tests/integration/analytics.test.ts";
  }
  if (/role|permission|tenant|owner|access/.test(text)) {
    return "pnpm exec vitest run tests/integration/store-isolation.test.ts tests/integration/tenancy.test.ts tests/integration/manager-permissions.test.ts";
  }
  if (/locale|localiz|russian|kyrgyz|english|translation|plural/.test(text)) {
    return "pnpm i18n:check && pnpm exec vitest run tests/unit/locales.test.ts";
  }
  if (/route|navigation|redirect|mobile|tablet|desktop|responsive|modal|focus/.test(text)) {
    return "pnpm test:e2e -- --project=chromium";
  }
  return "pnpm test:ci plus requirement-specific browser evidence";
};

const inferDimensions = (requirement, category, riskWeight) => {
  const text = requirement.toLowerCase();
  const dimensions = new Set();
  if (/route|page|navigation|redirect|deep-link|dynamic id|link|sitemap|url/.test(text)) {
    dimensions.add("ROUTE");
  }
  if (
    category === "Authorization, security and tenant isolation" ||
    /role|permission|access|owner|tenant|session|login|logout|token|invite|signup/.test(text)
  ) {
    dimensions.add("ROLE");
  }
  if (
    category === "UX and responsive behavior" ||
    /mobile|tablet|desktop|responsive|viewport|zoom|overflow|layout|modal/.test(text)
  ) {
    dimensions.add("RESPONSIVE");
  }
  if (
    /locale|localiz|russian|kyrgyz|english|translation|plural|language|currency formatting|date.*format/.test(
      text,
    )
  ) {
    dimensions.add("LOCALIZATION");
  }
  // The frozen audit generator defines every risk-5 row, and only a risk-5 row,
  // as a "critical workflow" for compatibility with its published coverage.
  if (riskWeight === 5) {
    dimensions.add("CRITICAL_WORKFLOW");
  }
  return Array.from(dimensions).sort();
};

const findRelatedDefects = (row, defects) => {
  const haystack = `${row.requirement} ${row.notes}`.toLowerCase();
  const explicit = defects
    .filter((defect) => haystack.includes(defect.id.toLowerCase()))
    .map((defect) => defect.id);
  const inferred = [];
  if (
    /weighted-average|inventory valuation|purchase-cost|cost rounding|exported values/.test(
      haystack,
    )
  ) {
    inferred.push("BZR-PRD-001");
  }
  if (/landing legal|privacy link|published privacy|sitemap/.test(haystack)) {
    inferred.push("PUBLIC-001");
  }
  if (/write-off.*report|report.*write-off|inventory-loss report/.test(haystack)) {
    inferred.push("REPORTS-001");
  }
  return Array.from(new Set([...explicit, ...inferred])).filter((id) =>
    defects.some((defect) => defect.id === id),
  );
};

const buildDefects = (sourceDefects) =>
  sourceDefects.map((defect) => {
    const gateDomains =
      defect.id === "BZR-PRD-001"
        ? ["money", "stock", "data_integrity"]
        : defect.id === "REPORTS-001"
          ? ["money", "stock"]
          : [];
    const externalDependency =
      defect.id === "PUBLIC-002"
        ? "Counsel-approved operator identity, retention, rights, and complaint-process copy"
        : null;
    return {
      ...defect,
      baselineStatus: "OPEN",
      currentStatus: "OPEN",
      gateDomains,
      ownership: externalDependency ? "SHARED_PRODUCT_DECISION" : "APPLICATION",
      externalDependency,
      resolvedAt: null,
      resolutionEvidence: [],
    };
  });

const main = async () => {
  const args = parseArguments();
  const sourceDir = path.resolve(args.source);
  const outputDir = path.resolve(args.output);
  const baselinePath = path.join(outputDir, "readiness-baseline.json");
  const currentPath = path.join(outputDir, "readiness-current.json");

  if (await fileExists(baselinePath)) {
    throw new Error(
      `${baselinePath} already exists. The audit baseline is immutable and this importer never overwrites it.`,
    );
  }
  if (await fileExists(currentPath)) {
    throw new Error(
      `${currentPath} already exists. Initialization never overwrites the current evidence tracker.`,
    );
  }

  const requirementCsv = await readFile(path.join(sourceDir, "scoring-requirements.csv"), "utf8");
  const defectRegister = JSON.parse(
    await readFile(path.join(sourceDir, "defect-register.json"), "utf8"),
  );
  const scoringCalculation = JSON.parse(
    await readFile(path.join(sourceDir, "scoring-calculation.json"), "utf8"),
  );
  const parsed = Papa.parse(requirementCsv, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) {
    throw new Error(`Unable to parse scoring requirements: ${JSON.stringify(parsed.errors)}`);
  }
  if (parsed.data.length !== 230) {
    throw new Error(`Expected 230 requirements, received ${parsed.data.length}`);
  }

  const defects = buildDefects(defectRegister.defects);
  const requirements = parsed.data.map((row, index) => {
    const ordinal = index + 1;
    const riskWeight = Number(row.risk_weight);
    const status = row.outcome;
    const executed = row.executed === "TRUE";
    if (!(row.category in CATEGORY_WEIGHTS)) {
      throw new Error(`Unknown category at row ${ordinal}: ${row.category}`);
    }
    if (![1, 3, 5].includes(riskWeight)) {
      throw new Error(`Invalid risk weight at row ${ordinal}: ${row.risk_weight}`);
    }
    if (!ALLOWED_STATUSES.has(status)) {
      throw new Error(`Invalid status at row ${ordinal}: ${status}`);
    }
    if (status === "BLOCKED" && executed) {
      throw new Error(`Blocked row ${ordinal} cannot be marked executed`);
    }
    if (status === "N_A" && !/not applicable|out of scope|not present/i.test(row.notes)) {
      throw new Error(`N_A row ${ordinal} requires a written justification`);
    }
    const externalDependencyDetails = EXTERNAL_DEPENDENCIES.get(ordinal) ?? null;
    const fingerprint = sha256(`${row.category}\0${row.requirement}\0${String(riskWeight)}`);
    return {
      id: `BZR-REQ-${String(ordinal).padStart(4, "0")}`,
      sourceRow: ordinal + 1,
      fingerprint,
      category: row.category,
      requirement: row.requirement,
      routeOrWorkflow: { routes: [], workflow: row.requirement },
      dimensions: inferDimensions(row.requirement, row.category, riskWeight),
      riskWeight,
      baselineStatus: status,
      currentStatus: status,
      baselineExecuted: executed,
      currentExecuted: executed,
      applicationOwned: !externalDependencyDetails,
      ownership: externalDependencyDetails ? "EXTERNAL" : "APPLICATION",
      responsibleModule: inferResponsibleModule(row.requirement, row.category),
      relatedDefectIds: findRelatedDefects(row, defects),
      validation: {
        commands: [inferValidationCommand(row.requirement)],
        tests: [],
        manualProcedure: null,
      },
      evidence: {
        baseline: row.evidence
          .split(";")
          .map((entry) => entry.trim())
          .filter(Boolean),
        current: [],
      },
      externalDependency: externalDependencyDetails
        ? {
            type: "EXTERNAL_SERVICE",
            owner: "External provider / authorized operator",
            status: "BLOCKED",
            blocksPilot: true,
            blocksFullVerification: true,
            details: externalDependencyDetails,
          }
        : null,
      baselineNotes: row.notes,
      currentNotes: row.notes,
      statusJustification: row.notes,
      lastVerificationTimestamp: scoringCalculation.generatedAt,
      verificationTimestampSource:
        "Audit snapshot timestamp; individual requirement timestamps were not recorded",
      history: [],
    };
  });

  const sourceArtifacts = [];
  for (const filename of SOURCE_FILES) {
    const content = await readFile(path.join(sourceDir, filename));
    sourceArtifacts.push({
      filename,
      sha256: sha256(content),
      bytes: content.byteLength,
    });
  }

  const shared = {
    schemaVersion: 1,
    auditWindow: {
      startedAt: "2026-08-30T18:03:33.843Z",
      endedAt: "2026-08-30T19:20:10.904Z",
      timezone: "Asia/Bishkek",
    },
    source: {
      description: "Frozen black-box Bazaar production-readiness audit baseline",
      sourceDirectoryAtImport: sourceDir,
      requirementsCsvSha256: sha256(requirementCsv),
      artifacts: sourceArtifacts,
    },
    scoringPolicy: {
      categoryWeights: CATEGORY_WEIGHTS,
      outcomeValues: { PASS: 1, PARTIAL: 0.5, FAIL: 0, BLOCKED: 0 },
      notApplicable: "Excluded only with a written justification",
      blocked: "Remains in the applicable denominator with value zero",
      caps: {
        unresolvedBlockerOrCritical: 49,
        unresolvedHighInProtectedDomain: 64,
        protectedDomains: [
          "authentication",
          "tenant_isolation",
          "money",
          "stock",
          "fiscal",
          "irrecoverable_data",
          "data_integrity",
        ],
      },
      gates: {
        minimumExecutionForVerifiedVerdictPercent: 90,
        minimumCriticalWorkflowExecutionForProductionReadyPercent: 95,
      },
    },
    supportingMetrics: {
      routes: {
        exact: { PASS: 25, PARTIAL: 97, FAIL: 10, BLOCKED: 0, total: 132 },
        canonical: { PASS: 15, PARTIAL: 91, FAIL: 10, BLOCKED: 0, total: 116 },
      },
      workflows: {
        total: 85,
        executed: 61,
        outcomes: { PASS: 22, PARTIAL: 34, FAIL: 5, BLOCKED: 24 },
      },
      roles: {
        credentialed: 4,
        expected: 6,
        credentialedRoleNames: ["ADMIN", "MANAGER", "STAFF", "CASHIER"],
        blockedRoleNames: ["ORGANIZATION_OWNER", "PLATFORM_OWNER"],
        lowerRoleBoundaryAssertions: { passed: 225, total: 225 },
        crossTenantIsolationVerified: false,
      },
      responsive: {
        desktopExactForms: { executed: 132, total: 132 },
        tabletExactForms: { executed: 123, total: 132 },
        mobileExactForms: { executed: 123, total: 132 },
        publicViewportChecks: { executed: 153, total: 153 },
        adminViewportChecks: { executed: 210, total: 210 },
      },
      localization: {
        supportedLocales: ["ru", "kg", "en"],
        compatibilityPrefixes: ["ru", "kg", "en", "ky"],
        representativePrefixAssertions: { passed: 12, total: 12 },
        fullRouteLocaleCrossProductVerified: false,
      },
    },
    defects,
    requirements,
  };

  const baseline = {
    ...shared,
    snapshotKind: "baseline",
    generatedAt: scoringCalculation.generatedAt,
    immutable: true,
  };
  const current = {
    ...structuredClone(shared),
    snapshotKind: "current",
    generatedAt: scoringCalculation.generatedAt,
    immutable: false,
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  await writeFile(currentPath, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Imported ${requirements.length} requirements and ${defects.length} defects.`);
  console.log(`Baseline: ${baselinePath}`);
  console.log(`Current:  ${currentPath}`);
};

await main();
