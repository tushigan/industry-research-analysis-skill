'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const engine = path.resolve(__dirname, '../scripts/兼容引擎');
const {build} = require(path.join(engine, '构建报告.cjs'));
const {run} = require(path.join(engine, '验收报告.cjs'));
const {makeFixture} = require(path.join(engine, '测试样本.cjs'));
const {assertFresh} = require(path.join(engine, '输入指纹.cjs'));
const {get} = require(path.join(engine, '运行依赖.cjs'));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (root, config) => fs.writeFileSync(path.join(root, '报告.json'), JSON.stringify(config, null, 2));
const escaped = '</script><script>window.injected=true</script><img src=x onerror="window.injected=true"> & \\" $& $` $\'';
function temporary(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anqian-compat-')));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  return root;
}
function fixture(t) {
  const root = temporary(t), config = makeFixture(root);
  return {root, config};
}
function expand(config) {
  const grid = {left:45, right:40, top:35, bottom:40};
  const axis = {grid, xAxis:{type:'category', data:['甲', '乙']}, yAxis:{type:'value'}};
  const options = [
    ['stack', {...axis, series:[{type:'bar', stack:'合计', data:[12, 18]}, {type:'bar', stack:'合计', data:[8, 9]}]}],
    ['horizontal', {grid, xAxis:{type:'value'}, yAxis:{type:'category', data:['甲', '乙']}, series:[{type:'bar', data:[20, 30]}]}],
    ['pie', {tooltip:{trigger:'item'}, series:[{type:'pie', radius:['25%', '65%'], data:[{name:'甲', value:40}, {name:'乙', value:60}]}]}],
    ['dual', {...axis, yAxis:[{type:'value', name:'数量'}, {type:'value', name:'比例'}], series:[{type:'bar', data:[20, 30]}, {type:'line', yAxisIndex:1, data:[10, 15]}]}],
    ['scatter', {grid, xAxis:{type:'value'}, yAxis:{type:'value'}, series:[{type:'scatter', symbolSize:16, data:[[1, 3], [4, 5], [6, 2]]}]}]
  ];
  for (const [id, option] of options) config.charts.push({id, option, unit:'合成单位', period:'测试阶段', scope:'技术样本', sourceIds:['test-source']});
  const base = config.pages[0];
  const block = id => ({type:'chart', chartId:id, title:'原始图表 ' + id});
  config.pages.push({...base, id:'p4', title:'堆叠、横向柱图与饼图', layout:'three', blocks:['stack', 'horizontal', 'pie'].map(block)});
  config.pages.push({...base, id:'p5', title:'柱线双轴与散点完整保留', layout:'two-equal', blocks:['dual', 'scatter'].map(block)});
  config.pages.push({...base, id:'p6', title:'原始文字与列表', layout:'single', blocks:[{type:'list', title:'原始列表', items:['完整保留', '不转表、不删图']}]});
  return config;
}
async function attachment(root, config) {
  const {PDFDocument, StandardFonts, rgb} = get('pdf-lib');
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= 3; index++) {
    const page = pdf.addPage([595, 842]);
    page.drawText('Synthetic reference / page ' + index, {x:50, y:750, size:24, font});
    page.drawRectangle({x:50, y:500, width:100 + index * 80, height:80, color:rgb(.08, .52, .39)});
  }
  fs.writeFileSync(path.join(root, '自制测试资料.pdf'), await pdf.save());
  config.attachments = [{id:'test-pdf', sourceKey:'test-source', title:'自制技术测试PDF', file:'自制测试资料.pdf', pages:3, citedPage:2,
    formatLabel:'自制测试摘要', description:'非市场资料', shareApproved:true, shareBasis:'测试脚本生成，无第三方内容'}];
  config.pages[0].citations = [{sourceId:'test-source', page:2}];
  write(root, config);
}
test('旧样本完整构建，原始配置、备注、布局和旧清单字段保留', t => {
  const {root, config} = fixture(t); expand(config); write(root, config);
  const manifest = build(root), html = fs.readFileSync(path.join(root, '交付/案前洞察.html'), 'utf8');
  assert.deepEqual(read(path.join(root, '交付/研究数据.json')), config);
  assert.deepEqual(Object.keys(manifest), ['title', 'id', 'date', 'pages', 'charts', 'presenter', 'documents', 'inputSha256', 'htmlSha256', 'bytes']);
  assert.equal(manifest.pages, 6); assert.equal(manifest.charts, 7);
  assert(!/<script src=|<link rel="stylesheet"/.test(html));
  for (const layout of ['single', 'two-one', 'two-equal', 'three']) assert(html.includes('body ' + layout));
  for (const page of config.pages) {
    assert(html.includes(page.title)); assert(html.includes(page.subtitle)); assert(html.includes(page.takeaway));
    assert(fs.readFileSync(path.join(root, '交付/逐页讲解备注.md'), 'utf8').includes(page.notes));
  }
  const runtime = html.match(/<script>(window.REPORT_CONFIG=[\s\S]*?)<\/script>/)[1];
  const context = {window:{}}; vm.runInNewContext(runtime, context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.REPORT_DATA.charts)), config.charts.map(({id, option}) => ({id:'chart-' + id, option})));
});
test('真实HTML与script字符串转义，不吞正文、备注及配置中的特殊字符', t => {
  const {root, config} = fixture(t);
  config.title = config.pages[0].title = config.pages[0].subtitle = config.pages[0].notes = escaped;
  config.pages[0].blocks[1].text = escaped; config.charts[0].option.xAxis.data[0] = escaped; write(root, config); build(root);
  const html = fs.readFileSync(path.join(root, '交付/案前洞察.html'), 'utf8');
  assert(!html.includes(escaped)); assert(html.includes('&lt;/script&gt;')); assert(html.includes('\\u003c/script>'));
  const context = {window:{}};
  vm.runInNewContext(html.match(/<script>(window.REPORT_CONFIG=[\s\S]*?)<\/script>/)[1], context);
  assert.equal(context.window.REPORT_CONFIG.title, escaped); assert.equal(context.window.PAGE_NOTES[0], escaped);
  assert.equal(context.window.REPORT_DATA.charts[0].option.xAxis.data[0], escaped); assert.equal(context.window.injected, undefined);
});
for (const [name, mutate, expected] of [
  ['重复页面编号', c => c.pages[1].id = c.pages[0].id, /页面编号/],
  ['缺少备注', c => c.pages[0].notes = '', /备注/],
  ['引用不存在', c => c.pages[0].sourceIds = ['lost'], /来源/],
  ['缺少口径', c => c.charts[0].scope = '', /口径/],
  ['未授权附件', c => c.attachments = [{id:'f1', shareApproved:false}], /分享/],
  ['图片路径逃逸', c => c.pages[2].blocks[0].file = '../secret.png', /项目目录/],
  ['脚本来源链接', c => c.sources[0].url = 'javascript:alert(1)', /来源链接/],
  ['无效日期', c => c.date = '2026-99-99', /日期/],
  ['图表空数据', c => c.charts[0].option.series[0].data = [], /图表数据/],
  ['图表缺失', c => c.pages[0].blocks[0].chartId = 'missing', /图表/],
  ['图表重复使用', c => c.pages[1].blocks[0].chartId = c.charts[0].id, /图表/],
  ['未知内容块', c => c.pages[0].blocks[1].type = 'html', /未知内容块/],
  ['表格行列不符', c => c.pages[2].blocks[1].rows[0].pop(), /行列/]
]) test('构建拒绝：' + name, t => {
  const {root, config} = fixture(t); mutate(config); write(root, config);
  assert.throws(() => build(root), expected); assert(!fs.existsSync(path.join(root, '交付')));
});
test('拒绝软链接输入及输出，不覆盖项目外文件', t => {
  const parent = temporary(t), root = path.join(parent, 'project'), config = makeFixture(root);
  const outside = path.join(parent, 'outside.png'); fs.writeFileSync(outside, 'protected');
  fs.symlinkSync(outside, path.join(root, 'linked.png')); config.pages[2].blocks[0].file = 'linked.png'; write(root, config);
  assert.throws(() => build(root), /项目目录/);
  config.pages[2].blocks[0].file = '测试像素.png'; write(root, config);
  fs.symlinkSync(parent, path.join(root, '交付')); assert.throws(() => build(root), /软链接/);
  fs.unlinkSync(path.join(root, '交付')); build(root);
  fs.unlinkSync(path.join(root, '交付/案前洞察.html')); fs.symlinkSync(outside, path.join(root, '交付/案前洞察.html'));
  assert.throws(() => build(root, true), /软链接/); assert.equal(fs.readFileSync(outside, 'utf8'), 'protected');
});
test('默认不覆盖；显式覆盖有效；输入与图片变化使指纹失效', t => {
  const {root, config} = fixture(t), manifest = build(root);
  assert.throws(() => build(root), /已存在/); assert.deepEqual(build(root, true), manifest);
  assert.doesNotThrow(() => assertFresh(root, config, manifest));
  config.pages[0].notes += '修改'; write(root, config); assert.throws(() => assertFresh(root, config, manifest), /重新构建/);
  const fresh = build(root, true); fs.appendFileSync(path.join(root, '测试像素.png'), 'changed');
  assert.throws(() => assertFresh(root, config, fresh), /重新构建/);
});
test('单页无图与关闭讲者；图表DOM编号不与工具冲突；样本拒绝非空目录', t => {
  const {root, config} = fixture(t); config.charts[0].id = 'p1'; config.pages[0].blocks[0].chartId = 'p1'; write(root, config); build(root);
  const html = fs.readFileSync(path.join(root, '交付/案前洞察.html'), 'utf8'); assert.equal((html.match(/ id="p1"/g) || []).length, 1);
  assert(html.includes('id="chart-p1"')); assert.throws(() => makeFixture(root), /空目录/);
  config.presenter = false; config.charts = []; config.pages = [config.pages[2]]; write(root, config);
  const result = build(root, true); assert.equal(result.pages, 1); assert.equal(result.charts, 0); assert.equal(result.presenter, false);
});
test('浏览器启动前检测HTML和输入变化，写失败回执到自定义目录', async t => {
  const {root, config} = fixture(t); build(root);
  const delivery = path.join(root, '单独交付'); fs.renameSync(path.join(root, '交付'), delivery);
  const output = path.join(root, '单独验收'); fs.appendFileSync(path.join(delivery, '案前洞察.html'), 'tamper');
  await assert.rejects(run(root, false, {delivery, output}), /HTML校验值/);
  assert.equal(read(path.join(output, '验收结果.json')).status, 'failed');
  build(root); config.pages[0].notes += ' changed'; write(root, config);
  await assert.rejects(run(root), /重新构建/); assert.equal(read(path.join(root, '验收/验收结果.json')).status, 'failed');
});
test('复制后的独立新包全图形、混排、附件、讲者、跨目录PDF真实验收', {
  skip:process.env.RUN_DELIVERY_TESTS !== '1', timeout:240000
}, async t => {
  const parent = temporary(t), project = path.join(parent, 'project'), config = expand(makeFixture(project));
  await attachment(project, config);
  const isolated = path.join(parent, '独立包'), isolatedEngine = path.join(isolated, 'scripts/兼容引擎');
  fs.cpSync(engine, isolatedEngine, {recursive:true});
  for (const directory of ['兼容模板', '依赖']) fs.cpSync(path.resolve(engine, '../../assets', directory), path.join(isolated, 'assets', directory), {recursive:true});
  const built = spawnSync(process.execPath, ['-e', `const assert=require('node:assert/strict');const path=require('node:path');
    const result=require(process.argv[1]).build(process.argv[2]);
    assert(Object.keys(require.cache).every(file=>file.startsWith(process.argv[3]+path.sep)));
    console.log(JSON.stringify(result));`, path.join(isolatedEngine, '构建报告.cjs'), project, isolated], {encoding:'utf8'});
  assert.equal(built.status, 0, built.stderr); assert.equal(JSON.parse(built.stdout).charts, 7);
  const delivery = path.join(parent, '外部交付'), output = path.join(parent, '外部验收');
  fs.renameSync(path.join(project, '交付'), delivery);
  const result = await require(path.join(isolatedEngine, '验收报告.cjs')).run(project, false, {delivery, output});
  assert.equal(result.status, 'passed'); assert.equal(result.pages, 6); assert.equal(result.externalRequests, 0);
  assert.deepEqual(result.errors, []); assert.deepEqual(result.consoleErrors, []);
  assert(result.images.every(image => image.loaded)); assert(result.presenter.bidirectional && result.presenter.persisted && result.presenter.reset);
  assert.equal(result.documents.length, 1); assert(result.documents[0].zoom && result.documents[0].navigation);
  for (const width of [1500, 1280, 390, 768]) assert.equal(result.layouts[width].charts.filter(chart => chart.ok).length, 7);
  assert.equal(result.printCharts.length, 7); assert.equal(path.resolve(project, result.pdf.file), path.join(delivery, '案前洞察.pdf'));
  const pdfArgs = [path.join(isolatedEngine, '检查PDF.py'), project, '--delivery', delivery, '--checks', output];
  const checkPDF = () => spawnSync(process.env.ANQIAN_PYTHON || 'python3', pdfArgs, {encoding:'utf8', maxBuffer:16 * 1024 * 1024});
  const pdf = checkPDF(); assert.equal(pdf.status, 0, pdf.stderr); assert.equal(JSON.parse(pdf.stdout).pages, 6);
  assert(JSON.parse(pdf.stdout).checks.filter(page => page.vector_paths > 10).length >= 4);
  await assert.rejects(require(path.join(isolatedEngine, '验收报告.cjs')).run(project, false, {delivery, output}), /PDF已存在/);
  t.diagnostic(JSON.stringify({standalone:true, pages:result.pages, charts:result.printCharts.length, layouts:Object.keys(result.layouts), presenter:result.presenter, documents:result.documents, pdf:JSON.parse(pdf.stdout)}));
  fs.appendFileSync(path.join(delivery, '案前洞察.pdf'), 'tamper'); assert.notEqual(checkPDF().status, 0);
});
test('默认目录、禁用讲者、真实字符串安全与坏图片失败路径', {
  skip:process.env.RUN_DELIVERY_TESTS !== '1', timeout:120000
}, async t => {
  const {root, config} = fixture(t); config.presenter = false; config.charts = []; config.pages = [config.pages[2]];
  config.pages[0].notes = escaped; config.pages[0].blocks[0].alt = escaped; write(root, config); build(root);
  const result = await run(root); assert.equal(result.status, 'passed'); assert.equal(result.presenter.parameterIgnored, true);
  const checked = spawnSync(process.env.ANQIAN_PYTHON || 'python3', [path.join(engine, '检查PDF.py'), root], {encoding:'utf8'});
  assert.equal(checked.status, 0, checked.stderr);
  const {chromium} = get('playwright'), browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage(); await page.goto(pathToFileURL(path.join(root, '交付/案前洞察.html')).href);
    assert.equal(await page.locator('img').getAttribute('alt'), escaped); assert.equal(await page.evaluate(() => window.injected), undefined);
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(root, '测试像素.png'), 'broken'); build(root, true);
  await assert.rejects(run(root, true), /存在未加载图片/); assert.equal(read(path.join(root, '验收/验收结果.json')).status, 'failed');
});
