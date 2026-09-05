const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const builder = path.join(__dirname, '构建报告.cjs');
const {makeFixture} = require('./测试样本.cjs');
const {assertFresh}=require('./输入指纹.cjs');

function execute(change = () => {}, args = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anqian-build-test-'));
  const config = makeFixture(root);
  change(config, root);
  fs.writeFileSync(path.join(root, '报告.json'), JSON.stringify(config));
  const run = spawnSync(process.execPath, [builder, root, ...args], {encoding:'utf8'});
  return {root, config, run};
}
test('动态页面、图表和备注，生成独立HTML，不携带原客户', () => {
  const {root, run} = execute();
  assert.equal(run.status, 0, run.stderr);
  const html = fs.readFileSync(path.join(root, '交付/案前洞察.html'), 'utf8');
  assert.equal((html.match(/<section class="page/g) || []).length, 3);
  assert(!html.includes('历史案例客户') && !/\/(?:Users|home)\/[^/]+\//.test(html));
  assert(html.includes('测试品牌甲') && html.includes('data:image/png;base64,'));
  assert(!/<script src=|<link rel="stylesheet"/.test(html));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '交付/成品清单.json')));
  assert.equal(manifest.pages, 3);
  assert.equal(manifest.charts, 2);
  assert.equal(manifest.documents.length, 0);
});
test('不同标题和页数不会沿用旧客户标识', () => {
  const {root, run} = execute(c => { c.title='测试品牌乙';c.id='test-b';c.pages.push({...c.pages[2],id:'p4',title:'第四页的经营判断'}); });
  assert.equal(run.status, 0, run.stderr);
  const output=JSON.parse(fs.readFileSync(path.join(root,'交付/成品清单.json')));
  assert.equal(output.pages,4);
  assert.equal(output.title,'测试品牌乙');
});
for (const [name, mutate, expected] of [
  ['重复页面编号', c=>c.pages[1].id=c.pages[0].id, /页面编号/],
  ['缺少讲解备注', c=>c.pages[0].notes='', /备注/],
  ['引用不存在', c=>c.pages[0].sourceIds=['lost'], /来源/],
  ['图表缺少数据口径', c=>c.charts[0].scope='', /口径/],
  ['附件没有分享许可说明', c=>c.attachments=[{id:'f1',shareApproved:false}], /分享/],
  ['图片跨出项目目录', c=>c.pages[2].blocks[0].file='../secret.png', /项目目录/],
  ['不允许脚本URL', c=>c.sources[0].url='javascript:alert(1)', /来源链接/],
  ['无效日期', c=>c.date='2026-99-99', /日期/],
  ['空图表数据', c=>c.charts[0].option.series[0].data=[], /图表数据/],
  ['图表引用但没有图表', c=>c.pages[0].blocks[0].chartId='missing', /图表/],
]) test(name,()=>{const {run}=execute(mutate);assert.notEqual(run.status,0);assert.match(run.stderr,expected);});
test('默认不覆盖已有交付，须明确传入--overwrite',()=>{
  const {root,run}=execute();assert.equal(run.status,0,run.stderr);
  const again=spawnSync(process.execPath,[builder,root],{encoding:'utf8'});
  assert.notEqual(again.status,0);assert.match(again.stderr,/已存在/);
  const overwrite=spawnSync(process.execPath,[builder,root,'--overwrite'],{encoding:'utf8'});
  assert.equal(overwrite.status,0,overwrite.stderr);
});
test('不能读取指向项目外的图片软链接',()=>{
  const {run}=execute((c,root)=>{
    fs.symlinkSync('/etc/hosts',path.join(root,'外链.png'));
    c.pages[2].blocks[0].file='外链.png';
  });assert.notEqual(run.status,0);assert.match(run.stderr,/项目目录/);
});
test('测试样本拒绝非空目录，不覆盖已有资料',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'anqian-fixture-test-'));
  fs.writeFileSync(path.join(root,'报告.json'),'保留原始资料');
  assert.throws(()=>makeFixture(root),/空目录/);
  assert.equal(fs.readFileSync(path.join(root,'报告.json'),'utf8'),'保留原始资料');
});
test('单页零统计图且关闭讲者也能独立构建',()=>{
  const {root,run}=execute(c=>{c.presenter=false;c.charts=[];c.pages=[c.pages[2]];});
  assert.equal(run.status,0,run.stderr);
  const output=JSON.parse(fs.readFileSync(path.join(root,'交付/成品清单.json')));
  assert.equal(output.pages,1);assert.equal(output.charts,0);assert.equal(output.presenter,false);
});
test('图表业务编号与页面工具编号相同也不会产生重复DOM编号',()=>{
  const {root,run}=execute(c=>{
    c.charts[0].id='p1';c.pages[0].blocks[0].chartId='p1';
    c.charts[1].id='document-manifest';c.pages[1].blocks[0].chartId='document-manifest';
  });
  assert.equal(run.status,0,run.stderr);
  const html=fs.readFileSync(path.join(root,'交付/案前洞察.html'),'utf8');
  assert.equal((html.match(/ id="p1"/g)||[]).length,1);
  assert.equal((html.match(/ id="document-manifest"/g)||[]).length,1);
  assert(html.includes('id="chart-p1"')&&html.includes('id="chart-document-manifest"'));
});
test('修改正文或来源后必须重新构建，旧成品不能验收',()=>{
  const {root,config,run}=execute();assert.equal(run.status,0,run.stderr);
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'交付/成品清单.json')));
  assert.doesNotThrow(()=>assertFresh(root,config,manifest));
  config.pages[0].blocks[1].text='已修改的正文';
  config.sources[0].url='https://example.com/new';
  fs.writeFileSync(path.join(root,'报告.json'),JSON.stringify(config));
  assert.throws(()=>assertFresh(root,config,manifest),/重新构建/);
});
test('图片文件变化即使配置未变也会使旧成品验收失败',()=>{
  const {root,config,run}=execute();assert.equal(run.status,0,run.stderr);
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'交付/成品清单.json')));
  fs.appendFileSync(path.join(root,'测试像素.png'),'changed');
  assert.throws(()=>assertFresh(root,config,manifest),/重新构建/);
});
