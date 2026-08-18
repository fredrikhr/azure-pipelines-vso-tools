import {
  command,
  debug,
  setResult,
  TaskResult,
} from "azure-pipelines-task-lib";
import { ToolRunner } from "azure-pipelines-task-lib/toolrunner.js";

const argv = process.argv.slice(2);

const runTracker = {
  warningCount: 0,
  errorCount: 0,
};
const toolRunner = new ToolRunner("npm");
toolRunner.arg(argv);

/** @see https://github.com/thnetii/gh-actions/blob/f159471f6c222ff68652dca83441d13942100355/src/add-matcher-npm/npm.json */
const regexErrorPattern = "^npm\\s+ERR!\\s+(.*)$";
const regexErrorMatcher = new RegExp(regexErrorPattern, "u");
const regexWarningPattern = "^npm\\s+WARN\\s+(\\S+)\\s(.*)$";
const regexWarningMatcher = new RegExp(regexWarningPattern, "u");

/**
 * @typedef {Object} NpmIssueProperties
 * @property {'Error' | 'Warning'} type
 * @property {string | undefined} [code]
 */

/** @typedef {(props: NpmIssueProperties, message: string) => void} onMatchCallback */

/**
 * @param {string} line
 * @param {onMatchCallback} onMatch
 */
function tryGetErrorMatch(line, onMatch) {
  const match = regexErrorMatcher.exec(line);
  if (!match) return false;
  const [, message] = match;
  onMatch({ type: "Error" }, message || "");
  return true;
}

/**
 * @param {string} line
 * @param {onMatchCallback} onMatch
 */
function tryGetWarningMatch(line, onMatch) {
  const match = regexWarningMatcher.exec(line);
  if (!match) return false;
  const [, code, message] = match;
  onMatch({ type: "Warning", code }, `${code} ${message}`);
  return true;
}

/** @type {{props: NpmIssueProperties, message: string}[]} */
const logIssueBuffer = [];
/** @type {onMatchCallback} */
function pushLogIssue(props, message) {
  logIssueBuffer.push({ props, message });
}

/** @param {string} line */
function onNpmStdErrLine(line) {
  if (typeof line !== "string" || !line) return;
  if (tryGetErrorMatch(line, pushLogIssue)) {
    runTracker.errorCount += 1;
  } else if (tryGetWarningMatch(line, pushLogIssue)) {
    runTracker.warningCount += 1;
  }
}

/** @see https://github.com/dword-design/package-name-regex/blob/658ce7a661512f3e1e5496d6eb1dfd5ec8ae65a1/src/index.js */
const npmPackageNameRegex =
  /(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*/;
const npmPackageNameRegexWithVersionAndColon = new RegExp(
  `^\\s*${npmPackageNameRegex.source}@\\S+:`,
  "u",
);

toolRunner.on("errline", onNpmStdErrLine);
toolRunner.execAsync({ ignoreReturnCode: true }).then((exitCode) => {
  const mergedLogIssueBuffer = logIssueBuffer.reduce((acc, curr) => {
    const prv = acc[acc.length - 1];
    let merged = false;
    if (prv) {
      const {
        props: { type: prvType, code: prvCode },
        message: prvMsg,
      } = prv;
      const {
        props: { type, code },
        message,
      } = curr;
      if (
        prvType === type &&
        prvCode &&
        code &&
        prvCode === code &&
        prvMsg.startsWith(prvCode) &&
        message.startsWith(code)
      ) {
        const prvReason = prvMsg.substring(prvCode.length);
        const reason = message.substring(code.length);
        if (
          npmPackageNameRegexWithVersionAndColon.test(prvReason) &&
          !npmPackageNameRegexWithVersionAndColon.test(reason)
        ) {
          prv.message += `\n${reason}`;
          merged = true;
        }
      }
    }
    if (!merged) {
      acc.push(curr);
    }
    return acc;
  }, /** @type {typeof logIssueBuffer} */ ([]));
  for (const { props, message } of mergedLogIssueBuffer) {
    command("task.logissue", props, message);
  }
  let result = TaskResult.Succeeded;
  if (runTracker.warningCount) {
    result = TaskResult.SucceededWithIssues;
  }
  if (runTracker.errorCount) {
    result = TaskResult.Failed;
  }
  setResult(result, "");
  debug(`npm exited with code '${exitCode}'.`);
});
