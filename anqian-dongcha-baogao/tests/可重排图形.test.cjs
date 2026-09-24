'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { renderDiagram, validateDiagram } = require('../scripts/兼容引擎/可重排图形.cjs');
const { build: engineBuild } = require('../scripts/兼容引擎/构建报告.cjs');
const { build } = require('../scripts/构建报告.cjs');
const { makeFixture } = require('../scripts/测试样本.cjs');
const { validateLegacy } = require('../scripts/lib/旧版输入.cjs');
const { get } = require('../scripts/兼容引擎/运行依赖.cjs');
const samples = [
  { type: 'diagram', variant: 'steps', title: '先核条件，再决定是否试销', columns: ['步骤', '核查动作', '进入下一步的条件'], rows: [
    ['核查产线', '确认现有设备能否稳定生产', '工艺条件满足'], ['核查渠道', '确认渠道接受的规格与周转要求', '补货条件可持续'],
    ['小范围试销', '观察复购与损耗，再决定是否扩大', '不把一次售罄当作长期需求'] ] },
  { type: 'diagram', variant: 'comparison', title: '同一任务下比较不同做法', columns: ['任务', '现有做法', '候选做法'], rows: [
    ['控制损耗', '按原规格整包销售', '小规格试销，核算新增包材成本'], ['确认补货', '依靠单次订货反馈', '连续观察补货与退货原因'] ] },
  { type: 'diagram', variant: 'opportunities', title: '机会必须同时说明条件与风险', columns: ['方向', '成立条件', '风险'], rows: [
    ['小规格试销', '先确认产线与渠道接受度', '单件包装成本可能上升'], ['减少配料复杂度', '不影响口感与货架稳定性', '不能以概念替代真实体验'],
    ['补货节奏优化', '能够取得连续动销反馈', '单店表现未必可复制'] ] }
];
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-test-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'project'), config = makeFixture(project);
  return { root, project, config };
}
function configure(f, diagrams) {
  const base = f.config.pages[0];
  f.config.charts = [];
  f.config.pages = diagrams.map((diagram, i) => ({ ...base, id: 'diagram-' + i, title: diagram.title || '未命名图形的页面标题',
    section: '图形技术验收', subtitle: '结构与显示测试，不代表市场研究结论。', layout: 'single', blocks: [diagram],
    takeaway: '这里只检验内容保留和关系呈现，不把技术通过当作业务批准。' }));
  save(f);
}
function save(f) { fs.writeFileSync(path.join(f.project, '报告.json'), JSON.stringify(f.config, null, 2)); }
function html(f) { return fs.readFileSync(path.join(f.project, '交付/案前洞察.html'), 'utf8'); }
for (const sample of samples) test(sample.variant + '使用独立关系结构和全部原文，不生成统计图或表格', () => {
  const output = renderDiagram(sample);
  assert.match(output, new RegExp('data-diagram="' + sample.variant + '"'));
  assert(!/<(?:table|canvas|svg|img)\b/.test(output));
  for (const value of [...sample.columns, ...sample.rows.flat()]) assert(output.includes(value));
  assert.equal((output.match(/class="diagram-item"/g) || []).length, sample.rows.length);
  if (sample.variant === 'steps') {
    assert.match(output, /<ol class="diagram-items">/);
    sample.rows.forEach((_, i) => assert(output.includes(`aria-hidden="true">${i + 1}</span>`)));
  }
  if (sample.variant === 'opportunities') assert.equal((output.match(/diagram-risk/g) || []).length, sample.rows.length);
});
test('可选标题不补虚构结论，单项图形保留文本', () => {
  const item = structuredClone(samples[2]); delete item.title; item.rows = [item.rows[0]];
  assert(!renderDiagram(item).includes('<h2>'));
});
test('两列steps有效，不齐列或偏斜换行不能绕过印刷容量', () => {
  const block = structuredClone(samples[0]); block.columns.pop(); block.rows.forEach(row => row.pop());
  assert.doesNotThrow(() => validateDiagram(block));
  for (const variant of ['steps', 'opportunities']) {
    const dense = maximum(variant); dense.rows[0][1] = '一\n' + '文'.repeat(58);
    assert.throws(() => validateDiagram(dense), /印刷容量/);
    const heading = maximum(variant); heading.rows[0][0] = '一\n' + '文'.repeat(22);
    assert.throws(() => validateDiagram(heading), /印刷容量/);
  }
});
const bad = [
  ['未知variant', b => b.variant = 'ranking'], ['原型variant', b => b.variant = 'constructor'],
  ['对象variant', b => b.variant = {}], ['无columns', b => delete b.columns],
  ['空列', b => b.columns = []], ['空列名', b => b.columns[1] = ' '], ['重复列名', b => b.columns[1] = b.columns[0]],
  ['不齐列', b => b.rows[0].pop()], ['空行', b => b.rows[0] = []], ['全空白行', b => b.rows[0] = [' ', '\n', '']],
  ['无rows', b => delete b.rows], ['空rows', b => b.rows = []], ['非数组行', b => b.rows[0] = '文字'],
  ['非文字单元格', b => b.rows[0][1] = 7], ['对象单元格', b => b.rows[0][1] = { html: '<b>内容</b>' }],
  ['空标题', b => b.title = ''], ['标题容量', b => b.title = '标'.repeat(49)],
  ['列名容量', b => b.columns[0] = '列'.repeat(13)], ['方向容量', b => b.rows[0][0] = '向'.repeat(25)],
  ['正文容量', b => b.rows[0][1] = '文'.repeat(61)], ['换行容量', b => b.rows[0][1] = '一\n二\n三'],
  ['控制字符', b => b.rows[0][1] = '危险\u0000文字'], ['steps行容量', b => b.rows = Array(6).fill(b.rows[0])],
  ['comparison行容量', b => { b.variant = 'comparison'; b.rows = Array(4).fill(b.rows[0]); }],
  ['opportunities第7项拒绝', b => { b.variant = 'opportunities'; b.rows = Array(7).fill(b.rows[0]); }],
  ['多余HTML', b => b.html = '<img src=x>'], ['多余CSS', b => b.css = 'body{display:none}'],
  ['多余样式', b => b.style = 'color:red'], ['多余脚本', b => b.script = 'alert(1)'],
  ['多余类名', b => b.className = 'page'], ['原型字段', b => Object.defineProperty(b, '__proto__', { value: {}, enumerable: true })]
];
for (const [name, mutate] of bad) test('新图形拒绝：' + name, t => {
  const f = fixture(t), block = structuredClone(samples[0]); mutate(block); configure(f, [block]);
  assert.throws(() => validateDiagram(block), /diagram/);
  assert.throws(() => validateLegacy(f.config, f.project), /diagram/);
  assert.throws(() => engineBuild(f.project), /diagram/);
  assert.throws(() => build(f.project), /diagram/);
  assert(!fs.existsSync(path.join(f.project, '交付')));
});
test('稀疏数组和访问器不执行也不吞空项', () => {
  const block = structuredClone(samples[0]); delete block.rows[0][1];
  assert.throws(() => validateDiagram(block), /diagram/);
  let called = false;
  Object.defineProperty(block, 'rows', { get() { called = true; return []; } });
  assert.throws(() => validateDiagram(block), /访问器/); assert.equal(called, false);
});
test('列数按图形语义限定', () => {
  for (const [variant, count] of [['steps', 4], ['comparison', 2], ['comparison', 5], ['opportunities', 2], ['opportunities', 4]]) {
    assert.throws(() => validateDiagram({ type: 'diagram', variant, columns: Array(count).fill('列'), rows: [Array(count).fill('文')] }), /容量/);
  }
});
test('普通小于号、引号、代码词和标签全部作为文字转义，不误拦截或解释成HTML', () => {
  const block = structuredClone(samples[0]);
  block.title = 'A < B & "对照"'; block.rows[0][1] = '</script><script>window.__diagramInjected=1</script>';
  block.rows[1][1] = 'CSS / JavaScript / url(示例) / a < b / x > y / \'引号\'';
  const output = renderDiagram(block);
  assert.match(output, /A &lt; B &amp; &quot;对照&quot;/);
  assert.match(output, /&lt;\/script&gt;&lt;script&gt;/);
  assert(!output.includes('<script>')); assert.match(output, /&#39;引号&#39;/);
});
test('印刷容量拒绝混排和多图，不影响已有文件', t => {
  const f = fixture(t); configure(f, [samples[0]]); engineBuild(f.project); const previous = html(f);
  f.config.pages[0].layout = 'two-equal'; save(f); assert.throws(() => engineBuild(f.project, true), /single布局/);
  f.config.pages[0].layout = 'single'; f.config.pages[0].blocks.push(samples[1]); save(f);
  assert.throws(() => engineBuild(f.project, true), /单页仅一个/); assert.equal(html(f), previous);
});
test('无diagram输入的HTML保持修改前逐字节指纹，且不注入图形CSS', t => {
  const f = fixture(t), manifest = engineBuild(f.project);
  assert.equal(manifest.htmlSha256, '8622c59449fbb5b93268ab3d600eb7fd8b221e12149ed54e79fb62997bde66ee');
  assert.equal(manifest.bytes, 1491264); assert(!html(f).includes('.diagram{'));
});
test('正式入口保留原配置并仅注入一次图形CSS；默认迁移保留diagram', t => {
  const f = fixture(t); configure(f, samples); build(f.project);
  assert.equal((html(f).match(/\.diagram\{min-width/g) || []).length, 1);
  const { migrateFile } = require('../scripts/迁移研究数据.cjs');
  const destination = path.join(f.root, 'migrated');
  migrateFile({ input: path.join(f.project, '报告.json'), out: destination });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(destination, '报告.json'))).pages.map(p => p.blocks[0]), samples);
});
function maximum(variant) {
  const rowCounts = { steps: 5, comparison: 3, opportunities: 4 };
  const columns = (variant === 'comparison' ? ['任务', '做法甲', '做法乙', '做法丙'] : ['方向', '成立条件', '风险']).map(s => s + '界'.repeat(12 - s.length));
  return { type: 'diagram', variant, title: '容量'.repeat(24), columns, rows: Array.from({ length: rowCounts[variant] }, () =>
    [variant === 'comparison' ? '标题'.repeat(12) : '标题'.repeat(6) + '\n' + '边界'.repeat(5) + '字',
      ...columns.slice(1).map(() => variant === 'comparison' ? '中'.repeat(48) : '中'.repeat(29) + '\n' + '文'.repeat(30))]) };
}
function overviewMaximum(count) {
  const block = maximum('opportunities');
  block.rows = Array.from({ length: count }, (_, i) => ['方向' + (i + 1) + '标题'.repeat(4) + '字\n' + '边界'.repeat(5) + '字',
    ...['条件', '风险'].map((label, j) => label + (i + 1) + ((i + j) % 2 ? '中'.repeat(37) : '中'.repeat(16) + '\n' + '文'.repeat(20)))]);
  return block;
}
for (const count of [5, 6]) test(`机会总览${count}项最大容量有效，超40字或打印超过2行明确拒绝`, () => {
  const block = overviewMaximum(count);
  assert.doesNotThrow(() => validateDiagram(block));
  assert.match(renderDiagram(block), /diagram-opportunities-overview/);
  for (const [text, error] of [['中'.repeat(41), /5至6项机会总览.*最多40字、2行/], ['一\n' + '文'.repeat(38), /5至6项机会总览.*印刷最多2行.*印刷容量/]]) {
    block.rows[0][1] = text;
    assert.throws(() => validateDiagram(block), error);
  }
  assert(!renderDiagram(maximum('opportunities')).includes('diagram-opportunities-overview'));
});
test('Playwright实测桌面、390手机、打印及PDF，含最大容量与文本注入', {
  skip: process.env.RUN_DELIVERY_TESTS !== '1', timeout: 120000
}, async t => {
  const f = fixture(t), security = structuredClone(samples[0]);
  security.title = 'A < B & "纯文字安全"';
  security.rows[0][1] = '<img src=//x.invalid onerror=window.__diagramInjected=1>';
  security.rows[1][1] = '</style><script>window.__diagramInjected=1</script>';
  security.rows[2][1] = 'CSS: url(https://example.invalid/y); 10 < 20 & 20 > 10';
  configure(f, [...samples, ...samples.map(s => maximum(s.variant)), security, overviewMaximum(5), overviewMaximum(6)]);
  build(f.project);
  const output = process.env.ANQIAN_DIAGRAM_EVIDENCE || path.join(f.root, 'evidence'); fs.mkdirSync(output, { recursive: true });
  const browser = await get('playwright').chromium.launch({ headless: true });
  const evidence = { layouts: [], requests: [], errors: [] };
  try {
    const page = await browser.newPage();
    await page.route(/^https?:/, route => { evidence.requests.push(route.request().url()); return route.abort(); });
    page.on('pageerror', error => evidence.errors.push(error.message));
    await page.goto(pathToFileURL(path.join(f.project, '交付/案前洞察.html')).href);
    await page.waitForFunction(() => window.reportReady === true); await page.evaluate(() => document.fonts.ready);
    for (const width of [1500, 1280, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const result = await inspect(page); evidence.layouts.push({ width, ...result });
      if (width !== 1280) {
        await page.locator('#toolbar').evaluate(el => el.style.visibility = 'hidden');
        for (let i = 0; i < f.config.pages.length; i++) {
          await page.locator('.page').nth(i).screenshot({ path: path.join(output, `${width === 390 ? '手机' : '桌面'}-${i + 1}.png`) });
        }
        await page.locator('#toolbar').evaluate(el => el.style.visibility = '');
      }
      assert.deepEqual(result.issues, [], JSON.stringify({ width, ...result }));
      assert.equal(result.minFont, 14);
      const vertical = await page.locator('.diagram-steps .diagram-items').first().evaluate(el => getComputedStyle(el).flexDirection);
      assert.equal(vertical, width === 390 ? 'column' : 'row');
      await inspectOverview(page, width === 390);
    }
    for (let i = 0; i < f.config.pages.length; i++) {
      const figure = page.locator('.diagram').nth(i), block = f.config.pages[i].blocks[0];
      assert.deepEqual(await figure.locator('dd').allTextContents(), block.rows.flatMap(row => row.slice(1)));
      assert.deepEqual(await figure.locator('h3').evaluateAll(nodes => nodes.map(node => [...node.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join(''))), block.rows.map(row => row[0]));
      assert.equal(await figure.locator('img,script,style,table,canvas,svg').count(), 0);
    }
    assert.equal(await page.evaluate(() => window.__diagramInjected), undefined);
    await page.setViewportSize({ width: 1500, height: 1000 }); await page.emulateMedia({ media: 'print' });
    evidence.print = await inspect(page); assert.deepEqual(evidence.print.issues, []);
    await inspectOverview(page, false);
    const printHeights = await page.locator('.diagram-opportunities-overview dd').evaluateAll(nodes => nodes.map(el => el.getBoundingClientRect().height));
    assert(printHeights.every(height => height <= 42), '机会总览打印正文超过两行');
    evidence.print.overviewMaxTextLines = Math.max(...printHeights) / 21;
    for (const i of [0, 1, 2, 7, 8]) await page.locator('.page').nth(i).screenshot({ path: path.join(output, `打印-${i + 1}.png`) });
    const pdf = path.join(output, '可重排图形.pdf'); await page.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
    const checked = spawnSync(process.env.ANQIAN_PYTHON || 'python3', ['-c',
      'import fitz,json,sys; d=fitz.open(sys.argv[1]); [d[i].get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(sys.argv[2]+"/PDF-"+str(i+1)+".png") for i in (7,8)]; print(json.dumps({"pages":len(d),"texts":[p.get_text() for p in d],"drawings":[len(p.get_drawings()) for p in d],"sizes":[[p.rect.width,p.rect.height] for p in d]},ensure_ascii=False))', pdf, output], { encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr); const parsed = JSON.parse(checked.stdout);
    assert.equal(parsed.pages, f.config.pages.length);
    f.config.pages.forEach((p, i) => {
      const normalize = s => s.replace(/\s/g, '');
      const block = p.blocks[0];
      for (const value of [block.title, ...block.columns, ...block.rows.flat()]) assert(normalize(parsed.texts[i]).includes(normalize(value)), `PDF第${i + 1}页丢文字：${value}`);
    });
    for (const i of [7, 8]) assert(parsed.drawings[i] >= f.config.pages[i].blocks[0].rows.length * 5, 'PDF机会分支和风险标识未保留');
    evidence.pdf = { pages: parsed.pages, sizes: parsed.sizes, drawings: parsed.drawings, textPreserved: true };
    assert.deepEqual(evidence.requests, []); assert.deepEqual(evidence.errors, []);
    const accepted = await require('../scripts/兼容引擎/验收报告.cjs').run(f.project, false, { output: path.join(output, '正式验收') });
    assert.equal(accepted.status, 'passed');
    evidence.acceptance = { status: accepted.status, presenter: accepted.presenter, widths: Object.keys(accepted.layouts) };
    fs.copyFileSync(path.join(f.project, '交付/案前洞察.html'), path.join(output, '可重排图形.html'));
    fs.writeFileSync(path.join(output, '浏览器回执.json'), JSON.stringify(evidence, null, 2));
    t.diagnostic(JSON.stringify(evidence));
  } finally { await browser.close(); }
});
async function inspectOverview(page, mobile) {
  const layouts = await page.locator('.diagram-opportunities-overview .diagram-items').evaluateAll(items => items.map(el => [...el.children].map(item => {
    const r = item.getBoundingClientRect(); return { x: r.x, y: r.y, bottom: r.bottom, width: r.width };
  })));
  assert.deepEqual(layouts.map(items => items.length), [5, 6]);
  for (const items of layouts) items.forEach((item, i) => {
    const column = mobile ? 0 : i % 3, rowStart = mobile ? i : Math.floor(i / 3) * 3;
    assert(Math.abs(item.x - items[column].x) < 1);
    assert(Math.abs(item.y - items[rowStart].y) < 1);
    assert(Math.abs(item.width - items[0].width) < 1);
    if (column > 0) assert(item.x >= items[i - 1].x + items[i - 1].width + 27);
    if (i >= (mobile ? 1 : 3)) assert(item.y >= items[i - (mobile ? 1 : 3)].bottom + 15);
  });
}
async function inspect(page) {
  return page.evaluate(() => {
    const issues = [], fonts = [], bounds = [];
    for (const [i, figure] of [...document.querySelectorAll('.diagram')].entries()) {
      const box = figure.getBoundingClientRect(), host = figure.closest('.page'), end = host.querySelector('.takeaway').getBoundingClientRect();
      bounds.push({ height: box.height, available: end.top - box.top, width: box.width });
      if (box.bottom > end.top + 1) issues.push(`图${i + 1}侵入观点区域`);
      for (const element of figure.querySelectorAll('*')) {
        const bounds = element.getBoundingClientRect();
        if (bounds.left < box.left - 1 || bounds.right > box.right + 1 || (!element.classList.contains('diagram-item') && element.scrollWidth > element.clientWidth + 1)) issues.push(`图${i + 1}横向溢出:${element.className || element.tagName}`);
        for (const node of element.childNodes) if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
          fonts.push(parseFloat(getComputedStyle(element).fontSize));
          const range = document.createRange(); range.selectNodeContents(node);
          for (const rect of range.getClientRects()) if (rect.bottom > box.bottom + 1 || rect.left < box.left - 1 || rect.right > box.right + 1) issues.push(`图${i + 1}文字越界:${node.textContent} (${rect.left},${rect.right},${rect.bottom}) / (${box.left},${box.right},${box.bottom})`);
        }
      }
      const footer = host.querySelector('footer').getBoundingClientRect();
      if (footer.bottom > host.getBoundingClientRect().bottom + 1) issues.push(`图${i + 1}页脚越界`);
    }
    if (document.documentElement.scrollWidth > window.innerWidth + 1) issues.push('页面横向溢出');
    return { issues, minFont: Math.min(...fonts), diagrams: document.querySelectorAll('.diagram').length, bounds };
  });
}
