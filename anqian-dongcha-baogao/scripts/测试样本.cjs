const fs=require('node:fs');
const path=require('node:path');
function makeFixture(root){
  if(fs.existsSync(root)&&fs.readdirSync(root).length)throw new Error('测试样本只允许写入空目录，不能覆盖已有资料');
  fs.mkdirSync(root,{recursive:true});
  // 固定的测试像素只用于验收图片内嵌，不是产品图片。
  fs.writeFileSync(path.join(root,'测试像素.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
  const base={sourceIds:['test-source'],sourceNote:'技术验收用合成数据，不代表市场事实。',notes:'本页仅测试案前报告模板的数据呈现与讲解同步。所有数字均为合成样本，不用于客户研究或商业判断。测试目的包括图表、文字、来源和备注是否保持一致，以及页面在不同尺寸下能否正常阅读。'};
  const config={id:'test-a',title:'测试品牌甲',publisher:'研究测试',date:'2026-09-05',presenter:true,
    sources:[{id:'test-source',title:'合成测试资料',publisher:'本项目测试',url:'https://example.com/research',publishedAt:'2026-09-05',accessedAt:'2026-09-05',period:'测试阶段',scope:'无真实市场样本'}],
    charts:[
      {id:'test-bars',sourceIds:['test-source'],unit:'测试单位',period:'阶段甲与乙',scope:'合成数据，非行业统计',option:{grid:{left:48,right:35,top:35,bottom:38},xAxis:{type:'category',data:['阶段甲','阶段乙']},yAxis:{type:'value',min:0,max:40},series:[{type:'bar',data:[20,30],barMaxWidth:80,label:{show:true,position:'top'}}]}},
      {id:'test-lines',sourceIds:['test-source'],unit:'测试单位',period:'阶段甲至丙',scope:'合成数据，非消费者调查',option:{grid:{left:48,right:35,top:35,bottom:38},xAxis:{type:'category',data:['甲','乙','丙']},yAxis:{type:'value',min:0,max:40},series:[{type:'line',data:[10,25,20],label:{show:true,position:'top'},symbolSize:8}]}}
    ],
    pages:[
      {...base,id:'p1',section:'宏观研究示例',title:'合成数据用于检查比较图的阅读效果',subtitle:'仅为技术样本，不是客户调研报告。',layout:'two-one',blocks:[{type:'chart',chartId:'test-bars',title:'两个阶段的测试值'},{type:'text',title:'对照条件',text:'同一指标采用相同单位呈现。真实研究中，应先核对时间与样本，再解释差异。'}],takeaway:'测试图表和解释文字在同页呈现，数值并不对应真实市场。'},
      {...base,id:'p2',section:'消费者研究示例',title:'横轴与数据口径决定图表能说明什么',subtitle:'折线图样例：测试阶段序列，不是消费趋势。',layout:'two-one',blocks:[{type:'chart',chartId:'test-lines',title:'三个阶段的测试值'},{type:'text',title:'解释边界',text:'测试时关注标签、轴线、数值和页面适配。真实研究不能因为连接了三个点，就将横截面描述成长期趋势。'}],takeaway:'先确定数据含义，再决定图表形式。'},
      {...base,id:'p3',section:'证据与建议示例',title:'资料、判断和建议保持清楚的对应关系',subtitle:'图像为测试像素，表格为方法示例，不代表商品或消费者事实。',layout:'two-one',blocks:[{type:'image',file:'测试像素.png',alt:'技术验收测试像素',caption:'该图仅验证图片可被内嵌。'},{type:'table',headers:['层次','说明'],rows:[['资料','可追溯到来源'],['判断','解释资料的商业含义'],['建议','说明对客户的适用条件']]}],takeaway:'单文件能力通过技术测试后，仍需另行检查真实研究质量。'}
    ],attachments:[]};
  fs.writeFileSync(path.join(root,'报告.json'),JSON.stringify(config,null,2));
  return config;
}
module.exports={makeFixture};
if(require.main===module){if(!process.argv[2])throw new Error('请提供测试项目目录');makeFixture(path.resolve(process.argv[2]));}
