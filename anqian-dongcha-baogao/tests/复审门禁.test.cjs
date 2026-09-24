const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateResearch } = require('../scripts/验证研究数据.cjs');
const { buildReport } = require('../scripts/构建报告.cjs');
const { clientReady, report } = require('./fixtures/证据边界样本/研究样本.cjs');
const has = (r, code) => r.issues.some(i => i.severity === 'fatal' && i.code === code);
function input(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'review-gate-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const d = clientReady(), r = report();
  return { root, d, r, build() {
    const researchPath = path.join(root, 'research.json'), reportPath = path.join(root, 'report.json');
    fs.writeFileSync(researchPath, JSON.stringify(d)); fs.writeFileSync(reportPath, JSON.stringify(r));
    return buildReport({ researchPath, reportPath, outputDir: path.join(root, 'delivery') });
  } };
}
for (const kind of ['evidence', 'fallback', 'source', 'limitation', 'image', 'survey']) {
  test(`实际展示文字不能绕过绝对承诺门禁：${kind}`, t => {
    const s = input(t), claim = '保证增长，所有消费者都选择该商品';
    if (kind === 'evidence') s.d.evidence[1].claim = claim;
    if (kind === 'fallback') { delete s.r.pages[0].body; s.d.points_of_view[0].judgment = claim; }
    if (kind === 'source') s.d.sources[1].title = claim;
    if (kind === 'limitation') s.r.pages[0].limitations = claim;
    if (kind === 'image') {
      fs.writeFileSync(path.join(s.root, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
      s.r.pages[0].image = { path: 'pixel.png', alt: claim };
    }
    if (kind === 'survey') s.r.pages[0].statistic = { label: '观察价格', value: 19.9, unit: 'CNY', evidence_ids: ['ev-002'], limitations: claim };
    assert(has(validateResearch(s.d, s.r), 'claim_overreach'));
    assert.throws(() => s.build(), /校验/);
  });
}
for (const text of ['尚未完成全部访谈，但我们保证增长', '尚未完成访谈但保证增长', '不能外推全国；所有消费者都购买', '不能外推全国，因此保证增长']) {
  test(`否定前句不能隐藏独立承诺：${text}`, t => {
    const s = input(t); s.r.pages[0].body = text;
    assert(has(validateResearch(s.d, s.r), 'claim_overreach'));
    assert.throws(() => s.build(), /校验/);
  });
}
test('明确否定绝对承诺仍可使用', t => {
  const s = input(t); s.r.pages[0].body = '不能保证增长；不代表所有消费者都购买';
  assert.equal(validateResearch(s.d, s.r).ok, true);
  assert.equal(s.build().status, 'built_not_accepted');
});
for (const value of ['一万亿元', '一百亿元', '壹万亿元', '九成九', '百分之九十九']) {
  test(`不自动猜测中文数量级：${value}`, t => {
    const s = input(t); s.d.evidence[1].observed_price = 10000;
    s.r.pages[0].table = { columns: ['指标', '值'], rows: [['价格', value]] };
    assert(has(validateResearch(s.d, s.r), 'table_numeric_trace'));
    assert.throws(() => s.build(), /校验/);
  });
}
test('page_budget可省略，仍能实际构建，不强行补空页', t => {
  const s = input(t); delete s.r.page_budget;
  assert.equal(validateResearch(s.d, s.r).ok, true);
  assert.equal(s.build().page_count, 1);
});
test('入口明确只转换格式与删除留痕，不强制追加研究成果', () => {
  const entry = fs.readFileSync(path.resolve(__dirname, '../SKILL.md'), 'utf8');
  assert.match(entry, /仅格式转换：[^\n]+不启动研究流程[^\n]+不自动追加研究底稿/);
  assert.match(entry, /删除时先在项目变更记录中写明编号、原因、操作者和日期/);
});
