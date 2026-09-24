const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const root = path.resolve(__dirname, "../assets/依赖");
const digest = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const file = path.join(dir, e.name);
    assert.ok(!e.isSymbolicLink(), "依赖不能为符号链接");
    return e.isDirectory() ? files(file) : [path.relative(root, file)];
  });
}
test("随包依赖与固定发行指纹一致，不依赖旧版安装", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "文件指纹.json"), "utf8"));
  assert.deepEqual(files(root).filter(f => f !== "文件指纹.json").sort(), manifest.files.map(f => f.path).sort());
  for (const item of manifest.files) assert.equal(digest(path.join(root, item.path)), item.sha256, item.path);
  const source = fs.readFileSync(path.join(root, "依赖来源.md"), "utf8");
  for (const text of ["PDF.js 5.6.205", "standard_fonts", "cmaps", "官方发行文件"]) assert.ok(source.includes(text));
});
test("可选的旧版只读基线比对", { skip: !process.env.ANQIAN_OLD_SKILL_ROOT && "仅开发回归指定旧版基线时运行" }, () => {
  const old = path.join(process.env.ANQIAN_OLD_SKILL_ROOT, "assets/依赖");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "文件指纹.json"), "utf8"));
  for (const item of manifest.files.filter(f => f.path !== "依赖来源.md")) {
    assert.equal(digest(path.join(old, item.path)), item.sha256, item.path);
  }
});
