'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { validateStructuredDiagram: validate, renderStructuredDiagram: render } = require('../scripts/兼容引擎/矩阵算式.cjs');
const { get } = require('../scripts/兼容引擎/运行依赖.cjs');
const engine = path.join(__dirname, '../scripts/兼容引擎');
const fill = (seed, length) => Array.from(seed.repeat(length)).slice(0, length).join('');
const kinds = ['observed', 'proposed', 'unknown'];
const meanings = ['现有证据已有记录', '待验证适配', '尚缺直接证据'];
function matrix(columns = 6, rows = 5) {
  return { type: 'diagram', variant: 'categorical-matrix', title: fill('矩阵只描述材料与待核条件不代表业务已经成立', 48),
    columns: Array.from({ length: columns }, (_, i) => '维度' + (i + 1) + fill('材料边界', 5)),
    rows: Array.from({ length: rows }, (_, i) => ({ label: '对象' + (i + 1) + fill('适用场景及限制', 17),
      detail: fill('技术样本保留本地资料的具体表达，未记载不代表不存在；适配仅为待验证建议，仍须核实样本口径、实际渠道、时间范围与执行条件。', 85),
      cells: Array.from({ length: columns }, (_, j) => kinds[(i + j) % 3]) })), legend: 'observed' };
}
function equation(operator) {
  return { type: 'diagram', variant: 'equation-flow', title: fill('算式展示输入及推导关系未知结果不能编造数据', 48),
    rows: Array.from({ length: 3 }, (_, i) => ({ label: '算式' + (i + 1) + fill('输入与限制条件', 17),
      lhs: fill('待补充同口径有效输入', 22), operator: operator || (i % 2 ? 'multiply' : 'divide'),
      rhs: fill('待核验适用分母或乘数', 22), result: fill('未知量待核实不能替代为推测数字', 26),
      note: fill('技术样本不构成事实核查或计算结果；输入与分母须同期间、同范围，未取得实际参数时只能保留文字表达。此处不以假坐标、面积或占比替代未知量。', 100) })),
    footer: fill('所有算式仅用于说明推导关系，未核实的参数和结果均以原文保留。业务结论仍需回到原始材料与生产数据核查，不因图形完成而宣称语义或事实已经通过。', 140) };
}
for (let columns = 3; columns <= 6; columns++) for (let rows = 3; rows <= 5; rows++) {
  test(`矩阵${rows}行${columns}列最大文字容量与交点`, () => {
    const b = matrix(columns, rows), html = render(b);
    assert.equal(validate(b), b);
    assert.equal((html.match(/class="ms-cell"/g) || []).length, rows * columns);
    assert.equal((html.match(/class="ms-detail"/g) || []).length, rows);
    for (const text of [b.title, ...b.columns, ...b.rows.flatMap(r => [r.label, r.detail]), ...meanings]) assert(html.includes(text));
    assert(!/<(?:table|svg|canvas|img|script|style)\b/.test(html));
  });
}
for (const operator of ['divide', 'multiply', undefined]) test(`算式原文与${operator || '混合'}结构`, () => {
  const b = equation(operator), html = render(b);
  assert.equal(validate(b), b);
  assert.equal((html.match(/class="ms-equation-row"/g) || []).length, 3);
  assert.equal((html.match(/class="ms-fraction"/g) || []).length, b.rows.filter(r => r.operator === 'divide').length);
  assert.equal((html.match(/class="ms-times"/g) || []).length, b.rows.filter(r => r.operator === 'multiply').length);
  for (const text of [b.title, b.footer, ...b.rows.flatMap(r => [r.label, r.lhs, r.rhs, r.result, r.note])]) assert(html.includes(text));
  assert(!/<(?:table|svg|canvas|img|script|style)\b/.test(html));
});
test('两种图形全部文字字段与无障碍描述均转义，未知值不计算', () => {
  const value = `<>&"'`;
  for (const b of [matrix(), equation()]) {
    b.title = value;
    for (const row of b.rows) for (const key of Object.keys(row)) if (!['cells', 'operator'].includes(key)) row[key] = value;
    if (b.columns) b.columns = [value, '乙', '丙'], b.rows.forEach(r => r.cells = kinds.slice());
    else b.footer = value;
    const html = render(b);
    assert(html.includes('&lt;&gt;&amp;&quot;&#39;')); assert(!html.includes(value));
    assert(!/<(?:img|script|style)\b/.test(html));
  }
  const b = equation(); b.rows[0].lhs = '分子未知'; b.rows[0].rhs = '分母未知'; b.rows[0].result = '暂不能计算';
  assert(render(b).includes('暂不能计算'));
});
const invalid = [
  ['错误type', b => b.type = 'chart'], ['未知variant', b => b.variant = 'scatter'],
  ['标题49字', b => b.title = '题'.repeat(49)], ['缺标题', b => delete b.title],
  ['少于三行', b => b.rows.length = 2], ['超行数', b => b.rows = Array(6).fill(b.rows[0])],
  ['行标签21字', b => b.rows[0].label = '行'.repeat(21)], ['行标签空白', b => b.rows[0].label = ' '],
  ['字段数值', b => b.rows[0].label = 42], ['换行', b => b.rows[0].label = '上\n下'],
  ['控制字符', b => b.title = '标题\u0000'], ['行分隔符', b => b.title = '标题\u2028换行'],
  ['行稀疏数组', b => delete b.rows[0]], ['数组额外字段', b => b.rows.extra = 1],
  ['数组符号', b => b.rows[Symbol('extra')] = 1], ['行额外字段', b => b.rows[0].html = 'x'],
  ['非普通对象', b => Object.setPrototypeOf(b, { injected: true })],
  ['非普通行', b => Object.setPrototypeOf(b.rows[0], { injected: true })],
  ['数组子类', b => Object.setPrototypeOf(b.rows, Object.create(Array.prototype))],
  ...['html', 'style', 'css', 'script', 'className', '__proto__'].map(key =>
    [key, b => Object.defineProperty(b, key, { value: 'x' })]),
  ['对象符号', b => b[Symbol('extra')] = 1]
];
const matrixInvalid = [
  ['两列', b => b.columns.length = 2], ['七列', b => b.columns.push('第七')],
  ['列名九字', b => b.columns[0] = '列'.repeat(9)], ['重复列名', b => b.columns[1] = b.columns[0]],
  ['说明86字', b => b.rows[0].detail = '文'.repeat(86)], ['缺说明', b => delete b.rows[0].detail],
  ['非法legend', b => b.legend = 'unknown'], ['缺legend', b => delete b.legend],
  ['缺交点', b => b.rows[0].cells.pop()], ['额外交点', b => b.rows[0].cells.push('observed')],
  ['数字交点', b => b.rows[0].cells[0] = 1], ['未知交点', b => b.rows[0].cells[0] = 'constructor'],
  ['稀疏列', b => delete b.columns[0]], ['稀疏交点', b => delete b.rows[0].cells[0]],
  ['交点额外字段', b => b.rows[0].cells.extra = 'x'], ['列数组符号', b => b.columns[Symbol('x')] = 'x']
];
const equationInvalid = [
  ['四行', b => b.rows.push({ ...b.rows[0] })], ['非法运算符', b => b.rows[0].operator = 'plus'],
  ...[['lhs', 23], ['rhs', 23], ['result', 27], ['note', 101]].map(([key, n]) => [key + '超长', b => b.rows[0][key] = '字'.repeat(n)]),
  ['footer超长', b => b.footer = '文'.repeat(141)], ['缺footer', b => delete b.footer],
  ['缺result', b => delete b.rows[0].result], ['数值结果', b => b.rows[0].result = 12],
  ['伪坐标字段', b => b.rows[0].x = 40]
];
for (const [name, factory, specific] of [['矩阵', matrix, matrixInvalid], ['算式', equation, equationInvalid]]) {
  for (const [label, mutate] of [...invalid, ...specific]) test(name + '拒绝' + label, () => {
    const b = factory(); mutate(b);
    assert.throws(() => validate(b), /structured-diagram/);
    assert.throws(() => render(b), /structured-diagram/);
  });
  test(name + '所有层级访问器均拒绝且不执行', () => {
    const keys = b => [[b, 'variant'], [b, 'type'], [b, 'rows'], [b.rows, '0'], [b.rows[0], 'label'],
      ...(b.columns ? [[b, 'legend'], [b.columns, '0'], [b.rows[0], 'cells'], [b.rows[0].cells, '0'], [b.rows[0], 'detail']]
        : [[b, 'footer'], ...['operator', 'lhs', 'rhs', 'result', 'note'].map(key => [b.rows[0], key])])];
    for (let i = 0; i < keys(factory()).length; i++) for (const mode of ['get', 'set', 'empty']) {
      const b = factory(); let calls = 0; const [target, key] = keys(b)[i];
      Object.defineProperty(target, key, mode === 'empty' ? { get: undefined } : { [mode]() { calls++; return 'x'; } });
      assert.throws(() => render(b), /structured-diagram/); assert.equal(calls, 0);
    }
  });
  test(name + '接受冻结及无原型对象，不修改源数据', () => {
    const b = factory(), snapshot = JSON.stringify(b);
    Object.setPrototypeOf(b, null); b.rows.forEach(row => Object.freeze(Object.setPrototypeOf(row, null)));
    Object.freeze(b.rows); Object.freeze(b);
    assert.doesNotThrow(() => render(b)); assert.equal(JSON.stringify(b), snapshot);
  });
}
test('非法根值和CSS作用域', () => {
  for (const value of [null, undefined, false, 1, 'x', [], () => {}]) assert.throws(() => validate(value), /structured-diagram/);
  const css = fs.readFileSync(path.join(engine, '矩阵算式.css'), 'utf8');
  for (const selector of css.matchAll(/([^{}]+)\{/g)) {
    const head = selector[1].trim(); if (head.startsWith('@')) continue;
    for (const part of head.split(',')) assert.match(part, /\.ms-(?:diagram|matrix|equation)\b/, part);
  }
  assert(!/text-overflow|line-clamp|overflow\s*:\s*hidden|zoom\s*:/.test(css));
});
function documentHtml(blocks) {
  const base = fs.readFileSync(path.join(__dirname, '../assets/兼容模板/报告样式.css'), 'utf8');
  const common = fs.readFileSync(path.join(engine, '可重排图形.css'), 'utf8');
  const css = fs.readFileSync(path.join(engine, '矩阵算式.css'), 'utf8');
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<style>${base}\n${common}\n.body.single{grid-template-columns:minmax(0,1fr)}\n${css}</style><body><main id="report">` +
    blocks.map((b, i) => `<section class="page diagram-page"><div class="mast"><span>技术样本</span><span>图形容量验证</span></div>` +
      `<header><div class="eyebrow">样本 ${i + 1}</div><h1>保留输入、图形关系与完整限制说明</h1><p>仅验证结构和呈现，不代表业务事实或研究结论。</p></header>` +
      `<div class="body single diagram-body">${render(b)}</div><div class="takeaway"><b>验收范围</b><span>生产数据和整份报告需由主 Agent 另行接入验证。</span></div>` +
      `<footer><div>技术样本，不是市场数据。</div><b>${i + 1} / ${blocks.length}</b></footer></section>`).join('') + '</main></body></html>';
}
test('真实浏览器1500/1280/1101/390、印刷与PDF完整原文', { skip: process.env.RUN_DELIVERY_TESTS !== '1', timeout: 120000 }, async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-equation-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = process.env.ANQIAN_STRUCTURED_EVIDENCE || path.join(root, 'evidence');
  fs.mkdirSync(output, { recursive: true });
  const blocks = [matrix(3, 3), matrix(4, 4), matrix(5, 5), matrix(6, 5), equation('divide'), equation('multiply'), equation()];
  blocks[1].legend = 'proposed';
  const attack = equation(); attack.rows[0].note = '<img src=x onerror=alert(1)>'; attack.footer = '</style><script>window.attacked=1</script>';
  blocks.push(attack);
  const file = path.join(root, '矩阵算式.html'); fs.writeFileSync(file, documentHtml(blocks));
  const browser = await get('playwright').chromium.launch({ headless: true });
  const evidence = { layouts: [], requests: [], errors: [] };
  try {
    const page = await browser.newPage();
    await page.route(/^https?:/, route => { evidence.requests.push(route.request().url()); return route.abort(); });
    page.on('pageerror', error => evidence.errors.push(error.message));
    await page.goto(pathToFileURL(file).href); await page.evaluate(() => document.fonts.ready);
    for (const width of [1500, 1280, 1101, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const result = await inspect(page, blocks, width === 390); evidence.layouts.push({ width, ...result });
      assert.deepEqual(result.issues, [], JSON.stringify(result)); assert(result.minFont >= 14);
      if (width === 1500) assert(result.heights.every(height => height <= 450), JSON.stringify(result.heights));
      for (let i = 0; i < blocks.length; i++) await page.locator('.page').nth(i).screenshot({ path: path.join(output, `${width}-${i + 1}.png`) });
    }
    await page.setViewportSize({ width: 1500, height: 1000 }); await page.emulateMedia({ media: 'print' });
    evidence.print = await inspect(page, blocks, false); assert.deepEqual(evidence.print.issues, []);
    assert(evidence.print.heights.every(height => height <= 450), JSON.stringify(evidence.print.heights));
    const pdf = path.join(output, '矩阵算式.pdf'); await page.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
    const result = spawnSync(process.env.ANQIAN_PYTHON || 'python3', ['-c',
      'import fitz,json,sys; d=fitz.open(sys.argv[1]); [p.get_pixmap().save(sys.argv[2]+"/PDF-"+str(i+1)+".png") for i,p in enumerate(d)]; print(json.dumps({"pages":len(d),"texts":[p.get_text() for p in d],"drawings":[len(p.get_drawings()) for p in d],"sizes":[[p.rect.width,p.rect.height] for p in d]}))',
      pdf, output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.pages, blocks.length);
    const clean = text => text.replace(/\s/g, '');
    blocks.forEach((b, i) => {
      const texts = b.columns ? [...b.columns, ...meanings, ...b.rows.flatMap(r => [r.label, r.detail])]
        : [b.footer, ...b.rows.flatMap(r => [r.label, r.lhs, r.rhs, r.result, r.note])];
      for (const text of [b.title, ...texts]) assert(clean(parsed.texts[i]).includes(clean(text)), `PDF${i + 1}缺原文：${text}`);
      assert(parsed.drawings[i] >= (b.columns ? b.columns.length * b.rows.length : 3), '缺矢量符号或公式线');
      // Chromium PDF page dimensions may round to a fractional point.
      assert(parsed.sizes[i].every((size, axis) => Math.abs(size - [1080, 607.5][axis]) <= 0.5),
        `PDF${i + 1}页面尺寸偏差超过0.5pt：${JSON.stringify(parsed.sizes[i])}`);
    });
    assert.deepEqual(evidence.requests, []); assert.deepEqual(evidence.errors, []);
    assert.equal(await page.evaluate(() => window.attacked), undefined);
    evidence.pdf = { pages: parsed.pages, sizes: parsed.sizes, drawings: parsed.drawings, textPreserved: true };
    fs.copyFileSync(file, path.join(output, '矩阵算式.html'));
    fs.writeFileSync(path.join(output, '浏览器回执.json'), JSON.stringify(evidence, null, 2)); t.diagnostic(JSON.stringify(evidence));
  } finally { await browser.close(); }
});
async function inspect(page, blocks, mobile) {
  return page.evaluate(({ blocks, mobile }) => {
    const issues = [], fonts = [], heights = [], rect = el => el.getBoundingClientRect();
    for (const [i, fig] of [...document.querySelectorAll('.ms-diagram')].entries()) {
      const box = rect(fig), b = blocks[i], host = fig.closest('.page'); heights.push(box.height);
      if (box.bottom > rect(host.querySelector('.takeaway')).top + 1) issues.push(`图${i}侵入结论区`);
      if (rect(host.querySelector('footer')).bottom > rect(host).bottom + 1) issues.push(`图${i}页脚越界`);
      for (const el of fig.querySelectorAll('*')) {
        if (!el.getClientRects().length) continue;
        const r = rect(el);
        if (r.left < box.left - 1 || r.right > box.right + 1 || el.scrollWidth > el.clientWidth + 1) issues.push(`图${i}横向溢出:${el.className}`);
        for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE && n.textContent.trim()) {
          fonts.push(parseFloat(getComputedStyle(el).fontSize)); const range = document.createRange(); range.selectNodeContents(n);
          for (const text of range.getClientRects()) if (text.left < r.left - 1 || text.right > r.right + 1 || text.bottom > r.bottom + 1) issues.push(`图${i}文字越界:${el.className}`);
        }
      }
      const rows = [...fig.querySelectorAll('.ms-matrix-row,.ms-equation-row')];
      rows.forEach((row, j) => {
        if (j && rect(rows[j - 1]).bottom > rect(row).top + 1) issues.push('行间重叠');
        if (row.querySelector('.ms-row-label').textContent !== b.rows[j].label) issues.push('行标签丢失');
        if (row.querySelector('.ms-detail,.ms-note').textContent !== (b.rows[j].detail || b.rows[j].note)) issues.push('限制原文丢失');
        if (b.columns) {
          const heads = [...fig.querySelectorAll('.ms-column')];
          [...row.querySelectorAll('.ms-cell')].forEach((cell, k) => {
            const mark = cell.querySelector('.ms-mark'), name = cell.querySelector('.ms-mobile-column'), mr = rect(mark);
            if (!mark.classList.contains('ms-mark-' + b.rows[j].cells[k]) || mr.width < 10) issues.push('交点符号错误或不可见');
            if (mobile ? name.textContent !== b.columns[k] || !name.getClientRects().length
              : Math.abs((rect(heads[k]).left + rect(heads[k]).right - mr.left - mr.right) / 2) > 1) issues.push('交点维度丢失或错位');
            const style = getComputedStyle(mark), kind = b.rows[j].cells[k];
            if (kind === 'observed' && parseFloat(style.borderRadius) === 0) issues.push('实点形状错误');
            if (kind === 'proposed' && (style.transform === 'none' || parseFloat(style.borderTopWidth) !== 2)) issues.push('空心菱形错误');
            if (kind === 'unknown' && (parseFloat(style.borderTopWidth) !== 1 || mr.height > 2)) issues.push('未知量不是细横线');
          });
        } else {
          for (const key of ['lhs', 'rhs', 'result']) if (row.querySelector('.ms-' + key).textContent !== b.rows[j][key]) issues.push('算式原文丢失');
          const lhs = row.querySelector('.ms-lhs'), rhs = row.querySelector('.ms-rhs'), result = row.querySelector('.ms-result');
          if (b.rows[j].operator === 'divide') {
            if (parseFloat(getComputedStyle(lhs).borderBottomWidth) !== 2 || rect(lhs).bottom > rect(rhs).top) issues.push('分数线或分子分母顺序错误');
          } else if (row.querySelector('.ms-times').textContent !== '×' || (mobile ? rect(result).top < rect(rhs).bottom : rect(lhs).right > rect(rhs).left)) issues.push('乘法重排错误');
          if (row.querySelector('.ms-equals').textContent !== '=') issues.push('缺等号');
        }
      });
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) issues.push('页面横向溢出');
    return { issues, heights, minFont: Math.min(...fonts) };
  }, { blocks, mobile });
}
