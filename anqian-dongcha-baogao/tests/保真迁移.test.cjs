'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { migrateFile, migrateLegacy, sha256 } = require('../scripts/迁移研究数据.cjs');
const { runRegression } = require('../scripts/回归历史样本.cjs');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6cVQAAAAASUVORK5CYII=', 'base64');
function pdfBytes() {
  const content = '0.2 0.4 0.8 rg\n20 20 160 160 re f\n';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`];
  let value = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(value)); value += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(value);
  value += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  return Buffer.from(`${value}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}
function sample() {
  const options = [
    { xAxis: { data: ['甲', '乙'] }, series: [{ type: 'bar', stack: '总计', data: [1, 2] }, { type: 'bar', stack: '总计', data: [3, 4] }] },
    { yAxis: [{ type: 'value' }, { type: 'value' }], series: [{ type: 'bar', data: [1, 2] }, { type: 'line', yAxisIndex: 1, data: [3, 4] }] },
    { xAxis: { type: 'value' }, yAxis: { type: 'category', data: ['甲', '乙'] }, series: [{ type: 'bar', data: [1, 2] }] },
    { xAxis: {}, yAxis: {}, series: [{ type: 'scatter', data: [[1, 2], [3, 4]] }] },
    { series: [{ type: 'pie', data: [{ name: '甲', value: 2 }, { name: '乙', value: 3 }] }] },
    { xAxis: { data: ['甲', '乙'] }, series: [{ type: 'line', data: [5, 6] }] }
  ];
  return { id: 'preservation-sample', title: '匿名历史报告', publisher: '匿名研究组', presenter: true, date: '2020-02-03',
    sources: [{ id: 'source-a', title: '匿名公开历史资料', publisher: '匿名机构', url: 'https://example.com/history',
      publishedAt: '2020-01-01', accessedAt: '2020-02-03', period: '2019年', scope: '仅为测试' }],
    charts: options.map((option, index) => ({ id: `chart-${index}`, sourceIds: ['source-a'], unit: '数量', period: '2019年', scope: '仅为测试', option })),
    pages: [{ id: 'page-a', title: '完整原文标题', subtitle: '副标题不能消失', section: '历史研究', layout: 'three',
      takeaway: '历史判断未复核', notes: '逐页备注全文\n第二行', sourceNote: '原限制全文', sourceIds: ['source-a'],
      blocks: [...options.map((_, index) => ({ type: 'chart', chartId: `chart-${index}`, title: `图标题${index}` })),
        { type: 'text', title: '正文块标题', text: '原文全文\n第二段也保留' }, { type: 'list', title: '列表标题', items: ['一', '二'] },
        { type: 'table', title: '表标题', headers: ['原字段', '原值'], rows: [['项目', '2,468+']] },
        { type: 'image', title: '图片标题', file: '资产/封面.png', alt: '封面描述', caption: '自制图片' }] }],
    attachments: [{ id: 'attachment-a', sourceKey: 'source-a', file: '资产/资料.pdf', title: '获准资料全文',
      shareApproved: true, shareBasis: '测试自制资料，允许分享', pages: 1, citedPage: 1, formatLabel: 'PDF' }] };
}
function workspace(t, report = sample()) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'preserve-migration-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const original = path.join(root, 'original'), input = path.join(original, 'plain-file'), out = path.join(root, 'result');
  fs.mkdirSync(path.join(original, '资产'), { recursive: true });
  fs.writeFileSync(path.join(original, '资产/封面.png'), png);
  fs.writeFileSync(path.join(original, '资产/资料.pdf'), pdfBytes());
  fs.writeFileSync(input, JSON.stringify(report, null, '\t') + '\r\n');
  return { root, original, input, out, report };
}
const imageBlock = report => report.pages[0].blocks.find(block => block.type === 'image');
function snapshot(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(root, entry.name), stat = fs.lstatSync(file);
    return entry.isDirectory() ? snapshot(file) : [[file, stat.isFile() ? sha256(fs.readFileSync(file)) : stat.isSymbolicLink() ? fs.readlinkSync(file) : stat.mode]];
  });
}
function assertFailure(w, pattern = /./) {
  const before = snapshot(w.original);
  assert.throws(() => migrateFile(w), pattern);
  assert.equal(fs.existsSync(w.out), false);
  assert.deepEqual(snapshot(w.original), before);
  assert.deepEqual(fs.readdirSync(w.root).filter(name => name.startsWith('.历史迁移-')), []);
}

