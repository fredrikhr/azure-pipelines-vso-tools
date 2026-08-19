#!/usr/bin/env node
import * as path from "node:path";
import * as process from "node:process";

import {
  getVariable,
  setResult,
  TaskResult,
  IssueType,
  logIssue,
  debug,
} from "azure-pipelines-task-lib";
import { ToolRunner } from "azure-pipelines-task-lib/toolrunner.js";

/** @type {{[s in import('eslint').Linter.Severity]: IssueType}} */
const issueType = {
  0: IssueType.Warning,
  1: IssueType.Warning,
  2: IssueType.Error,
};

const sourcesRootDirectory =
  getVariable("Build.SourcesDirectory") ||
  process.env["Build.SourcesDirectory"] ||
  process.cwd();
const runTracker = {
  warningCount: 0,
  errorCount: 0,
};

/**
 * @param {import("eslint").ESLint.LintResult} lintResult
 */
function logResult({
  filePath,
  messages,
  errorCount,
  fatalErrorCount,
  warningCount,
}) {
  const relPath = path.relative(sourcesRootDirectory, filePath);
  for (const { line, column, severity, message, ruleId } of messages) {
    logIssue(
      issueType[severity],
      message,
      relPath,
      line,
      column,
      ruleId === null ? undefined : ruleId,
    );
  }
  runTracker.warningCount += warningCount;
  runTracker.errorCount += errorCount;
  runTracker.errorCount += fatalErrorCount;
}

/**
 * @param {string[]} argv
 */
async function run(argv) {
  const jsonToolRunner = new ToolRunner("npm");
  const eslintExecArgs = ["exec", "--package=eslint", "--", "eslint"];
  jsonToolRunner.arg(eslintExecArgs);
  jsonToolRunner.arg("--format=json");
  jsonToolRunner.arg(argv);
  const jsonToolResult = jsonToolRunner.execSync();
  /** @type {import("eslint").ESLint.LintResult[]} */
  const eslintResults = JSON.parse(jsonToolResult.stdout);
  eslintResults.forEach(logResult);

  let result = TaskResult.Succeeded;
  if (runTracker.warningCount) {
    result = TaskResult.SucceededWithIssues;
  }
  if (runTracker.errorCount) {
    result = TaskResult.Failed;
  }
  setResult(result, "");
  debug(`ESLint --format=json exited with code '${jsonToolResult.code}'.`);
}

run(process.argv.slice(2));
