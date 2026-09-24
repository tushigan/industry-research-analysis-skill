'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { renderDiagram, validateDiagram, validateDiagramPage } = require('../scripts/兼容引擎/可重排图形.cjs');
const { build: engineBuild } = require('../scripts/兼容引擎/构建报告.cjs');
const { build } = require('../scripts/构建报告.cjs');
const { validateLegacy } = require('../scripts/lib/旧版输入.cjs');
const { makeFixture } = require('../scripts/测试样本.cjs');
const { get } = require('../scripts/兼容引擎/运行依赖.cjs');
const columns = ['环节', '控制动作', '守住的结果', '失控后果'];
// 技术样本压缩自30页修订稿p22/p23，仅表达待验证控制框架。
const rows = [
  ['原料与生产', '核进料、卫生、烘烤与冷却记录', '批次稳定与产品放行', '批次漂移、返工或退货'],
  ['配方与包装', '核水分活度、阻隔密封及分时点品质', '包装适配与品质接受终点', '运输后品质不稳'],
  ['储运与终端', '核储运条件、批次日期与先进先出', '可售区域与剩余销售窗口', '临期折损抵消毛利'],
  ['渠道', '核规格、价盘与终端服务', '匹配真实售卖环境', '上架但没有有效动销'],
  ['周转', '核先进先出、补货与剩余期限', '供货窗口与补货匹配', '临期折损抵消毛利']
];
const sample = (count = 3) => ({ type: 'diagram', variant: 'control-chain', columns: [...columns], rows: rows.slice(0, count).map(r => [...r]) });
function maximum(count) {
  const block = sample(count); block.title = '控制链容量验收'.repeat(4);
  block.rows = Array.from({ length: count }, (_, i) => ['节点' + (i + 1) + '界'.repeat(15),
    ...['动作', '结果', '后果'].map((label, j) => label + (i + 1) + ((i + j) % 2 ? '中'.repeat(29) : '中'.repeat(8) + '\n' + '文'.repeat(20)))]);
  return block;
}
function fixture(t, blocks) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'control-chain-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'project'), config = makeFixture(project);
  config.charts = [];
  config.pages = blocks.map((block, i) => ({ ...config.pages[0], id: 'control-' + i, section: '控制链技术验收',
    title: '控制动作影响下游结果，失控后果另走分支', subtitle: '待验证控制框架，不是企业实测结果。', layout: 'single', blocks: [block],
    takeaway: '技术样本只验证文字、顺序和分支，不构成业务结论。' }));
  fs.writeFileSync(path.join(project, '报告.json'), JSON.stringify(config, null, 2));
  return { root, project, config, html: path.join(project, '交付/案前洞察.html') };
}
for (const count of [3, 5]) test(`控制链${count}节点保留四列原文、主流程和独立失败分支`, () => {
  const block = sample(count), html = renderDiagram(block);
  assert(!/<(?:table|canvas|svg|img|script|style)\b/.test(html));
  assert.match(html, /<ol class="chain-stages">/);
  assert.equal((html.match(/class="chain-stage"/g) || []).length, count);
  assert.equal((html.match(/class="chain-next"/g) || []).length, count - 1);
  assert.equal((html.match(/class="chain-failure-link"/g) || []).length, count);
  for (const value of [...columns, ...block.rows.flat()]) assert(html.includes(value));
  assert(!html.includes('<h2>')); assert.doesNotThrow(() => validateDiagram(maximum(count)));
});
test('纯文字转义不执行标签、引号及代码词', () => {
  const block = sample(); block.title = 'A < B & "对照"';
  block.rows[0][1] = '<img src=x onerror=alert(1)>';
  block.rows[1][1] = '</style><script>x=1</script>';
  block.rows[2][1] = 'a < b & x > y / \'引号\'';
  const html = renderDiagram(block);
  assert.match(html, /A &lt; B &amp; &quot;对照&quot;/);
  assert.match(html, /&lt;img src=x/); assert.match(html, /&#39;引号&#39;/);
  assert(!/<(?:img|script|style)\b/.test(html));
});
const bad = [
  ['两行', b => b.rows.pop()], ['六行', b => b.rows = [...rows, rows[0]]],
  ['三列', b => b.columns.pop()], ['额外列', b => b.columns.push('颜色')],
  ['列语义', b => b.columns[2] = '风险'], ['列序', b => b.columns.reverse()],
  ['首列19字', b => b.rows[0][0] = '长'.repeat(19)], ['正文33字', b => b.rows[0][1] = '文'.repeat(33)],
  ['手动三行', b => b.rows[0][1] = '一\n二\n三'], ['印刷标题三行', b => { b.rows = maximum(5).rows; b.rows[0][0] = '一\n' + '文'.repeat(16); }],
  ['印刷正文四行', b => { b.rows = maximum(5).rows; b.rows[0][1] = '一\n' + '文'.repeat(30); }],
  ['缺格', b => b.rows[0].pop()], ['空文字', b => b.rows[0][2] = ' '],
  ['控制字符', b => b.rows[0][1] = '文本\u0000'], ['数字', b => b.rows[0][1] = 12],
  ['标题换行', b => b.title = '一\n二'], ['标题49字', b => b.title = '题'.repeat(49)],
  ...['html', 'css', 'style', 'script', 'className', '__proto__'].map(key => [key, b => Object.defineProperty(b, key, { value: '注入', enumerable: true })])
];
for (const [label, mutate] of bad) test('控制链拒绝' + label + '且公共入口不写交付', t => {
  const block = sample(); mutate(block); const f = fixture(t, [block]);
  assert.throws(() => validateDiagram(block), /diagram/);
  assert.throws(() => validateLegacy(f.config, f.project), /diagram/);
  assert.throws(() => engineBuild(f.project), /diagram/);
  assert.throws(() => build(f.project), /diagram/);
  assert(!fs.existsSync(path.join(f.project, '交付')));
});
test('字段、列、行与单元格访问器不被执行；拒绝原型数组、符号及稀疏项', () => {
  for (const target of ['block', 'columns', 'rows', 'cell', 'prototype']) {
    const block = sample(); let called = false;
    const getValue = () => { called = true; return ['注入']; };
    if (target === 'block') Object.defineProperty(block, 'rows', { get: getValue });
    if (target === 'columns') Object.defineProperty(block.columns, '0', { get: getValue });
    if (target === 'rows') Object.defineProperty(block.rows, '0', { get: getValue });
    if (target === 'cell') Object.defineProperty(block.rows[0], '0', { get: getValue });
    if (target === 'prototype') Object.setPrototypeOf(block.columns, { forEach: getValue });
    assert.throws(() => validateDiagram(block), /diagram/); assert.equal(called, false);
  }
  for (const mutate of [b => delete b.rows[0][1], b => b.rows[0][Symbol('extra')] = 'x', b => b[Symbol('extra')] = 'x', b => Object.setPrototypeOf(b, { rows })]) {
    const block = sample(); mutate(block); assert.throws(() => validateDiagram(block), /diagram/);
  }
});
test('只允许single单块页，额外块和混排明确报错', () => {
  assert.equal(validateDiagramPage({ layout: 'single', blocks: [sample()] }), true);
  for (const p of [{ layout: 'two-equal', blocks: [sample()] }, { layout: 'single', blocks: [sample(), sample()] }]) assert.throws(() => validateDiagramPage(p), /single布局/);
});
test('旧三种图形与公共CSS保留修改前字节指纹，旧输入不注入新CSS', t => {
  const hashes = { steps: '8807e21952c2b599bcbb71d61bc0bd68301e00d884ad5ad1e97b3e6c54c75665', comparison: '4503ccd02214a30c9e33cf188b98fc25088d282e43516547b6fa1c20d2c7ce68', opportunities: '9053c685ac1581543922d1b243026db890c19b4bb3158abfa51e54eab484bb56' };
  const hash = value => createHash('sha256').update(value).digest('hex');
  const blocks = Object.keys(hashes).map(variant => ({ type: 'diagram', variant, title: '历史图形', columns: ['环节', '动作', '条件'], rows: [['上游', '核查输入', '满足条件'], ['下游', '核查输出', '保留边界']] }));
  for (const block of blocks) assert.equal(hash(renderDiagram(block)), hashes[block.variant]);
  assert.equal(hash(fs.readFileSync(path.join(__dirname, '../scripts/兼容引擎/可重排图形.css'))), 'e4b48f0471b6bb8857db1febc26d466619dea5f95e6689c7194fbca68cbca657');
  const f = fixture(t, blocks); engineBuild(f.project); assert(!fs.readFileSync(f.html, 'utf8').includes('.diagram-control-chain'));
});
test('公共构建仅为新variant注入一次专用CSS', t => {
  const f = fixture(t, [sample(), sample(5)]); build(f.project);
  const html = fs.readFileSync(f.html, 'utf8'), css = fs.readFileSync(path.join(__dirname, '../scripts/兼容引擎/控制链图形.css'), 'utf8');
  assert.equal(html.split(css).length, 2, '主构建入口必须按variant追加专用CSS且只追加一次');
});
test('真实浏览器宽屏与中间桌面/390/印刷方向、最大容量、安全文字及PDF', { skip: process.env.RUN_DELIVERY_TESTS !== '1', timeout: 120000 }, async t => {
  const injected = sample(); injected.rows[0][1] = '<img src=x onerror=alert(1)>';
  injected.rows[1][1] = '</style><script>x=1</script>';
  const blocks = [sample(), sample(5), maximum(3), maximum(5), injected];
  const f = fixture(t, blocks); build(f.project);
  const output = process.env.ANQIAN_CONTROL_CHAIN_EVIDENCE || path.join(f.root, 'evidence'); fs.mkdirSync(output, { recursive: true });
  const browser = await get('playwright').chromium.launch({ headless: true });
  const evidence = { layouts: [], requests: [], errors: [] };
  try {
    const page = await browser.newPage();
    await page.route(/^https?:/, route => { evidence.requests.push(route.request().url()); return route.abort(); });
    page.on('pageerror', error => evidence.errors.push(error.message));
    await page.goto(pathToFileURL(f.html).href); await page.waitForFunction(() => window.reportReady === true); await page.evaluate(() => document.fonts.ready);
    for (const width of [1500, 1440, 1366, 1280, 1101, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const result = await inspect(page, width === 390); evidence.layouts.push({ width, ...result });
      assert.deepEqual(result.issues, [], JSON.stringify(result)); assert(result.minFont >= 14);
      await page.locator('#toolbar').evaluate(el => el.style.visibility = 'hidden');
      for (let i = 0; i < blocks.length; i++) await page.locator('.page').nth(i).screenshot({ path: path.join(output, `${width}-${i + 1}.png`) });
      await page.locator('#toolbar').evaluate(el => el.style.visibility = '');
    }
    for (let i = 0; i < blocks.length; i++) {
      const figure = page.locator('.diagram-control-chain').nth(i);
      assert.deepEqual(await figure.locator('dd').allTextContents(), blocks[i].rows.flatMap(row => row.slice(1)));
      assert.deepEqual(await figure.locator('h3').allTextContents(), blocks[i].rows.map(row => row[0]));
      assert.equal(await figure.locator('img,script,style,svg,canvas,table').count(), 0);
    }
    await page.setViewportSize({ width: 1500, height: 1000 }); await page.emulateMedia({ media: 'print' });
    evidence.print = await inspect(page, false); assert.deepEqual(evidence.print.issues, []);
    for (let i = 0; i < blocks.length; i++) await page.locator('.page').nth(i).screenshot({ path: path.join(output, `印刷-${i + 1}.png`) });
    const pdf = path.join(output, '控制链图形.pdf'); await page.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
    const checked = spawnSync(process.env.ANQIAN_PYTHON || 'python3', ['-c',
      'import fitz,json,sys; d=fitz.open(sys.argv[1]); [p.get_pixmap(matrix=fitz.Matrix(1.25,1.25)).save(sys.argv[2]+"/PDF-"+str(i+1)+".png") for i,p in enumerate(d)]; print(json.dumps({"pages":len(d),"texts":[p.get_text() for p in d],"drawings":[len(p.get_drawings()) for p in d],"sizes":[[p.rect.width,p.rect.height] for p in d]},ensure_ascii=False))', pdf, output], { encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr); const parsed = JSON.parse(checked.stdout);
    assert.equal(parsed.pages, blocks.length);
    const normalize = value => value.replace(/\s/g, '');
    blocks.forEach((block, i) => {
      for (const value of [...block.columns, ...block.rows.flat(), ...(block.title ? [block.title] : [])]) assert(normalize(parsed.texts[i]).includes(normalize(value)), `PDF${i + 1}文字缺失：${value}`);
      assert(parsed.drawings[i] > block.rows.length * 6, '节点及方向连接没有保留为矢量');
    });
    assert.deepEqual(evidence.requests, []); assert.deepEqual(evidence.errors, []);
    evidence.pdf = { pages: parsed.pages, sizes: parsed.sizes, drawings: parsed.drawings, textPreserved: true };
    fs.copyFileSync(f.html, path.join(output, '控制链图形.html'));
    fs.writeFileSync(path.join(output, '浏览器回执.json'), JSON.stringify(evidence, null, 2)); t.diagnostic(JSON.stringify(evidence));
  } finally { await browser.close(); }
});
async function inspect(page, mobile) {
  return page.evaluate(mobile => {
    const issues = [], fonts = [], directions = [];
    const rect = el => el.getBoundingClientRect();
    for (const [index, figure] of [...document.querySelectorAll('.diagram-control-chain')].entries()) {
      const box = rect(figure), host = figure.closest('.page');
      if (box.bottom > rect(host.querySelector('.takeaway')).top + 1) issues.push(`图${index}侵入观点区`);
      for (const el of figure.querySelectorAll('*')) {
        // display:contents没有自身盒子，子节点仍逐一验证文字与连线边界。
        if (getComputedStyle(el).display === 'contents') continue;
        const r = rect(el);
        // 主流程连线跨过节点间距；只允许stage的连线越出自身，不能越出整幅图。
        if (r.left < box.left - 1 || r.right > box.right + 1 || (!el.classList.contains('chain-stage') && el.scrollWidth > el.clientWidth + 1)) issues.push(`图${index}横向越界:${el.className}`);
        for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
          fonts.push(parseFloat(getComputedStyle(el).fontSize));
          const range = document.createRange(); range.selectNodeContents(node);
          const cell = rect(el.closest('.chain-node,.chain-fields>div') || figure);
          for (const text of range.getClientRects()) if (text.bottom > cell.bottom + 1 || text.left < cell.left - 1 || text.right > cell.right + 1) issues.push(`图${index}文字越界:${el.className || el.tagName}`);
        }
      }
      const stages = [...figure.querySelectorAll('.chain-stage')];
      stages.forEach((stage, i) => {
        const node = rect(stage.querySelector('.chain-node')), action = rect(stage.querySelector('.chain-action'));
        const result = rect(stage.querySelector('.chain-result')), failure = rect(stage.querySelector('.chain-failure'));
        const branch = rect(stage.querySelector('.chain-failure-link')), style = getComputedStyle(stage.querySelector('.chain-failure-link'));
        for (const cell of stage.querySelectorAll('.chain-node,.chain-fields>div')) {
          const bounds = rect(cell);
          for (const text of cell.querySelectorAll('h3,dt,dd')) if (rect(text).bottom > bounds.bottom + 1) issues.push('文字超出所属节点');
        }
        if (!(node.bottom <= action.top && action.bottom < result.top && result.bottom < failure.top)) issues.push('动作/结果/失败轨道顺序错误');
        if (!(branch.top > action.top && branch.top < action.bottom && branch.bottom > failure.top && branch.bottom < failure.bottom && branch.right >= action.right + 18)) issues.push('失败分支未连接动作与后果');
        if (style.borderRightStyle !== 'dashed') issues.push('失败分支缺少虚线轨道');
        const resultArrow = getComputedStyle(stage.querySelector('.chain-result'), '::after');
        if (parseFloat(resultArrow.borderTopWidth) < 5 || resultArrow.content === 'none') issues.push('动作到结果缺少向下箭头');
        if (i < stages.length - 1) {
          const next = rect(stages[i + 1].querySelector('.chain-node')), link = stage.querySelector('.chain-next');
          const arrow = getComputedStyle(link, '::after'), line = rect(link);
          if (arrow.content === 'none' || parseFloat(arrow.borderLeftWidth) < 8) issues.push('流程缺少向右箭头');
          if (mobile ? !(next.top > failure.bottom && Math.abs(next.left - node.left) < 1 && line.bottom > next.top && line.bottom < next.bottom) : !(next.left > node.right && Math.abs(next.top - node.top) < 1 && Math.abs(line.right - next.left) < 1)) issues.push('主流程顺序或连接方向错误');
        }
      });
      directions.push(getComputedStyle(figure.querySelector('.chain-stages')).flexDirection);
      if (directions.at(-1) !== (mobile ? 'column' : 'row')) issues.push('流程重排失败');
      if (rect(host.querySelector('footer')).bottom > rect(host).bottom + 1) issues.push('页脚越界');
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) issues.push('页面横向溢出');
    return { issues, minFont: Math.min(...fonts), directions };
  }, mobile);
}
