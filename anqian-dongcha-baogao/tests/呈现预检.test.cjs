const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkPresentation } = require('../scripts/lib/呈现预检.cjs');

const report = () => ({ pages: [{ id: 'p1', blocks: [{ type: 'text', text: '研究判断' }] }] });
const checklist = () => ({ requirements: [{ id: 'q.a', text: '问题的必要子项', source_location: '原问题第一项' }],
  coverage: [{ requirement_id: 'q.a', page_ids: ['p1'], status: 'covered', reason: '给出分析及限制' }] });
const codes = value => value.issues.map(i => i.code);

test('登记一致不自动批准语义，输入只读', () => {
  const r = report(), c = checklist(), before = JSON.stringify([r, c]);
  const result = checkPresentation(r, c);
  assert.equal(result.status, 'mechanical_passed'); assert.equal(result.semantic_review, 'required');
  assert.equal(JSON.stringify([r, c]), before);
});
test('连续三张主表格提示，插入关系图确实打断连续段', () => {
  const r = { pages: [1, 2, 3].map(i => ({ id: `p${i}`, blocks: [{ type: 'table' }] })) };
  assert.ok(codes(checkPresentation(r)).includes('table_run'));
  r.pages[1].blocks = [{ type: 'diagram' }];
  assert.ok(!codes(checkPresentation(r)).includes('table_run'));
});
test('混排中的次要图表不掩盖连续表格的人工复核提示', () => {
  for (const layout of ['two-one', 'two-equal', 'three']) {
    const r = { pages: [1, 2, 3].map(i => ({ id: `p${i}`, layout,
      blocks: [{ type: 'table' }, { type: 'chart' }] })) };
    assert.ok(codes(checkPresentation(r)).includes('table_run'));
    assert.ok(checkPresentation(r).pages.every(p => p.table_review_candidate));
  }
});
test('图片阅读提示与统计图分开，不把商品图判为事实错误', () => {
  const r = report(); r.pages[0].blocks = [{ type: 'image' }];
  assert.ok(codes(checkPresentation(r)).includes('image_readability'));
  assert.notEqual(checkPresentation(r).status, 'invalid');
  r.pages[0].blocks.push({ type: 'chart' });
  assert.ok(codes(checkPresentation(r)).includes('image_readability'));
});
test('结构化visual布局不误当连续表格，普通表格仍提示', () => {
  const r = { presentation_style: 'visual', pages: [1, 2, 3].map(i => ({ page_id: `p${i}`, table: {}, visual_layout: 'steps' })) };
  assert.ok(!codes(checkPresentation(r)).includes('table_run'));
  r.pages.forEach(p => p.visual_layout = 'matrix');
  assert.ok(codes(checkPresentation(r)).includes('table_run'));
  r.pages.forEach(p => { delete p.visual_layout; p.content_mode = 'method'; });
  assert.ok(!codes(checkPresentation(r)).includes('table_run'));
  delete r.presentation_style;
  assert.ok(codes(checkPresentation(r)).includes('table_run'));
});
test('自动分页的单逻辑表格必须提示实体页复核，不误称没有连续表格风险', () => {
  for (const page_mode of ['landscape_16_9', 'a4_portrait']) {
    const r = { page_mode, pages: [{ page_id: 'p1', table: { columns: ['字段'], rows: Array.from({ length: 100 }, () => ['内容']) } }] };
    const result = checkPresentation(r, checklist());
    assert.equal(result.status, 'needs_review');
    assert.ok(codes(result).includes('table_pagination'));
    assert.ok(!codes(result).includes('table_run'));
    r.presentation_style = 'visual';
    assert.ok(!codes(checkPresentation(r)).includes('table_pagination'));
  }
});
test('遗漏子项、重复编号、无效页面和虚假的已覆盖均拒绝', () => {
  for (const [mutate, code] of [
    [c => c.coverage.pop(), 'coverage_missing'],
    [c => c.requirements.push(c.requirements[0]), 'requirement_duplicate'],
    [c => c.coverage.push(c.coverage[0]), 'coverage_duplicate'],
    [c => c.coverage[0].page_ids.push('absent'), 'coverage_pages'],
    [c => c.coverage[0].page_ids = [], 'coverage_empty'],
    [c => c.coverage[0].requirement_id = 'unknown', 'coverage_unknown'],
    [c => c.coverage[0].reason = '', 'coverage_reason'],
    [c => c.coverage[0].status = 'approved', 'coverage_status']
  ]) { const c = checklist(); mutate(c); const result = checkPresentation(report(), c);
    assert.equal(result.status, 'invalid'); assert.ok(codes(result).includes(code)); }
});
test('有理由的未知和舍弃保留人工提示，不伪装已经回答', () => {
  for (const status of ['unanswered', 'omitted']) {
    const c = checklist(); c.coverage[0] = { ...c.coverage[0], status, page_ids: [], reason: '原资料未提供，不能推断' };
    const result = checkPresentation(report(), c);
    assert.equal(result.status, 'needs_review'); assert.ok(codes(result).includes('coverage_unresolved'));
  }
});
test('损坏输入返回明确错误，不崩溃或当成空检查通过', () => {
  for (const r of [null, {}, { pages: [] }, { pages: [null] }, { pages: [{ id: 'x', blocks: [null] }] }])
    assert.equal(checkPresentation(r, checklist()).status, 'invalid');
  for (const c of [null, {}, { requirements: [null], coverage: [] }])
    assert.equal(checkPresentation(report(), c).status, 'invalid');
});
test('CLI只读、有效退出0，丢失引用退出1，非法JSON与未知参数失败', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'presentation-'));
  try {
    const rp = path.join(dir, 'report.json'), cp = path.join(dir, 'check.json');
    fs.writeFileSync(rp, JSON.stringify(report())); fs.writeFileSync(cp, JSON.stringify(checklist()));
    const script = path.resolve(__dirname, '../scripts/检查呈现.cjs');
    const call = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(call('--report', rp, '--checklist', cp).status, 0);
    const bad = checklist(); bad.coverage[0].page_ids = ['missing']; fs.writeFileSync(cp, JSON.stringify(bad));
    assert.equal(call('--report', rp, '--checklist', cp).status, 1);
    fs.writeFileSync(cp, '{'); assert.equal(call('--report', rp, '--checklist', cp).status, 1);
    assert.equal(call('--unknown').status, 1);
    assert.equal(fs.readFileSync(rp, 'utf8'), JSON.stringify(report()));
    assert.deepEqual(fs.readdirSync(dir).sort(), ['check.json', 'report.json']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