test('默认保真保留六种图形、完整正文、副标题、块标题、图片和获准PDF的精确字节', t => {
  const w = workspace(t), before = snapshot(w.original), original = fs.readFileSync(w.input);
  const result = migrateFile(w), saved = JSON.parse(fs.readFileSync(path.join(w.out, '报告.json')));
  assert.equal(result.mode, 'preserve'); assert.deepEqual(saved, w.report);
  assert.deepEqual(fs.readFileSync(path.join(w.out, '报告.json')), original);
  assert.deepEqual(saved.charts, w.report.charts); assert.deepEqual(saved.pages, w.report.pages);
  for (const file of ['资产/封面.png', '资产/资料.pdf']) assert.deepEqual(fs.readFileSync(path.join(w.out, file)), fs.readFileSync(path.join(w.original, file)));
  const gaps = JSON.parse(fs.readFileSync(path.join(w.out, '迁移缺口.json'))), analysis = migrateLegacy(w.report);
  assert.deepEqual(gaps.legacy_snapshot, w.report); assert.deepEqual(gaps.issues, analysis.gaps.issues);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(w.out, '结构化分析报告.json'))), analysis.report);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(w.out, '研究数据.json'))), analysis.research);
  assert.equal(result.research.project.status, 'internal_draft'); assert.deepEqual(result.research.evidence, []);
  assert.equal(gaps.delivery_fidelity.charts.summary, '6图仍6图，完整配置未转表');
  assert.equal(gaps.delivery_fidelity.assets.unique_files, 2); assert.equal(gaps.delivery_fidelity.assets.byte_identical, true);
  assert.equal(gaps.delivery_fidelity.report.sha256, sha256(original)); assert.equal(gaps.acceptance.business_acceptance, 'not_verified');
  assert.deepEqual(snapshot(w.original), before);
});

test('同一路径不同引用去重，原JSON引用写法不变', t => {
  const report = sample();
  report.pages[0].blocks.push({ ...imageBlock(report), file: './资产/封面.png' });
  report.attachments.push({ ...report.attachments[0], id: 'attachment-b', file: './资产/资料.pdf' });
  const w = workspace(t, report), result = migrateFile(w);
  assert.equal(result.gaps.delivery_fidelity.assets.unique_files, 2); assert.equal(result.gaps.delivery_fidelity.assets.references, 4);
  assert.equal(result.gaps.delivery_fidelity.assets.files[0].references.length, 2);
  assert.deepEqual(fs.readFileSync(path.join(w.out, '报告.json')), fs.readFileSync(w.input));
});

test('坏路径、外链和非普通文件不能静默排除，失败原件未变', async t => {
  for (const value of ['../outside.png', '/tmp/outside.png', '资产/../封面.png', 'https://example.com/a.png',
    'C:\\outside.png', '\\\\server\\file.png', '资产/%2e%2e/a.png', '资产/封面.png?x=1', '资产/封面.png#x',
    '资产/封面.png\0', '', null, '.', '资产', '资产/封面.png/', '不存在.png']) {
    await t.test(JSON.stringify(value), t => { const report = sample(); imageBlock(report).file = value; assertFailure(workspace(t, report)); });
  }
  await t.test('FIFO', t => {
    const w = workspace(t), file = path.join(w.original, '资产/封面.png'); fs.unlinkSync(file);
    assert.equal(spawnSync('mkfifo', [file]).status, 0); assertFailure(w, /普通文件/);
  });
  await t.test('输入目录不是文件', t => { const w = workspace(t); w.input = w.original; assertFailure(w, /普通文件/); });
});

test('符号链接文件、目录和悬空链接不能逃逸，其他文件不受影响', async t => {
  for (const kind of ['file', 'directory', 'dangling', 'internal']) await t.test(kind, t => {
    const w = workspace(t), outside = path.join(w.root, 'outside'); fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, '封面.png'), png);
    if (kind === 'directory') { fs.renameSync(path.join(w.original, '资产'), path.join(w.original, '存档')); fs.symlinkSync(outside, path.join(w.original, '资产')); }
    else {
      fs.unlinkSync(path.join(w.original, '资产/封面.png'));
      fs.symlinkSync(kind === 'dangling' ? path.join(outside, 'missing') : kind === 'internal' ? path.join(w.original, '资产/资料.pdf') : path.join(outside, '封面.png'), path.join(w.original, '资产/封面.png'));
    }
    assertFailure(w, /符号链接/); assert.deepEqual(fs.readFileSync(path.join(outside, '封面.png')), png);
  });
});

