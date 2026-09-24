const fs = require('node:fs');
const path = require('node:path');
const { localFile } = require('./输入安全.cjs');
const { python } = require('./运行依赖.cjs');

function prepareAttachments(report, root) {
  const ids = new Set();
  return report.attachments.map(item => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item.attachment_id) || ids.has(item.attachment_id)) {
      throw new Error('附件编号无效或重复');
    }
    ids.add(item.attachment_id);
    if (item.share_approved !== true || !item.share_basis?.trim()) throw new Error('附件未获分享批准或缺少批准依据');
    if (item.format !== 'pdf' || !Number.isInteger(item.page_count) || item.page_count < 1) throw new Error('附件格式或页数错误');
    const file = localFile(root, item.path);
    if (path.extname(file).toLowerCase() !== '.pdf') throw new Error('只支持 PDF 附件');
    const bytes = fs.readFileSync(file);
    if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('附件不是真实 PDF');
    const details = JSON.parse(python(['-c', 'import sys,json,pymupdf; d=pymupdf.open(sys.argv[1]); print(json.dumps({"pages":len(d),"encrypted":d.needs_pass}))', file]));
    if (details.encrypted || details.pages !== item.page_count) throw new Error('附件加密或实际页数与声明不一致');
    if (!Array.isArray(item.referenced_pages) || item.referenced_pages.some(p => !Number.isInteger(p) || p < 1 || p > details.pages)) {
      throw new Error('附件引用页超出真实范围');
    }
    return { ...item, data_base64: bytes.toString('base64') };
  });
}
function prepareImages(report, root) {
  const { imageMime } = require('./图片格式.cjs');
  const result = structuredClone(report);
  for (const page of result.pages) {
    if (!page.image) continue;
    if (page.image.data_uri) throw new Error('输入不得绕过本地图片边界注入 data_uri');
    const file = localFile(root, page.image.path);
    const bytes = fs.readFileSync(file);
    const mime = imageMime(bytes);
    if (!page.image.alt?.trim()) throw new Error('图片缺少替代文字');
    page.image.data_uri = `data:${mime};base64,${bytes.toString('base64')}`;
  }
  return result;
}
function pdfResources() {
  const root = path.resolve(__dirname, '../../assets/依赖/PDF阅读器');
  const result = {};
  for (const [dir, kind] of [['cmaps', 'cMapUrl'], ['standard_fonts', 'standardFontDataUrl']]) {
    result[kind] = {};
    const folder = path.join(root, dir);
    if (!fs.existsSync(folder)) continue;
    for (const name of fs.readdirSync(folder)) {
      if (!name.startsWith('LICENSE')) result[kind][name] = fs.readFileSync(path.join(folder, name)).toString('base64');
    }
  }
  return result;
}
module.exports = { prepareAttachments, prepareImages, pdfResources };
