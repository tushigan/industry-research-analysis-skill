const SEVERITIES = Object.freeze(["fatal", "warning", "info"]);

function createIssue(severity, file, message, suggestion) {
  if (!SEVERITIES.includes(severity)) {
    throw new Error(`不支持的严重性: ${severity}`);
  }
  return { severity, file, message, suggestion };
}

function summarizeIssues(issues) {
  const bySeverity = Object.fromEntries(SEVERITIES.map((severity) => [severity, []]));
  for (const item of issues) {
    if (!SEVERITIES.includes(item.severity)) {
      throw new Error(`结果包含不支持的严重性: ${item.severity}`);
    }
    bySeverity[item.severity].push(item);
  }

  return {
    ok: bySeverity.fatal.length === 0,
    counts: Object.fromEntries(
      SEVERITIES.map((severity) => [severity, bySeverity[severity].length])
    ),
    bySeverity
  };
}

function validateUniqueIds(document, fileName, collections) {
  const issues = [];
  for (const [collectionName, idField] of collections) {
    const records = collectionName.split(".").reduce((value, segment) => value?.[segment], document);
    if (!Array.isArray(records)) {
      continue;
    }

    const firstIndexes = new Map();
    records.forEach((record, index) => {
      const id = record?.[idField];
      if (typeof id !== "string") {
        return;
      }
      if (firstIndexes.has(id)) {
        issues.push(
          createIssue(
            "fatal",
            `${fileName}/${collectionName.replace(/\./g, "/")}/${index}/${idField}`,
            `项目内编号重复: ${id}`,
            `为第 ${index + 1} 条记录使用未出现过的 ${idField}`
          )
        );
        return;
      }
      firstIndexes.set(id, index);
    });
  }
  return issues;
}

module.exports = {
  SEVERITIES,
  createIssue,
  summarizeIssues,
  validateUniqueIds
};
