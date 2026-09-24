const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createDemo } = require('../scripts/生成演示项目.cjs');
const { buildReport } = require('../scripts/构建报告.cjs');
const { hashFile } = require('../scripts/lib/输入指纹.cjs');
const { checkPackage } = require('../scripts/lib/包契约.cjs');
const root = path.resolve(__dirname, '..');

test('新版入口、默认提示和版本不能再声称只有基础骨架', () => {
  const entry = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8');
  const name = entry.match(/^---\nname: (anqian-dongcha-baogao(?:-v2)?)\ndescription: .+\n---/)?.[1];
  assert.ok(name, '独立新版或稳定兼容入口必须有完整识别信息');
  assert.ok(!entry.includes('phase_1_skeleton'));
  assert.ok(!entry.includes('报告生成尚未实现'));
  assert.ok(fs.readFileSync(path.join(root, 'agents/openai.yaml'), 'utf8').includes('$' + name));
  const version = JSON.parse(fs.readFileSync(path.join(root, 'VERSION.json')));
  assert.equal(version.version, '0.6.0');
  assert.equal(version.builder_version, version.version);
  assert.equal(version.status, 'local_only');
});
test('全新临时技能目录独立构建，不依赖旧版安装，核心HTML哈希一致', t => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'skill-release-')));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const installed = path.join(temp, 'skill'); fs.cpSync(root, installed, { recursive: true });
  assert.equal(checkPackage(installed).ok, true);
  const input = createDemo(path.join(temp, 'project'));
  buildReport(input);
  const fresh = path.join(temp, 'fresh-delivery');
  const result = spawnSync(process.execPath, [path.join(installed, 'scripts/构建报告.cjs'),
    '--research', input.researchPath, '--report', input.reportPath, '--out', fresh], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(hashFile(path.join(fresh, '案前洞察.html')), hashFile(path.join(input.outputDir, '案前洞察.html')));
  fs.writeFileSync(path.join(installed, 'VERSION.json'), 'null');
  assert.equal(checkPackage(installed).ok, false);
});
test('发布包缺少任一图表门禁运行文件都会判定不完整', t => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'skill-chart-contract-')));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const installed = path.join(temp, 'skill'); fs.cpSync(root, installed, { recursive: true });
  const required = [
    'scripts/lib/图表方案.cjs', 'scripts/lib/图表占比.cjs',
    'scripts/检查图表方案.cjs', 'scripts/检查图表占比.cjs',
    'references/图表占比验收.md', 'references/图表占比登记格式.md',
    'scripts/兼容引擎/矩阵算式.cjs', 'scripts/兼容引擎/矩阵算式.css',
    'scripts/兼容引擎/关系图.cjs', 'scripts/兼容引擎/关系图.css',
    'assets/报告模板/结构图适配.css'
  ];
  for (const relative of required) {
    const file = path.join(installed, relative); const original = fs.readFileSync(file);
    fs.unlinkSync(file);
    const result = checkPackage(installed);
    assert.equal(result.ok, false, `${relative}缺失时仍被判完整`);
    assert.ok(result.issues.some(issue => issue.file === relative), `${relative}没有明确缺失记录`);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, original);
  }
});
test('公开包扫描实际执行且对伪私有路径样本报错', t => {
  const script = path.join(root, '公开仓库扫描.py');
  const run = directory => spawnSync(process.env.ANQIAN_PYTHON || 'python3', [script, directory], { encoding: 'utf8' });
  assert.equal(run(root).status, 0);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'package-scan-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  fs.writeFileSync(path.join(temp, 'unsafe.txt'), ['/', 'Users', '/private-example'].join(''));
  const failed = run(temp);
  assert.equal(failed.status, 1); assert.ok(!failed.stdout.includes('private-example'));
});
