#!/usr/bin/env node
import {
  command,
  debug,
  setResult,
  TaskResult,
} from "azure-pipelines-task-lib";
import { ToolRunner } from "azure-pipelines-task-lib/toolrunner.js";

/**
 * @typedef {"null" | "info" | "low" | "moderate" | "high" | "critical" | "none"} NpmAuditLevel
 */
/** @type {Record<NpmAuditLevel, number>} */
const npmAuditLevelsMap = {
  null: 0,
  info: 1,
  low: 2,
  moderate: 3,
  high: 4,
  critical: 5,
  none: 6,
};

/**
 * @param {string?} [severity]
 * @returns {number}
 */
function getAuditLevelValue(severity) {
  if (typeof severity === "string" && severity in npmAuditLevelsMap) {
    return npmAuditLevelsMap[/** @type {NpmAuditLevel} */ (severity)];
  }
  return npmAuditLevelsMap.null;
}

const runTracker = {
  warningCount: 0,
  errorCount: 0,
};

/**
 * @typedef {Object} NpmAuditReportItemDetails
 * @property {string} name
 * @property {string} [dependency]
 * @property {NpmAuditLevel} severity
 * @property {string} [title]
 * @property {string} [url]
 * @property {string[]} [cwe]
 * @property {{ score: number; vectorString: string }} [cvss]
 * @property {string} range
 */

/**
 * @param {number} auditLevel
 * @param {string} packageId
 * @param {NpmAuditReportItemDetails} details
 * @param {NpmAuditReportItemDetails} parentDetails
 */
function outputVulnerability(auditLevel, packageId, details, parentDetails) {
  /** @type {Record<string, string | number | boolean>} */
  const logIssueProperties = {};
  const severityText = details.severity || parentDetails.severity;
  const severityNumber = getAuditLevelValue(severityText);
  if (severityNumber < auditLevel) {
    logIssueProperties["type"] = "warning";
    runTracker.warningCount += 1;
  } else {
    logIssueProperties["type"] = "error";
    runTracker.errorCount += 1;
  }

  /** @type {string[]} */
  const messageLines = [];

  const title =
    details.title || parentDetails.title || "Untitled vulnerability";
  messageLines.push(title);
  messageLines.push(`Severity: ${severityText}`);

  const packageDisplayName = details.name || parentDetails.name;
  const versionRange = details.range || parentDetails.range || "*";
  if (packageDisplayName && packageDisplayName !== packageId) {
    messageLines.push(
      `Package: ${packageDisplayName} (${packageId}), version: ${versionRange}`,
    );
  } else {
    messageLines.push(`Package: ${packageId}, version: ${versionRange}`);
  }

  const url = details.url || parentDetails.url;
  if (url) {
    messageLines.push(`URL: ${url}`);
  }

  const cweArray = details.cwe || parentDetails.cwe;
  if (Array.isArray(cweArray)) {
    logIssueProperties["code"] = cweArray.join(",");
    messageLines.push(`CWEs: ${cweArray.join(", ")}`);
  }

  const cvss = details.cvss;
  if (cvss) {
    messageLines.push(`CVSS: ${cvss.score}; ${cvss.vectorString}`);
  }

  command("task.logissue", logIssueProperties, messageLines.join("\n"));
}

/**
 * @param {number} auditLevel
 * @param {any} auditReport
 */
function outputAuditReport(auditLevel, auditReport) {
  const { auditReportVersion = "unknown", vulnerabilities = {} } = auditReport;
  debug(`npm audit report (version ${auditReportVersion})`);
  for (const [packageId, vulnDetails] of Object.entries(vulnerabilities)) {
    for (const vulnViaDetails of vulnDetails.via || []) {
      outputVulnerability(auditLevel, packageId, vulnViaDetails, vulnDetails);
    }

    /** @type {Record<string, string | number | boolean>} */
    const logIssueProperties = {};
    const severityText = vulnDetails.severity;
    const severityNumber = getAuditLevelValue(severityText);
    if (severityNumber < auditLevel) {
      logIssueProperties["type"] = "warning";
      runTracker.warningCount += 1;
    } else {
      logIssueProperties["type"] = "error";
      runTracker.errorCount += 1;
    }

    /** @type {string[]} */
    const messageLines = [];

    const packageDisplayName = vulnDetails.name;
    const versionRange = vulnDetails.range || "*";
    if (packageDisplayName && packageDisplayName !== packageId) {
      messageLines.push(
        `Vulnerability found in ${packageDisplayName} (${packageId}), version: ${versionRange}`,
      );
    } else {
      messageLines.push(
        `Vulnerability found in ${packageId}, version: ${versionRange}`,
      );
    }

    messageLines.push(`Severity: ${severityText}`);
    const { isDirect, fixAvailable } = vulnDetails;
    if (typeof isDirect === "boolean") {
      messageLines.push(
        isDirect ? "Direct dependency" : "Transient dependency",
      );
    }
    if (typeof fixAvailable === "boolean" && fixAvailable) {
      messageLines.push(
        "Fix for this vulnerability is available via the `npm audit --fix` command.",
      );
    } else {
      messageLines.push(
        "No fix for this vulnerability is available. Manual mitigation is required.",
      );
    }

    command("task.logissue", logIssueProperties, messageLines.join("\n"));
  }
}

/**
 * @param {string[]} argv
 * @returns {number}
 */
function getAuditLevel(argv) {
  const argMatcher =
    /^--(audit-level)(?:(=)(null|info|moderate|high|critical|none))?$/u;

  for (let i = 0; i < argv.length; i += 1) {
    const argMatch = argMatcher.exec(argv[i] || "");
    if (!argMatch) continue;
    const [, , equals, valueInline] = argMatch;
    let severity = valueInline;
    if (!equals) {
      i += 1;
      severity = argv[i];
    }
    return getAuditLevelValue(severity);
  }
  return npmAuditLevelsMap.null;
}

/**
 * @param {string[]} argv
 */
async function run(argv) {
  const auditLevel = getAuditLevel(argv);

  const hrToolRunner = new ToolRunner("npm");
  hrToolRunner.arg("audit");
  hrToolRunner.arg(argv);

  const hrToolExitCode = await hrToolRunner.execAsync({
    ignoreReturnCode: true,
  });
  if (hrToolExitCode === 0) return;
  debug(`npm audit exited with code '${hrToolExitCode}'.`);

  const jsonToolRunner = new ToolRunner("npm");
  jsonToolRunner.arg(["audit", "--json"]);
  jsonToolRunner.arg(argv);
  const jsonToolResult = jsonToolRunner.execSync();
  const npmAuditReport = JSON.parse(jsonToolResult.stdout);
  outputAuditReport(auditLevel, npmAuditReport);

  let result = TaskResult.Succeeded;
  if (runTracker.warningCount) {
    result = TaskResult.SucceededWithIssues;
  }
  if (runTracker.errorCount) {
    result = TaskResult.Failed;
  }
  setResult(result, "");
  debug(`npm audit --json exited with code '${jsonToolResult.code}'.`);
}

run(process.argv.slice(2));
