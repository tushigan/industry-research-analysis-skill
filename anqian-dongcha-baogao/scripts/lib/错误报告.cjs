const { createIssue, summarizeIssues } = require("./contract-rules.cjs");

function reporter() {
  const issues = [];
  const add = (severity, path, code, message, suggestion = "按字段要求补证或退回内部研究阶段") => {
    issues.push({ ...createIssue(severity, path, message, suggestion), code, path });
  };
  return { issues, add, result: () => ({ ...summarizeIssues(issues), issues }) };
}

function formatReport(result) {
  const header = `${result.ok ? "通过" : "未通过"}：fatal ${result.counts.fatal}，warning ${result.counts.warning}，info ${result.counts.info}`;
  return [header, ...result.issues.map((issue) =>
    `[${issue.severity}] ${issue.file} (${issue.code}) ${issue.message}\n  修复：${issue.suggestion}`
  )].join("\n");
}

module.exports = { reporter, formatReport };
