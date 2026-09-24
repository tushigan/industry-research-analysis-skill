'use strict';

async function ready(page) {
  await page.waitForFunction(() => window.reportReady === true);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every(img => img.complete));
  await page.waitForTimeout(250);
}

async function layout(page) {
  return page.evaluate(() => {
    const visible = el => el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden';
    return {bodyOverflow:document.documentElement.scrollWidth > innerWidth + 1, pages:[...document.querySelectorAll('.page')].map(p => {
      const r = p.getBoundingClientRect(), footer = p.querySelector('footer'), fr = footer?.getBoundingClientRect();
      const issues = [];
      if (p.scrollWidth > p.clientWidth + 1 || p.scrollHeight > p.clientHeight + 1) issues.push('页面内容超出边界');
      if (fr && fr.bottom > r.bottom + 1) issues.push('页脚超出页面');
      const header = p.querySelector('header')?.getBoundingClientRect();
      const body = p.querySelector('.body')?.getBoundingClientRect();
      const takeaway = p.querySelector('.takeaway')?.getBoundingClientRect();
      if (header && body && header.bottom > body.top + 1) issues.push('标题与正文重叠');
      if (body && takeaway && body.bottom > takeaway.top + 1) issues.push('正文与结论重叠');
      if (takeaway && fr && takeaway.bottom > fr.top + 1) issues.push('结论与页脚重叠');
      const textRects = [], walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode, el = node.parentElement;
        if (!node.textContent.trim() || !el || el.closest('svg,script,style') || !visible(el)) continue;
        const range = document.createRange();range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (!rect.width || !rect.height) continue;
          const label = node.textContent.trim().slice(0, 30);
          if (rect.left < r.left - 1 || rect.right > r.right + 1 || rect.bottom > r.bottom + 1) issues.push('文字越界：' + label);
          if (fr && !footer.contains(node) && rect.bottom > fr.top + 1) issues.push('文字侵入页脚：' + label);
          const block = el.closest('p,h1,h2,h3,li,td,th,figcaption,.takeaway,.mast,footer');
          if (block && getComputedStyle(block).overflow !== 'visible') {
            const br = block.getBoundingClientRect();
            if (rect.right > br.right + 1 || rect.bottom > br.bottom + 1) issues.push('文字被容器裁切：' + label);
          }
          textRects.push({node,rect,label});
        }
      }
      // 比较真实文字行框，避免只检查容器存在却漏掉卡片中文字互相覆盖。
      for (let i = 0; i < textRects.length; i++) for (let j = i + 1; j < textRects.length; j++) {
        const a = textRects[i], b = textRects[j];
        if (a.node === b.node) continue;
        const x = Math.min(a.rect.right,b.rect.right)-Math.max(a.rect.left,b.rect.left);
        const y = Math.min(a.rect.bottom,b.rect.bottom)-Math.max(a.rect.top,b.rect.top);
        if (x > 2 && y > 3) issues.push('文字重叠：' + a.label + ' / ' + b.label);
      }
      return {id:p.id,issues:[...new Set(issues)]};
    })};
  });
}

async function charts(page, ids) {
  return page.evaluate(async ids => {
    const result = [];
    for (const id of ids) {
      const el = document.getElementById(id), svg = el?.querySelector('svg');
      if (!svg) {result.push({id,ok:false,reason:'没有SVG'});continue;}
      const rect = svg.getBoundingClientRect();
      const copy = svg.cloneNode(true);copy.setAttribute('xmlns','http://www.w3.org/2000/svg');
      const serialized = new XMLSerializer().serializeToString(copy);
      const img = new Image();img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(serialized);
      await img.decode();
      const canvas = document.createElement('canvas');canvas.width = Math.max(1,Math.round(rect.width));canvas.height = Math.max(1,Math.round(rect.height));
      const ctx = canvas.getContext('2d');ctx.fillStyle = '#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
      const pixels = ctx.getImageData(0,0,canvas.width,canvas.height).data;
      let marked = 0;
      for (let i = 0; i < pixels.length; i += 16) if (pixels[i] < 240 || pixels[i+1] < 240 || pixels[i+2] < 240) marked++;
      result.push({id,ok:rect.width > 0 && rect.height > 0 && marked > 10,marked,width:rect.width,height:rect.height,svg:serialized});
    }
    return result;
  }, ids);
}

module.exports = {ready, layout, charts};
