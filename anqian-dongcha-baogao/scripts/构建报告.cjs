#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {fingerprint}=require('./输入指纹.cjs');
const skill=path.resolve(__dirname,'..');
const templates=path.join(skill,'assets/报告模板');
const vendor=path.join(skill,'assets/依赖');
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const json=value=>JSON.stringify(value).replace(/</g,'\\u003c');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function text(value,label){assert(typeof value==='string'&&value.trim(),label+'不能为空');return value;}
function date(value){assert(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'日期必须是有效的YYYY-MM-DD');}
function unique(items,label){assert(Array.isArray(items),label+'必须是数组');const ids=new Set();for(const item of items){assert(/^[a-zA-Z][\w-]*$/.test(item.id)&&!ids.has(item.id),label+'编号重复或无效');ids.add(item.id);}return ids;}
function inside(root,relative){
  text(relative,'文件路径');
  const candidate=path.resolve(root,relative);
  assert(candidate.startsWith(root+path.sep),'文件必须在项目目录内');
  assert(fs.existsSync(candidate),'文件不存在：'+relative);
  const real=fs.realpathSync(candidate);
  assert(real.startsWith(root+path.sep),'软链接文件必须在项目目录内');
  assert(fs.statSync(real).isFile(),'需要普通文件：'+relative);
  return real;
}
function refs(ids,known,label){assert(Array.isArray(ids),label+'来源必须是数组');for(const id of ids)assert(known.has(id),label+'来源不存在：'+id);}
function build(project,overwrite=false){
  const root=fs.realpathSync(path.resolve(project));
  const config=JSON.parse(fs.readFileSync(inside(root,'报告.json'),'utf8'));
  text(config.title,'报告标题');text(config.publisher,'发布者');date(config.date);
  assert(/^[a-zA-Z][\w-]*$/.test(config.id),'项目id必须为稳定的字母数字编号');
  assert(typeof config.presenter==='boolean','presenter必须明确为true或false');
  const sourceIds=unique(config.sources,'来源'),pageIds=unique(config.pages,'页面'),chartIds=unique(config.charts,'图表');
  assert(pageIds.size>0,'报告至少需要一页');
  unique(config.attachments,'附件');
  for(const source of config.sources){
    text(source.title,'来源标题');text(source.publisher,'来源机构');text(source.period,'数据时期');text(source.scope,'来源口径');
    date(source.accessedAt);
    if(source.publishedAt)date(source.publishedAt);
    assert(/^https?:\/\//.test(source.url),'来源链接必须为HTTP或HTTPS');
    const url=new URL(source.url);assert(!url.username&&!url.password,'来源链接不得包含账号密码');
  }
  const chartMap=new Map(config.charts.map(item=>[item.id,item]));
  const usedCharts=new Set();
  for(const chart of config.charts){
    text(chart.unit,'图表单位');text(chart.period,'图表时期');text(chart.scope,'图表口径');refs(chart.sourceIds,sourceIds,'图表');
    assert(chart.sourceIds.length>0,'统计图必须关联来源');
    assert(Array.isArray(chart.option?.series)&&chart.option.series.length>0,'图表数据不能为空');
    for(const series of chart.option.series){
      assert(['bar','line','pie','scatter'].includes(series.type),'首版支持bar/line/pie/scatter；其他图式需另行实现并验收');
      assert(Array.isArray(series.data)&&series.data.length>0,'图表数据不能为空');
      const valid=value=>typeof value==='number'&&Number.isFinite(value);
      assert(series.data.every(item=>{const value=typeof item==='object'&&!Array.isArray(item)?item?.value:item;return Array.isArray(value)?value.length>0&&value.every(valid):valid(value);}), '图表数据必须为有限数字');
    }
  }
  const attachmentPayloads=[];
  const documents=config.attachments.map(item=>{
    assert(item.shareApproved===true&&typeof item.shareBasis==='string'&&item.shareBasis.trim(),'附件必须明确分享许可及依据，公开可下载不等于可分发');
    assert(sourceIds.has(item.sourceKey),'附件来源不存在');
    text(item.title,'附件标题');text(item.formatLabel,'附件格式说明');
    assert(Number.isInteger(item.pages)&&item.pages>0&&Number.isInteger(item.citedPage)&&item.citedPage>=1&&item.citedPage<=item.pages,'附件页数或引用页无效');
    const bytes=fs.readFileSync(inside(root,item.file));
    assert(bytes.subarray(0,5).toString()==='%PDF-','附件不是PDF');
    attachmentPayloads.push(`<script type="application/octet-stream" id="embedded-pdf-${item.id}">${bytes.toString('base64')}</script>`);
    return {id:item.id,sourceKey:item.sourceKey,title:item.title,pages:item.pages,citedPage:item.citedPage,formatLabel:item.formatLabel,description:item.description||'',filename:path.basename(item.file),bytes:bytes.length,sha256:sha(bytes)};
  });
  assert(new Set(documents.map(item=>item.sourceKey)).size===documents.length,'一个来源编号只能对应一份附件，请为不同文件拆分来源');
  const sourceMap=new Map(config.sources.map(source=>[source.id,source]));
  const documentMap=new Map(documents.map(item=>[item.sourceKey,item]));
  const link=(id,page)=>{
    const source=sourceMap.get(id);const attachment=documentMap.get(id);
    if(page!==undefined)assert(attachment&&Number.isInteger(page)&&page>=1&&page<=attachment.pages,'引用页必须在已嵌入PDF范围内');
    return `<a data-source="${escape(id)}"${page?' data-pdf-page="'+page+'"':''} href="${escape(source.url)}">${escape(source.title)}${page?' · PDF第'+page+'页':''}</a>`;
  };
  function block(item){
    const heading=item.title?`<h2>${escape(item.title)}</h2>`:'';
    if(item.type==='text')return `<div>${heading}<p>${escape(text(item.text,'说明文字')).replace(/\n/g,'<br>')}</p></div>`;
    if(item.type==='list'){assert(Array.isArray(item.items)&&item.items.length,'列表不能为空');return `<div>${heading}<ul>${item.items.map(value=>'<li>'+escape(value)+'</li>').join('')}</ul></div>`;}
    if(item.type==='chart'){
      assert(chartIds.has(item.chartId)&&!usedCharts.has(item.chartId),'图表缺失或在多个页面重复使用：'+item.chartId);
      usedCharts.add(item.chartId);const chart=chartMap.get(item.chartId);
      return `<figure class="plot">${heading}<p class="sub">${escape(chart.period)} · ${escape(chart.unit)}</p><div class="chart" id="chart-${escape(item.chartId)}" aria-label="${escape(item.title||item.chartId)}"></div><figcaption>${escape(chart.scope)} · ${chart.sourceIds.map(id=>link(id)).join('；')}</figcaption></figure>`;
    }
    if(item.type==='image'){
      const file=inside(root,item.file),ext=path.extname(file).toLowerCase();
      const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[ext];
      assert(mime,'图片只支持PNG/JPEG/WebP，请先转换其他格式');
      return `<figure class="report-image">${heading}<img src="data:${mime};base64,${fs.readFileSync(file).toString('base64')}" alt="${escape(text(item.alt,'图片描述'))}"><figcaption>${escape(text(item.caption,'图片来源说明'))}</figcaption></figure>`;
    }
    if(item.type==='table'){
      assert(Array.isArray(item.headers)&&item.headers.length&&Array.isArray(item.rows)&&item.rows.length&&item.rows.every(row=>Array.isArray(row)&&row.length===item.headers.length),'表格行列不一致');
      return `<div>${heading}<table><thead><tr>${item.headers.map(value=>'<th>'+escape(value)+'</th>').join('')}</tr></thead><tbody>${item.rows.map(row=>'<tr>'+row.map(value=>'<td>'+escape(value)+'</td>').join('')+'</tr>').join('')}</tbody></table></div>`;
    }
    throw new Error('未知内容块类型：'+item.type);
  }
  const pageHtml=config.pages.map((page,index)=>{
    text(page.title,'页面标题');text(page.section,'页面主题');text(page.notes,'讲解备注');text(page.takeaway,'页面判断');
    refs(page.sourceIds,sourceIds,'页面');
    assert(['single','two-one','two-equal','three'].includes(page.layout),'无效页面布局');
    assert(Array.isArray(page.blocks)&&page.blocks.length>0,'页面内容不能为空');
    const citations=page.citations||page.sourceIds.map(sourceId=>({sourceId}));
    for(const cite of citations)assert(sourceIds.has(cite.sourceId),'页面引用来源不存在');
    const links=citations.map(cite=>link(cite.sourceId,cite.page)).join('；');
    const body=page.blocks.map(block).join('');
    return `<section class="page" id="p${index+1}" data-page-id="${escape(page.id)}"><div class="mast"><span>${escape(config.publisher)} <b>研究与洞察</b></span><span>${escape(config.title)} · ${escape(page.section)}</span></div><header><div class="eyebrow">${String(index+1).padStart(2,'0')} / ${escape(page.section)}</div><h1>${escape(page.title)}</h1><p>${escape(page.subtitle||'')}</p></header><div class="body ${page.layout}">${body}</div><div class="takeaway"><b>我们的观点</b><span>${escape(page.takeaway)}</span></div><footer><div>${links}${links?'<br>':''}${escape(page.sourceNote||'')} · ${escape(config.date)}</div><b>${index+1} / ${config.pages.length}</b></footer></section>`;
  }).join('\n');
  assert(usedCharts.size===chartIds.size,'存在未使用图表，先清理或放入对应页面');
  const payload=[`<script type="application/json" id="document-manifest">${json(documents)}</script>`,...attachmentPayloads];
  if(documents.length){
    const pdfRoot=path.join(vendor,'PDF阅读器');
    for(const [filename,id] of [['pdf.min.mjs','embedded-pdfjs'],['pdf.worker.min.mjs','embedded-pdfjs-worker']])payload.push(`<script type="application/octet-stream" id="${id}">${fs.readFileSync(path.join(pdfRoot,filename)).toString('base64')}</script>`);
    const resources={cMapUrl:{},standardFontDataUrl:{}};
    for(const [directory,kind,pattern] of [['cmaps','cMapUrl',/\.bcmap$/],['standard_fonts','standardFontDataUrl',/\.(pfb|ttf)$/]])for(const filename of fs.readdirSync(path.join(pdfRoot,directory)).filter(name=>pattern.test(name)))resources[kind][filename]=fs.readFileSync(path.join(pdfRoot,directory,filename)).toString('base64');
    payload.push(`<script type="application/json" id="embedded-pdfjs-resources">${json(resources)}</script>`);
  }
  const script=code=>'<script>'+code.replace(/<\/script/gi,'<\\/script')+'</script>';
  const runtime={title:config.title,namespace:'anqian-'+config.id,presenter:config.presenter};
  const chartData={sources:Object.fromEntries(config.sources.map(source=>[source.id,source.url])),charts:config.charts.map(({id,option})=>({id:'chart-'+id,option}))};
  const scripts=['echarts.min.js','lucide.min.js'].map(filename=>script(fs.readFileSync(path.join(vendor,filename),'utf8')));
  scripts.push(script(`window.REPORT_CONFIG=${json(runtime)};window.REPORT_DATA=${json(chartData)};window.PAGE_NOTES=${json(config.pages.map(page=>page.notes))};`));
  for(const filename of ['报告交互.js','资料阅读器.js'])scripts.push(script(fs.readFileSync(path.join(templates,filename),'utf8')));
  const extraStyle='.body.single{grid-template-columns:minmax(0,1fr)}.body.two-equal{grid-template-columns:repeat(2,minmax(0,1fr))}.body.three{grid-template-columns:repeat(3,minmax(0,1fr))}.report-image img{width:100%;height:290px;object-fit:contain}.body li{font-size:15px;line-height:1.8;margin-bottom:10px}@media(max-width:800px){.body.two-equal,.body.three{grid-template-columns:minmax(0,1fr)}.report-image img{height:220px}}';
  const replacements={TITLE:escape(config.title),STYLE:fs.readFileSync(path.join(templates,'报告样式.css'),'utf8')+extraStyle,PAGES:pageHtml,ATTACHMENTS:payload.join('\n'),SCRIPTS:scripts.join('\n')};
  const shell=fs.readFileSync(path.join(templates,'报告外壳.html'),'utf8');
  for(const key of Object.keys(replacements))assert(shell.split('{{'+key+'}}').length===2,'模板标记数量错误：'+key);
  const html=shell.replace(/\{\{(TITLE|STYLE|PAGES|ATTACHMENTS|SCRIPTS)\}\}/g,(_,key)=>replacements[key]);
  const output=path.join(root,'交付');
  if(fs.existsSync(output))assert(fs.realpathSync(output)===output,'交付目录不能为软链接');
  fs.mkdirSync(output,{recursive:true});
  const manifest={title:config.title,id:config.id,date:config.date,pages:config.pages.length,charts:config.charts.length,presenter:config.presenter,documents,inputSha256:fingerprint(root,config),htmlSha256:sha(Buffer.from(html)),bytes:Buffer.byteLength(html)};
  const files={'案前洞察.html':html,'逐页讲解备注.md':`# ${config.title}\n\n${config.date}\n\n`+config.pages.map((page,index)=>`## 第${index+1}页 · ${page.title}\n\n${page.notes}`).join('\n\n'),'成品清单.json':JSON.stringify(manifest,null,2),'研究数据.json':JSON.stringify(config,null,2)};
  for(const name of Object.keys(files))if(fs.existsSync(path.join(output,name))){assert(!fs.lstatSync(path.join(output,name)).isSymbolicLink(),'输出文件不能为软链接');assert(overwrite,'交付文件已存在，确认后传入--overwrite');}
  for(const [name,content] of Object.entries(files)){
    const temporary=path.join(output,'.'+name+'.'+crypto.randomUUID()+'.tmp');fs.writeFileSync(temporary,content,{flag:'wx'});fs.renameSync(temporary,path.join(output,name));
  }
  return manifest;
}
module.exports={build};
if(require.main===module){
  if(process.argv.includes('--help')){console.log('用法：node 构建报告.cjs 项目目录 [--overwrite]\n读取报告.json，生成交付/案前洞察.html及备注、清单、研究数据；构建不访问网络。');process.exit(0);}
  try{assert(process.argv[2]&&!process.argv[2].startsWith('--'),'请提供项目目录；使用--help查看说明');console.log(JSON.stringify(build(process.argv[2],process.argv.includes('--overwrite')),null,2));}
  catch(error){console.error('构建未完成：'+error.message);process.exitCode=1;}
}
