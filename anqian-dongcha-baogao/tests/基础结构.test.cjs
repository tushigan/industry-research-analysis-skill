const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { checkPackage, readFixture, validateFixture } = require("../scripts/lib/包契约.cjs");
const { createIssue, summarizeIssues } = require("../scripts/lib/contract-rules.cjs");
const { validateDocument } = require("../scripts/lib/schema-validator.cjs");

const packageRoot = path.resolve(__dirname, "..");
const oldSkillRoot =
  process.env.ANQIAN_OLD_SKILL_ROOT ??
  path.join(os.homedir(), ".codex", "skills", "anqian-dongcha-baogao");
const oldDependencyRoot = path.join(oldSkillRoot, "assets", "依赖");
const fixtureDirectory = "tests/fixtures/基础有效样本";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fixturePath(root, fileName) {
  return path.join(root, fixtureDirectory, fileName);
}

function copyToTemp() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "anqian-research-skill-"));
  const copiedRoot = path.join(temporaryRoot, "package");
  fs.cpSync(packageRoot, copiedRoot, { recursive: true });
  return { temporaryRoot, copiedRoot };
}

function withTempCopy(callback) {
  const { temporaryRoot, copiedRoot } = copyToTemp();
  try {
    return callback(copiedRoot, temporaryRoot);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function updateFixture(root, fileName, mutate) {
  const filePath = fixturePath(root, fileName);
  const fixture = readJson(filePath);
  mutate(fixture);
  fs.writeFileSync(filePath, `${JSON.stringify(fixture, null, 2)}\n`);
}

function assertIssue(result, predicate) {
  assert.equal(result.issues.some(predicate), true);
}

test("新版 Skill 包含 Phase 1 必需文件并通过契约检查", () => {
  const result = checkPackage(packageRoot);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.counts, { fatal: 0, warning: 0, info: 0 });
});

test("完整包复制到全新临时目录后仍可读取", () =>
  withTempCopy((copiedRoot) => {
    const result = checkPackage(copiedRoot);
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    const fixture = readFixture(copiedRoot, "研究数据.json");
    assert.deepEqual(fixture.issues, []);
    assert.equal(fixture.value.project.project_id, "demo-project");
  })
);

test("匿名研究数据和报告配置符合对应 JSON Schema", () => {
  const data = readFixture(packageRoot, "研究数据.json");
  const report = readFixture(packageRoot, "报告.json");
  assert.deepEqual(data.issues, []);
  assert.deepEqual(report.issues, []);
  for (const [fileName, schemaName] of Object.entries({
    "研究数据.json": "研究项目.schema.json",
    "报告.json": "报告配置.schema.json",
    "成品清单.json": "成品清单.schema.json"
  })) {
    assert.deepEqual(validateFixture(packageRoot, fileName, schemaName).issues, []);
  }
  assert.equal(data.value.schema_version, "0.1");
  assert.equal(data.value.evidence.length, 6);
  assert.equal(report.value.page_mode, "landscape_16_9");
  assert.deepEqual(report.value.attachments, []);
});

test("Schema 校验会拒绝缺字段和错误枚举，而不是只解析 JSON", () => {
  const researchSchema = readJson(path.join(packageRoot, "schemas/研究项目.schema.json"));
  const reportSchema = readJson(path.join(packageRoot, "schemas/报告配置.schema.json"));
  const research = readFixture(packageRoot, "研究数据.json").value;
  const report = readFixture(packageRoot, "报告.json").value;
  delete research.evidence[0].sample_size;
  report.page_mode = "square";

  assert.ok(
    validateDocument(research, researchSchema).some((error) =>
      error.path.includes("/evidence/0")
    )
  );
  assert.ok(
    validateDocument(report, reportSchema).some((error) =>
      error.path.includes("/page_mode")
    )
  );
});

test("样本读取拒绝路径穿越、绝对路径和符号链接越界", () => {
  for (const fileName of [
    "../../../../etc/passwd",
    path.join(os.tmpdir(), "outside.json")
  ]) {
    const result = readFixture(packageRoot, fileName);
    assert.equal(result.value, null);
    assert.equal(result.issues[0].severity, "fatal");
  }

  withTempCopy((copiedRoot, temporaryRoot) => {
    const outsidePath = path.join(temporaryRoot, "outside.json");
    const linkPath = fixturePath(copiedRoot, "link.json");
    fs.writeFileSync(outsidePath, "{}\n");
    fs.symlinkSync(outsidePath, linkPath);
    const linked = readFixture(copiedRoot, "link.json");
    assert.equal(linked.value, null);
    assert.equal(linked.issues[0].severity, "fatal");
  });
});

test("研究项目 Schema 使用可组合的证据公共字段契约", () => {
  const schema = JSON.parse(
    fs.readFileSync(path.join(packageRoot, "schemas/研究项目.schema.json"), "utf8")
  );
  const evidenceSchema = schema.$defs?.evidence;
  assert.equal(evidenceSchema?.unevaluatedProperties, false);
  assert.equal(Array.isArray(evidenceSchema?.oneOf), true);
  assert.equal(evidenceSchema.oneOf.length, 6);
  for (const branch of evidenceSchema.oneOf) {
    assert.equal(branch.allOf?.length, 2);
    assert.equal(branch.allOf[1].additionalProperties, undefined);
  }
});

test("缺少入口文件以 fatal 失败", () =>
  withTempCopy((copiedRoot) => {
    fs.rmSync(path.join(copiedRoot, "SKILL.md"));
    const result = checkPackage(copiedRoot);
    assert.equal(result.ok, false);
    assertIssue(result, (item) => item.severity === "fatal" && item.file === "SKILL.md");
  })
);

test("错误版本信息以 fatal 失败", () =>
  withTempCopy((copiedRoot) => {
    const versionPath = path.join(copiedRoot, "VERSION.json");
    const version = readJson(versionPath);
    version.package_name = "anqian-dongcha-baogao";
    version.version = "draft";
    fs.writeFileSync(versionPath, `${JSON.stringify(version, null, 2)}\n`);
    const result = checkPackage(copiedRoot);
    assert.equal(result.ok, false);
    assert.ok(result.issues.filter((item) => item.severity === "fatal").length >= 2);
  })
);

test("包契约会在样本字段不符合 Schema 时以 fatal 失败", () =>
  withTempCopy((copiedRoot) => {
    updateFixture(copiedRoot, "研究数据.json", (fixture) => {
      delete fixture.evidence[0].sample_size;
    });
    const result = checkPackage(copiedRoot);
    assert.equal(result.ok, false);
    assertIssue(
      result,
      (item) =>
        item.severity === "fatal" &&
        item.file.includes("研究数据.json") &&
        item.message.includes("JSON Schema")
    );
  })
);

test("包契约会拒绝项目内重复编号", () =>
  withTempCopy((copiedRoot) => {
    updateFixture(copiedRoot, "研究数据.json", (fixture) => {
      fixture.questions[1].question_id = fixture.questions[0].question_id;
    });
    const result = checkPackage(copiedRoot);
    assert.equal(result.ok, false);
    assert.ok(result.counts.fatal >= 1);
    assertIssue(
      result,
      (item) =>
        item.file.includes("研究数据.json/questions/1/question_id") &&
        item.message.includes("编号重复")
    );
  })
);

test("fatal、warning、info 会分栏返回，且未知严重性会失败", () => {
  const summary = summarizeIssues([
    createIssue("fatal", "a", "阻止", "修复"),
    createIssue("warning", "b", "警告", "记录"),
    createIssue("info", "c", "提示", "查看")
  ]);
  assert.equal(summary.ok, false);
  assert.deepEqual(summary.counts, { fatal: 1, warning: 1, info: 1 });
  assert.equal(summary.bySeverity.warning[0].message, "警告");
  assert.throws(
    () => createIssue("unknown", "d", "错误", "修复"),
    /不支持的严重性/
  );
});

test("公开包文本不包含客户资料或个人绝对路径", () => {
  const textExtensions = new Set([
    ".md",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".cjs",
    ".js",
    ".mjs",
    ".sh",
    ".py",
    ".html",
    ".css",
    ".txt"
  ]);
  const forbidden = [
    ["/", "Users", "/"].join(""),
    ["蒙", "小聚"].join(""),
    ["中保预包装", "烘焙"].join(""),
    ["巴比", "熊"].join(""),
    ["API", "_", "KEY"].join(""),
    ["TAVILY", "_", "API", "_", "KEY"].join("")
  ];
  const violations = [];

  function scan(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        scan(filePath);
      } else if (textExtensions.has(path.extname(entry.name))) {
        const content = fs.readFileSync(filePath, "utf8");
        for (const marker of forbidden) {
          if (content.includes(marker)) {
            violations.push(`${path.relative(packageRoot, filePath)}: ${marker}`);
          }
        }
      }
    }
  }

  scan(packageRoot);
  assert.deepEqual(violations, []);
});