test('资产不得碰撞四份报告文件或其子路径', async t => {
  for (const name of ['报告.json', '研究数据.json', '结构化分析报告.json', '迁移缺口.json']) {
    for (const suffix of ['', '/图.png']) await t.test(name + suffix, t => {
      const report = sample(); imageBlock(report).file = name + suffix; const w = workspace(t, report);
      fs.mkdirSync(path.dirname(path.join(w.original, name + suffix)), { recursive: true });
      fs.writeFileSync(path.join(w.original, name + suffix), png); assertFailure(w, /碰撞/);
    });
  }
});

test('大小写路径碰撞也拒绝，不因不同系统产生覆盖', t => {
  const report = sample(); imageBlock(report).file = '资产/Case.png';
  report.pages[0].blocks.push({ ...imageBlock(report), file: '资产/case.png' }); const w = workspace(t, report);
  fs.writeFileSync(path.join(w.original, '资产/Case.png'), png); fs.writeFileSync(path.join(w.original, '资产/case.png'), png);
  assertFailure(w, /碰撞/);
});

test('未获准附件、缺少批准依据、伪PDF和不支持的文件块一律拒绝', async t => {
  const changes = [r => { r.attachments[0].shareApproved = false; }, r => { r.attachments[0].shareApproved = 'true'; },
    r => { delete r.attachments[0].shareBasis; }, r => { r.attachments[0].shareBasis = ' '; },
    r => { r.attachments[0].file = '资产/封面.png'; }, r => { r.attachments[0].file = '../other.pdf'; },
    r => { r.attachments[0].file = '资产'; }, r => { r.attachments[0].file = '资产/missing.pdf'; },
    r => { r.pages[0].blocks.push({ type: 'text', text: '不支持文件', file: '资产/资料.pdf' }); }];
  for (const [index, change] of changes.entries()) await t.test(String(index), t => { const report = sample(); change(report); assertFailure(workspace(t, report)); });
  await t.test('伪PDF头', t => { const w = workspace(t); fs.writeFileSync(path.join(w.original, '资产/资料.pdf'), 'not PDF'); assertFailure(w, /PDF/); });
  await t.test('伪图片头', t => { const w = workspace(t); fs.writeFileSync(path.join(w.original, '资产/封面.png'), '<script>'); assertFailure(w, /图片/); });
});

test('中途写入或rename失败只清理本次stage，不留下输出，也不删除旁人的stage', async t => {
  for (const operation of ['writeFileSync', 'renameSync']) await t.test(operation, t => {
    const w = workspace(t), outsider = path.join(w.root, '.历史迁移-别人'); fs.mkdirSync(outsider);
    const before = snapshot(w.original), original = fs[operation]; let injected = false;
    t.mock.method(fs, operation, (...args) => {
      assert.equal(fs.existsSync(w.out), false);
      if (operation === 'renameSync' || String(args[0]).endsWith('结构化分析报告.json')) { injected = true; throw new Error('注入写入故障'); }
      return original(...args);
    });
    assert.throws(() => migrateFile(w), /注入写入故障/); assert.equal(injected, true);
    assert.equal(fs.existsSync(w.out), false); assert.deepEqual(snapshot(w.original), before);
    assert.deepEqual(fs.readdirSync(w.root).filter(name => name.startsWith('.历史迁移-')), ['.历史迁移-别人']);
  });
});

test('显式structured保持旧分析行为；默认与帮助推荐preserve，非法mode不创建目录', t => {
  const report = sample(); report.attachments[0].shareApproved = false; imageBlock(report).file = '../missing.png';
  const w = workspace(t, report), result = migrateFile({ ...w, mode: 'structured' });
  assert.deepEqual(result.report, migrateLegacy(report).report); assert.equal(result.gaps.delivery_fidelity.report.byte_identical, false);
  assert.deepEqual(fs.readdirSync(w.out).sort(), ['报告.json', '研究数据.json', '迁移缺口.json'].sort());
  assert.throws(() => migrateFile({ ...w, out: path.join(w.root, 'bad'), mode: 'unknown' }), /模式/);
  assert.equal(fs.existsSync(path.join(w.root, 'bad')), false);
  for (const name of ['迁移研究数据', '回归历史样本']) {
    const result = spawnSync(process.execPath, [path.join(__dirname, `../scripts/${name}.cjs`), '--help'], { encoding: 'utf8' });
    assert.equal(result.status, 0); assert.match(result.stdout, /默认推荐 preserve/); assert.match(result.stdout, /structured/);
  }
});

