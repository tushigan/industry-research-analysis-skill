'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { validateDiagram, renderDiagram } = require('../scripts/兼容引擎/可重排图形.cjs');
const { build } = require('../scripts/构建报告.cjs');
const { makeFixture } = require('../scripts/测试样本.cjs');
const { get } = require('../scripts/兼容引擎/运行依赖.cjs');
function sample(count = 3) {
  return {type:'diagram',variant:'relationship-map',title:'真实条件汇合后才讨论结果',
    columns:[0,1,2].map(ci=>({title:'列'+ci,nodes:Array.from({length:count},(_,i)=>({
      id:`n${ci}-${i}`,label:'节'.repeat(17),detail:'证'.repeat(count === 4 ? 38 : 57)
    }))})),
    edges:[0,1].flatMap(ci=>Array.from({length:count},(_,i)=>({from:`n${ci}-${i}`,to:`n${ci+1}-${i}`,kind:i%2?'condition':'inference'})))
  };
}
test('关系图文字、实质连接及手机关系保留',()=>{
  const b=sample(), html=renderDiagram(b);
  assert.equal((html.match(/class="map-node"/g)||[]).length,9);
  assert.equal((html.match(/class="map-edge /g)||[]).length,6);
  assert.match(html,/map-mobile-links/);
  assert(!html.includes('<script'));
});
test('正文严格转义且旧图形不注入关系图',()=>{
  const b=sample(1);b.columns[0].nodes[0].detail='<img src=x onerror=alert(1)>';
  const html=renderDiagram(b);
  assert(html.includes('&lt;img'));assert(!html.includes('<img'));
  assert(!renderDiagram({type:'diagram',variant:'steps',columns:['环节','结果'],rows:[['输入','输出']]}).includes('map-'));
});
for(const [name,mutate] of [
  ['额外脚本',b=>b.script='x'],['未知性质',b=>b.edges[0].kind='execute'],
  ['孤立节点',b=>b.edges.splice(0,1)],['未知端点',b=>b.edges[0].to='missing'],
  ['反向连接',b=>[b.edges[0].from,b.edges[0].to]=[b.edges[0].to,b.edges[0].from]],
  ['跨列',b=>b.edges[0].to='n2-0'],['重复边',b=>b.edges.push(b.edges[0])],
  ['重复节点',b=>b.columns[0].nodes[1].id='n0-0'],['非标识符',b=>b.columns[0].nodes[0].id='"><img>'],
  ['控制字符',b=>b.columns[0].nodes[0].detail='x\nz'],['过密',b=>{b.columns[0].nodes[0].label='节'.repeat(18);b.columns[0].nodes[0].detail='证'.repeat(72);}],
  ['列数',b=>b.columns.pop()],['空数组',b=>b.edges=[]],['稀疏',b=>delete b.columns[0].nodes[0]],
  ['数组额外字段',b=>b.columns.extra=true],['符号',b=>b.columns[0][Symbol('extra')]=true]
])test('关系图拒绝'+name,()=>{const b=sample();mutate(b);assert.throws(()=>validateDiagram(b),/relationship-map/);});
test('访问器不被执行',()=>{
  for(const location of ['block','column','node','edge','array']){
    const b=sample();let called=false;
    const target={block:[b,'columns'],column:[b.columns[0],'nodes'],node:[b.columns[0].nodes[0],'detail'],edge:[b.edges[0],'to'],array:[b.edges,'0']}[location];
    Object.defineProperty(target[0],target[1],{get(){called=true;return 'x';}});
    assert.throws(()=>validateDiagram(b));assert.equal(called,false);
  }
});
test('关系图真实浏览器容量、连接、打印文字与PDF', {skip:process.env.RUN_DELIVERY_TESTS!=='1',timeout:120000},async t=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'relation-map-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const report=makeFixture(root), blocks=[sample(3),sample(4),sample(1)];
  report.charts=[];report.pages=blocks.map((block,i)=>({...report.pages[0],id:'map-'+i,layout:'single',blocks:[block],title:'条件与结果按实际连接，不能用图形虚构因果'}));
  fs.writeFileSync(path.join(root,'报告.json'),JSON.stringify(report));build(root);
  const browser=await get('playwright').chromium.launch();
  try{
    const page=await browser.newPage();const errors=[];
    page.on('pageerror',err=>errors.push(err.message));
    await page.goto(pathToFileURL(path.join(root,'交付/案前洞察.html')).href);
    await page.waitForFunction(()=>window.reportReady===true);
    for(const width of [1500,1280,1101,390]){
      await page.setViewportSize({width,height:1000});
      await inspect(page,width===390);
    }
    await page.setViewportSize({width:1500,height:1000});await page.emulateMedia({media:'print'});
    await inspect(page,false);
    const pdf=path.join(root,'图.pdf');await page.pdf({path:pdf,preferCSSPageSize:true,printBackground:true});
    const r=spawnSync(process.env.ANQIAN_PYTHON||'python3',['-c','import fitz,json,sys;d=fitz.open(sys.argv[1]);print(json.dumps({"pages":len(d),"texts":[p.get_text() for p in d],"paths":[len(p.get_drawings()) for p in d]}))',pdf],{encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);const parsed=JSON.parse(r.stdout);assert.equal(parsed.pages,3);
    parsed.texts.forEach((value,i)=>{assert(value.replace(/\s/g,'').includes(blocks[i].columns[0].nodes[0].detail));assert(parsed.paths[i]>9);});
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
async function inspect(page,mobile){
  const issues=await page.evaluate(mobile=>{
    const errors=[];
    for(const fig of document.querySelectorAll('.diagram-relationship-map')){
      const rect=fig.getBoundingClientRect(),end=fig.closest('.page').querySelector('.takeaway').getBoundingClientRect();
      if(rect.bottom>end.top+1)errors.push('图侵入结论区');
      for(const column of fig.querySelectorAll('.map-column')){
        let last=0;
        for(const node of column.querySelectorAll('.map-node')){
          const r=node.getBoundingClientRect();
          if(r.top<last-1)errors.push('节点相互重叠');
          last=r.bottom;
          if(node.scrollWidth>node.clientWidth+1)errors.push('节点横向溢出');
          for(const p of node.querySelectorAll('h4,p')){
            if(p.getBoundingClientRect().bottom>r.bottom+1)errors.push('文字越界');
            if(parseFloat(getComputedStyle(p).fontSize)<14)errors.push('字号过小');
          }
        }
      }
      const svg=fig.querySelector('.map-links');
      if(mobile){
        if(getComputedStyle(svg).display!=='none'||getComputedStyle(fig.querySelector('.map-mobile-links')).display==='none')errors.push('手机关系丢失');
      }else{
        const surface=fig.querySelector('.map-surface').getBoundingClientRect();
        for(const edge of svg.querySelectorAll('path')){
          if(edge.getTotalLength()<10)errors.push('空连线');
          const start=edge.getPointAtLength(0),finish=edge.getPointAtLength(edge.getTotalLength());
          if(start.x>=finish.x||finish.y<48||finish.y>384)errors.push('连接坐标错误');
        }
        for(const col of fig.querySelectorAll('.map-column')){
          const nodes=[...col.querySelectorAll('.map-node')];
          nodes.forEach((n,i)=>{
            const r=n.getBoundingClientRect();
            const expected=surface.top+(48+(i+0.5)*336/nodes.length)*surface.height/384;
            if(Math.abs((r.top+r.bottom)/2-expected)>1)errors.push('节点未对准连接高度');
          });
        }
      }
    }
    if(document.documentElement.scrollWidth>innerWidth+1)errors.push('页面横向溢出');
    return errors;
  },mobile);
  assert.deepEqual(issues,[]);
}
