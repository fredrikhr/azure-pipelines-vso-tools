#!/usr/bin/env node
import * as path from "node:path";
import * as fs from "node:fs";
import { PassThrough } from "node:stream";
import * as readline from "node:readline";

import {
  command,
  debug,
  getVariable,
  setResult,
  TaskResult,
} from "azure-pipelines-task-lib";
import { ToolRunner } from "azure-pipelines-task-lib/toolrunner.js";

const argv = process.argv.slice(2);

const sourcesRootDirectory =
  getVariable("Build.SourcesDirectory") ||
  process.env["Build.SourcesDirectory"] ||
  process.cwd();

const runTracker = {
  warningCount: 0,
  errorCount: 0,
};
const toolRunner = new ToolRunner("npm");
toolRunner.arg([
  "exec",
  "--package=prettier",
  "--",
  "prettier",
  "--check",
  "--no-color",
]);
toolRunner.arg(argv);

const prettierMessageRegex = /^\[([^\]]*)\]\s*(.*)$/iu;

/**
 * @typedef {Object} VsoTaskLogIssueProperties
 * @property {"error" | "warning"} type
 * @property {string} [sourcepath]
 */

/**
 * @param {string} line
 */
function tryEmitPrettierMessageCommand(line) {
  if (typeof line !== "string" || !line) return;
  const match = prettierMessageRegex.exec(line);
  if (!match) return;
  const [, severity, message = ""] = match;
  if (!severity) return;
  const typeSeverityMappings = Object.entries({
    warning: /^warn$/iu,
    error: /^error$/iu,
    debug: /^debug$/iu,
  });
  const [type = severity] = typeSeverityMappings.find(([, matcher]) =>
    matcher.test(severity),
  ) || [undefined, undefined];
  /** @type {VsoTaskLogIssueProperties?} */
  const properties = type === "warning" || type === "error" ? { type } : null;
  if (properties && fs.existsSync(message)) {
    const filePath = path.relative(sourcesRootDirectory, message);
    properties.sourcepath = filePath;
  }
  if (properties) {
    if (properties.type === "error") {
      runTracker.errorCount += 1;
    } else if (properties.type === "warning") {
      runTracker.warningCount += 1;
    }
    command("task.logissue", properties, message);
  } else if (/^debug$/iu.test(type)) {
    debug(message);
  }
}

// Using own errline parsing here is necessary, because the ToolRunner built-in
// errline handling only accounts for os.EOL line-endings, whereas NPM happily
// outputs \n line-endings only. This leads to errors and warnings not being
// captured properly on when running on Windows
// (or any other OS where os.EOL is not equal to "\n")
const errlinePassThrough = new PassThrough();
const errline = readline.createInterface({
  input: errlinePassThrough,
  crlfDelay: Infinity,
});
errline.on("line", tryEmitPrettierMessageCommand);

toolRunner.on(
  "stderr",
  /** @param {Buffer} data */ (data) => {
    errlinePassThrough.write(data);
  },
);
toolRunner.on("done", () => errlinePassThrough.end());
toolRunner.execAsync({ ignoreReturnCode: true }).then((exitCode) => {
  let result = TaskResult.Succeeded;
  if (runTracker.warningCount) {
    result = TaskResult.SucceededWithIssues;
  }
  if (runTracker.errorCount) {
    result = TaskResult.Failed;
  }
  setResult(result, "");
  debug(`prettier exited with code '${exitCode}'.`);
});