test('保真回归默认调用新版主构建和主验收，低保真分析不会替代报告输入', async t => {
  const w = workspace(t), calls = [];
  t.mock.method(require('../scripts/构建报告.cjs'), 'buildReport', options => {
    calls.push('build'); assert.equal(options.outputDir, path.join(w.out, '交付')); assert.equal(options.overwrite, false);
    assert.equal(options.researchPath, path.join(w.out, '研究数据.json'));
    assert.equal(options.reportPath, path.join(w.out, '技术回放报告.json'));
    const replay = JSON.parse(fs.readFileSync(options.reportPath));
    assert.equal(replay.production_mode, 'historical_replay'); assert.equal(replay.delivery_scope, 'complete');
    delete replay.production_mode; delete replay.delivery_scope;
    assert.deepEqual(replay, JSON.parse(fs.readFileSync(w.input))); return { page_count: 1 };
  });
  t.mock.method(require('../scripts/验收报告.cjs'), 'acceptReport', output => {
    calls.push('accept'); assert.equal(output, path.join(w.out, '交付')); return { status: 'technical_passed', business_approval: 'not_granted' };
  });
  const result = await runRegression(w); assert.deepEqual(calls, ['build', 'accept']);
  assert.equal(result.technical_replay.status, 'technical_passed'); assert.equal(result.technical_acceptance.status, 'technical_passed');
  assert.equal(result.chart_replay.preserved, 6); assert.equal(result.chart_replay.table_fallback, 0);
  assert.equal(result.source_unchanged, true); assert.equal(result.chart_replay.status, 'not_verified');
  assert.equal(result.content_review.status, 'not_reviewed'); assert.equal(result.business_acceptance.status, 'not_verified');
  assert.equal(result.second_project.status, 'not_completed');
});

test('主验收缺席、异常和未明确通过均如实记录，不假报通过', async t => {
  for (const kind of ['missing', 'throw', 'unconfirmed']) await t.test(kind, async t => {
    const w = workspace(t), before = snapshot(w.original);
    const result = await runRegression({ ...w, builder: () => ({ page_count: 1 }),
      acceptor: kind === 'missing' ? null : () => { if (kind === 'throw') throw new Error('验收故障'); return { ok: true }; } });
    assert.equal(result.technical_replay.status, kind === 'missing' ? 'built_not_verified' : 'failed');
    assert.equal(result.technical_acceptance.status, kind === 'missing' ? 'not_run' : 'failed');
    assert.deepEqual(snapshot(w.original), before); assert.equal(result.source_unchanged, true);
  });
});

test('回归保留目录和结果文件也拒绝资产碰撞', async t => {
  for (const name of ['回归结果.json', '交付/图.png']) await t.test(name, async t => {
    const report = sample(); imageBlock(report).file = name; const w = workspace(t, report);
    fs.mkdirSync(path.dirname(path.join(w.original, name)), { recursive: true }); fs.writeFileSync(path.join(w.original, name), png);
    await assert.rejects(runRegression(w), /碰撞/); assert.equal(fs.existsSync(w.out), false);
  });
});

test('迁移复用主安全校验拒绝危险图表配置和图片扩展名伪装', async t => {
  for (const option of [{ title: { link: 'javascript:alert(1)' } },
    { series: [{ type: 'bar', data: [1], symbol: 'image://https://example.com/remote.png' }] },
    JSON.parse('{"__proto__":{"polluted":true}}')]) await t.test(JSON.stringify(option), t => {
    const report = sample(); report.charts[0].option = option; assertFailure(workspace(t, report));
  });
  await t.test('扩展名伪装', t => {
    const report = sample(); imageBlock(report).file = '资产/封面.jpg'; const w = workspace(t, report);
    fs.writeFileSync(path.join(w.original, '资产/封面.jpg'), png); assertFailure(w, /扩展名/);
  });
});

