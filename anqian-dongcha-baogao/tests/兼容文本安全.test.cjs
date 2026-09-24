'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { build } = require('../scripts/构建报告.cjs');
const { makeFixture } = require('../scripts/测试样本.cjs');
const { get } = require('../scripts/兼容引擎/运行依赖.cjs');
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-html-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'project'), config = makeFixture(project);
  return { root, project, config, report: path.join(project, '报告.json') };
}
const payload = '<img src="https://example.invalid/qa-probe.png" onerror="window.__qaInjected=42">';
for (const [name, mutate] of [
  ['顶层提示', o => o.tooltip = { trigger: 'item', formatter: payload }],
  ['系列提示', o => o.series[0].tooltip = { formatter: payload }],
  ['数据项提示', o => o.series[0].data[0] = { value: 20, tooltip: { formatter: payload } }],
  ['系列名插值', o => o.series[0].name = payload],
  ['数据名插值', o => o.series[0].data[0] = { value: 20, name: payload }],
  ['数据视图', o => o.toolbox = { feature: { dataView: { lang: [payload, '关闭', '刷新'] } } }],
  ['数据视图内容', o => o.toolbox = { feature: { dataView: { optionToContent: payload } } }],
  ['SVG标签', o => o.tooltip = { formatter: '<svg/onload="window.__qaInjected=42">' }],
  ['文本区逃逸', o => o.series[0].name = '</textarea><img src=x onerror="window.__qaInjected=42">'],
  ['模板组合标签', o => { o.series[0].name = 'img'; o.tooltip = { formatter: '<{a} src="https://example.invalid/a.png" onerror="window.__qaInjected=42">' }; }],
  ['数据组合标签', o => { o.series[0].name = '<'; o.tooltip = { formatter: '{a}img src=x onerror="window.__qaInjected=42">' }; }]
]) test('正式构建及默认迁移拒绝HTML：' + name, t => {
  const f = fixture(t); mutate(f.config.charts[0].option);
  fs.writeFileSync(f.report, JSON.stringify(f.config));
  assert.throws(() => build(f.project), /HTML标签/);
  assert(!fs.existsSync(path.join(f.project, '交付')));
  const destination = path.join(f.root, 'migrated');
  const run = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/迁移研究数据.cjs'), '--input', f.report, '--out', destination], { encoding: 'utf8' });
  assert.notEqual(run.status, 0); assert.match(run.stderr, /HTML标签/);
  assert(!fs.existsSync(destination));
});
for (const [name, mutate] of [
  ['按钮颜色', o => o.toolbox = { feature: { dataView: { show: true, buttonColor: 'red;background-image:u\\72l(https://example.invalid/a.png)' } } }],
  ['按钮文字色', o => o.toolbox = { feature: { dataView: { buttonTextColor: 'red; background:u/**/rl(https://example.invalid/a.png)' } } }],
  ['提示字体', o => o.tooltip = { textStyle: { fontFamily: 'serif;background:u\\72l(https://example.invalid/a.png)' } }],
  ['提示边框', o => o.tooltip = { borderWidth: '1;background:u\\72l(https://example.invalid/a.png)' }],
  ['提示内边距', o => o.tooltip = { padding: [0, '0;background:u\\72l(https://example.invalid/a.png)'] }],
  ['调色盘', o => o.color = ['red; background:u\\72l(https://example.invalid/a.png)']],
  ['渐变色', o => o.series[0].itemStyle = { color: { type: 'linear', colorStops: [{ offset: 0, color: 'red; background:u\\72l(https://example.invalid/a.png)' }] } }]
]) test('正式构建及迁移拒绝CSS拼接：' + name, t => {
  const f = fixture(t); mutate(f.config.charts[0].option); fs.writeFileSync(f.report, JSON.stringify(f.config));
  assert.throws(() => build(f.project), /安全格式/);
  const { migrateFile } = require('../scripts/迁移研究数据.cjs');
  assert.throws(() => migrateFile({ input: f.report, out: path.join(f.root, 'migrated') }), /安全格式/);
});
test('允许纯文本模板且实际触发提示时无脚本和外联', {
  skip: process.env.RUN_DELIVERY_TESTS !== '1', timeout: 60000
}, async t => {
  const f = fixture(t), option = f.config.charts[0].option;
  option.series[0].name = '合成数据';
  option.tooltip = { trigger: 'item', formatter: '{a}: {b} = {c}', backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1, padding: [5, 10], textStyle: { fontFamily: 'sans-serif', fontSize: 14, color: '#123456' } };
  option.toolbox = { show: true, feature: { dataView: { show: true, readOnly: true,
    title: 'Data view', lang: ['Synthetic data', 'Close', 'Refresh'], buttonColor: 'rgb(24,120,90)', buttonTextColor: '#fff' } } };
  fs.writeFileSync(f.report, JSON.stringify(f.config)); build(f.project);
  const browser = await get('playwright').chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), requests = [], errors = [];
    await page.route(/^https?:/, route => { requests.push(route.request().url()); return route.abort(); });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(f.project, '交付/案前洞察.html')).href);
    await page.waitForFunction(() => window.reportReady === true);
    await page.evaluate(() => window.reportCharts[0].instance.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: 0 }));
    await page.waitForFunction(() => document.body.innerText.includes('合成数据: 阶段甲 = 20'));
    const point = await page.evaluate(() => {
      const chart = window.reportCharts[0].instance, component = chart.getModel().getComponent('toolbox');
      const icon = chart.getViewOfComponentModel(component)._features.dataView.model.iconPaths.dataView;
      const rect = icon.getBoundingRect().clone(); rect.applyTransform(icon.getComputedTransform());
      const host = chart.getDom().getBoundingClientRect();
      return { x: host.x + rect.x + rect.width / 2, y: host.y + rect.y + rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    await page.locator('textarea:visible').waitFor();
    assert.match(await page.locator('textarea:visible').inputValue(), /阶段甲/);
    assert.equal(await page.getByText('Close', { exact: true }).evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(24, 120, 90)');
    await page.getByText('Close', { exact: true }).click();
    await page.locator('textarea:visible').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__qaInjected), undefined);
    assert.deepEqual(requests, []); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