test('迁移期间原件变化和目标被其他任务抢先创建均不会发布stage', async t => {
  for (const kind of ['input', 'asset', 'destination']) await t.test(kind, t => {
    const w = workspace(t), write = fs.writeFileSync; let injected = false;
    t.mock.method(fs, 'writeFileSync', (...args) => {
      const result = write(...args);
      if (!injected && String(args[0]).endsWith('结构化分析报告.json')) {
        injected = true;
        if (kind === 'destination') { fs.mkdirSync(w.out); write(path.join(w.out, '他人.txt'), '其他任务'); }
        else write(kind === 'input' ? w.input : path.join(w.original, '资产/封面.png'), '其他任务修改');
      }
      return result;
    });
    assert.throws(() => migrateFile(w), /变化|已存在/); assert.equal(injected, true);
    assert.deepEqual(fs.readdirSync(w.root).filter(name => name.startsWith('.历史迁移-')), []);
    if (kind === 'destination') assert.equal(fs.readFileSync(path.join(w.out, '他人.txt'), 'utf8'), '其他任务');
    else assert.equal(fs.existsSync(w.out), false);
  });
});

test('原样本迁移后经新版主入口完成真实离线浏览器、图片、PDF附件和讲者验收', {
  skip: process.env.RUN_DELIVERY_TESTS !== '1' && '需设置 RUN_DELIVERY_TESTS=1 和现有浏览器/PDF运行时', timeout: 240000
}, async t => {
  const w = workspace(t), baseline = process.env.ANQIAN_OLD_SKILL_ROOT;
  const fixture = baseline ? path.join(baseline, 'scripts/测试样本.cjs') : '../scripts/兼容引擎/测试样本.cjs';
  const source = path.join(w.root, 'baseline'), report = require(fixture).makeFixture(source);
  report.attachments = [{ ...sample().attachments[0], sourceKey: 'test-source', file: '资料.pdf' }];
  fs.writeFileSync(path.join(source, '资料.pdf'), pdfBytes());
  const input = path.join(source, '报告.json'); fs.writeFileSync(input, JSON.stringify(report, null, 2));
  const before = snapshot(source), result = await runRegression({ input, out: w.out });
  assert.equal(result.technical_replay.status, 'technical_passed', JSON.stringify(result.technical_replay));
  assert.equal(result.technical_acceptance.result.pages, 3); assert.equal(result.technical_acceptance.result.attachments, 1);
  assert.equal(result.technical_acceptance.result.images, 1); assert.equal(result.technical_acceptance.result.charts, 2);
  assert.deepEqual(snapshot(source), before); assert.deepEqual(fs.readFileSync(path.join(w.out, '报告.json')), fs.readFileSync(input));
  assert.equal(result.source_unchanged, true); assert.equal(result.business_acceptance.status, 'not_verified');
  assert(fs.statSync(path.join(w.out, '交付/案前洞察.pdf')).size > 1000);
});

test('结构化analysis fatal不改变保真CLI成功退出，structured仍保留原门禁', t => {
  const report = sample(); report.pages[0].sourceIds.push('source-a'); const w = workspace(t, report);
  for (const mode of ['preserve', 'structured']) {
    const run = spawnSync(process.execPath, [path.join(__dirname, '../scripts/迁移研究数据.cjs'),
      '--input', w.input, '--out', path.join(w.root, mode), '--mode', mode], { encoding: 'utf8' });
    assert.equal(run.status, mode === 'preserve' ? 0 : 1, run.stderr);
    const result = JSON.parse(run.stdout); assert(result.analysis_fatal > 0); assert.equal(result.issues_scope, 'structured_analysis');
  }
});

test('保真回归不被独立分析fatal阻断，仍由主build检查原始输入', async t => {
  const report = sample(); report.pages[0].sourceIds.push('source-a'); const w = workspace(t, report);
  const result = await runRegression({ ...w, validator: () => ({ ok: false, issues: ['仅结构化分析未通过'] }), acceptor: null });
  assert(result.migration_issues.some(issue => issue.severity === 'fatal'));
  assert.equal(result.migration_issues_scope, 'structured_analysis'); assert.equal(result.research_validation.status, 'failed');
  assert.equal(result.technical_replay.status, 'built_not_verified', JSON.stringify(result.technical_replay));
  assert.deepEqual(fs.readFileSync(path.join(w.out, '报告.json')), fs.readFileSync(w.input));
  const structured = await runRegression({ ...w, out: path.join(w.root, 'structured'), mode: 'structured', acceptor: null });
  assert.equal(structured.technical_replay.status, 'blocked');
});
