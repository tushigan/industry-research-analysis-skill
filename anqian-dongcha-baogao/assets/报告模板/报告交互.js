(() => {
  "use strict";
  const data = window.REPORT_DATA || {};
  const config = window.REPORT_CONFIG || {};
  const presenterEnabled = config.presenter !== false;
  const notes = Array.isArray(window.PAGE_NOTES) ? window.PAGE_NOTES : [];
  const params = new URLSearchParams(location.search);
  const isPresenter = presenterEnabled && params.has("presenter");
  const embedded = params.has("embed");
  const pages = [...document.querySelectorAll(".page")];
  const count = pages.length;
  const namespace = String(config.namespace || location.pathname);
  document.querySelectorAll('[data-action="presenter"]').forEach(button => button.hidden = !presenterEnabled);
  const font = "PingFang SC, Microsoft YaHei, sans-serif";
  const colors = {green:"#148565",mint:"#94c5ad",coral:"#df715b",line:"#e4ece6",ink:"#18342e",muted:"#62736c"};
  const charts = [];
  let current = Math.max(0, Math.min(count - 1, Number(params.get("page")) || 0));
  let suppressScrollUntil = 0;
  let channel;
  if (!embedded) {
    try { channel = new BroadcastChannel(namespace); } catch {}
  }
  document.querySelectorAll("[data-source]").forEach(link => {
    const url = (data.sources || {})[link.dataset.source];
    if (url) { link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; }
  });
  document.querySelectorAll("table").forEach(table => {
    const headers = [...table.querySelectorAll("thead th")].map(th => th.innerText.replace(/\s+/g," ").trim());
    table.querySelectorAll("tbody tr").forEach(row => {
      let col = 0;
      [...row.children].forEach(cell => {
        if (cell.tagName === "TD") cell.dataset.label = headers[col] || "";
        col += Number(cell.getAttribute("colspan")) || 1;
      });
    });
  });
  function mount(id, option) {
    const el = document.getElementById(id);
    if (!el || el.offsetWidth === 0 || !window.echarts) return;
    const instance = echarts.init(el, null, {renderer:"svg"});
    instance.setOption({
      animation:false,
      color:[colors.green,colors.coral,"#b99b45",colors.mint],
      textStyle:{fontFamily:font,color:colors.muted},
      tooltip:{trigger:"axis",axisPointer:{type:"shadow"},textStyle:{fontFamily:font,fontSize:12}},
      ...option
    });
    el.setAttribute("role","img");
    charts.push({id,instance});
  }
  function renderCharts() {
    (Array.isArray(data.charts) ? data.charts : []).forEach(({id, option}) => mount(id, option));
  }
  function updateCounters() {
    document.getElementById("page-num").textContent=(count ? current+1 : 0)+" / "+count;
    document.querySelectorAll('[data-action="prev"]').forEach(b=>b.disabled=current===0);
    document.querySelectorAll('[data-action="next"]').forEach(b=>b.disabled=current===count-1);
  }
  function broadcast() {
    if (embedded) return;
    const message={page:current,time:Date.now()};
    channel?.postMessage(message);
    try { localStorage.setItem(namespace+"-sync",JSON.stringify(message)); } catch {}
  }
  function go(index, send=true) {
    if (!Number.isFinite(index) || !count) return;
    current=Math.max(0,Math.min(count-1,Math.round(index)));
    suppressScrollUntil=Date.now()+300;
    if (isPresenter) updatePresenter();
    else if (!embedded) pages[current].scrollIntoView({behavior:"instant",block:"start"});
    updateCounters();
    if (send) broadcast();
  }
  if (channel) channel.onmessage=e=>{
    if (Number.isInteger(e.data?.page)) go(e.data.page,false);
  };
  if (!embedded) window.addEventListener("storage",e=>{
    if (e.key!==namespace+"-sync"||!e.newValue) return;
    try { const state=JSON.parse(e.newValue); if(Number.isInteger(state.page)) go(state.page,false); } catch {}
  });
  function act(action) {
    if(action==="prev")go(current-1);
    if(action==="next")go(current+1);
    if(action==="print")window.print();
    if(action==="full"){
      const promise=document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();
      promise?.catch(()=>{});
    }
    if(action==="presenter" && presenterEnabled){
      const url=new URL(location.href);url.search="?presenter=1&page="+current;
      window.open(url.href,namespace+"-presenter","width=1250,height=850,resizable=yes");
    }
  }
  document.querySelectorAll("[data-action]").forEach(button=>button.addEventListener("click",()=>act(button.dataset.action)));
  window.addEventListener("keydown",event=>{
    if(embedded||document.querySelector("dialog[open]")||event.target.closest("input,textarea,[contenteditable=true]"))return;
    if(["ArrowRight","PageDown"].includes(event.key)){event.preventDefault();go(current+1);}
    if(["ArrowLeft","PageUp"].includes(event.key)){event.preventDefault();go(current-1);}
    if(event.key==="Home"){event.preventDefault();go(0);}
    if(event.key==="End"){event.preventDefault();go(count-1);}
  });
  let deskFrames=[];
  function updatePresenter(){
    deskFrames.forEach((frame,index)=>{
      const url=new URL(location.href);url.search="?embed=1&page="+Math.min(current+index,count-1);
      if(frame.src!==url.href)frame.src=url.href;
    });
    const text=document.getElementById("notes-text");
    if(text)text.textContent=notes[current]||"";
    const counter=document.getElementById("desk-page");
    if(counter)counter.textContent=(current+1)+" / "+count;
    const previous=document.getElementById("desk-prev"),next=document.getElementById("desk-next");
    if(previous)previous.disabled=current===0;
    if(next)next.disabled=current===count-1;
    const label=document.querySelector("#next-panel h2");
    if(label)label.textContent=current===count-1?"最后一页":"下一页";
  }
  function presenter(){
    document.body.classList.add("presenter");
    const html=[
      '<div class="desk-bar"><strong id="desk-title"></strong><span id="desk-page"></span>',
      '<button title="上一页" aria-label="上一页" id="desk-prev"><i data-lucide="chevron-left"></i></button>',
      '<button title="下一页" aria-label="下一页" id="desk-next"><i data-lucide="chevron-right"></i></button>',
      '<span id="timer">00:00</span><button id="timer-run" title="开始计时" aria-label="开始计时"><i data-lucide="play"></i></button>',
      '<button title="计时归零" aria-label="计时归零" id="timer-reset"><i data-lucide="rotate-ccw"></i></button>',
      '<button title="恢复默认布局" aria-label="恢复默认布局" id="layout-reset"><i data-lucide="layout-dashboard"></i></button></div>',
      '<div class="desk"><div class="desk-panel" id="current-panel"><h2>当前页</h2><div class="framewrap"><iframe title="当前页"></iframe></div></div>',
      '<div class="desk-panel" id="next-panel"><h2>下一页</h2><div class="framewrap"><iframe title="下一页"></iframe></div></div>',
      '<div class="desk-panel" id="notes-panel"><h2>讲解备注</h2><div id="notes-text"></div></div></div>'
    ].join("");
    document.body.insertAdjacentHTML("beforeend",html);
    document.getElementById("desk-title").textContent = String(config.title || document.title) + " · 演讲者视图";
    deskFrames=[...document.querySelectorAll(".framewrap iframe")];
    const panels=[...document.querySelectorAll(".desk-panel")];
    const desk=document.querySelector(".desk");
    const layoutKey=namespace+"-layout";
    function defaults(){
      const width=innerWidth;
      const previewHeight=Math.min(410,innerHeight*.48);
      return [
        {left:12,top:12,width:width*.60-18,height:previewHeight},
        {left:width*.60+6,top:12,width:width*.40-18,height:Math.min(300,previewHeight)},
        {left:12,top:previewHeight+24,width:width-24,height:Math.max(160,innerHeight-previewHeight-94)}
      ];
    }
    function validLayout(layout){
      return Array.isArray(layout)&&layout.length===3&&layout.every(item=>["left","top","width","height"].every(key=>Number.isFinite(item[key])));
    }
    function applyLayout(layout){
      panels.forEach((panel,index)=>{
        const item=layout[index];
        const width=Math.min(Math.max(220,item.width),desk.clientWidth);
        const height=Math.min(Math.max(140,item.height),desk.clientHeight);
        const bounded={width,height,left:Math.min(Math.max(0,item.left),Math.max(0,desk.clientWidth-width)),top:Math.min(Math.max(0,item.top),Math.max(0,desk.clientHeight-height))};
        Object.entries(bounded).forEach(([key,value])=>panel.style[key]=value+"px");
      });
    }
    let saveTimeout;
    function save(){
      clearTimeout(saveTimeout);
      saveTimeout=setTimeout(()=>{
        try{localStorage.setItem(layoutKey,JSON.stringify(panels.map(panel=>({left:panel.offsetLeft,top:panel.offsetTop,width:panel.offsetWidth,height:panel.offsetHeight}))));}catch{}
      },80);
    }
    let saved;
    try{saved=JSON.parse(localStorage.getItem(layoutKey));}catch{}
    applyLayout(validLayout(saved)?saved:defaults());
    panels.forEach(panel=>{
      panel.addEventListener("pointerdown",()=>{
        panels.forEach(other=>other.style.zIndex="");
        panel.style.zIndex="1";
      });
      const handle=panel.querySelector("h2");
      handle.onpointerdown=event=>{
        event.preventDefault();
        const x=event.clientX,y=event.clientY,left=panel.offsetLeft,top=panel.offsetTop;
        handle.setPointerCapture(event.pointerId);
        handle.onpointermove=move=>{
          panel.style.left=Math.min(Math.max(0,left+move.clientX-x),Math.max(0,desk.clientWidth-panel.offsetWidth))+"px";
          panel.style.top=Math.min(Math.max(0,top+move.clientY-y),Math.max(0,desk.clientHeight-panel.offsetHeight))+"px";
        };
        const finish=()=>{handle.onpointermove=null;handle.onpointerup=null;handle.onpointercancel=null;save();};
        handle.onpointerup=finish;handle.onpointercancel=finish;
      };
      new ResizeObserver(()=>{
        const wrap=panel.querySelector(".framewrap");
        if(wrap)wrap.querySelector("iframe").style.transform="scale("+Math.min(wrap.clientWidth/1440,wrap.clientHeight/810)+")";
        save();
      }).observe(panel);
    });
    document.getElementById("layout-reset").onclick=()=>{applyLayout(defaults());save();};
    document.getElementById("desk-prev").onclick=()=>go(current-1);
    document.getElementById("desk-next").onclick=()=>go(current+1);
    window.addEventListener("resize",()=>applyLayout(panels.map(panel=>({left:panel.offsetLeft,top:panel.offsetTop,width:panel.offsetWidth,height:panel.offsetHeight}))));
    const timerKey=namespace+"-timer";
    let timer={running:false,elapsed:0,started:0};
    try{const savedTimer=JSON.parse(localStorage.getItem(timerKey));if(savedTimer&&typeof savedTimer.running==="boolean"&&Number.isFinite(savedTimer.elapsed)&&Number.isFinite(savedTimer.started))timer=savedTimer;}catch{}
    function saveTimer(){try{localStorage.setItem(timerKey,JSON.stringify(timer));}catch{}}
    const run=document.getElementById("timer-run");
    function timerButton(){
      const label=timer.running?"暂停计时":timer.elapsed?"继续计时":"开始计时";
      run.title=label;run.setAttribute("aria-label",label);
      run.innerHTML='<i data-lucide="'+(timer.running?"pause":"play")+'"></i>';
      window.lucide?.createIcons();
    }
    function displayTime(){
      const seconds=Math.floor((timer.elapsed+(timer.running?Date.now()-timer.started:0))/1000);
      document.getElementById("timer").textContent=String(Math.floor(seconds/60)).padStart(2,"0")+":"+String(seconds%60).padStart(2,"0");
    }
    run.onclick=()=>{
      if(timer.running){timer.elapsed+=Date.now()-timer.started;timer.running=false;}
      else{timer.started=Date.now();timer.running=true;}
      saveTimer();timerButton();displayTime();
    };
    document.getElementById("timer-reset").onclick=()=>{timer={running:false,elapsed:0,started:0};saveTimer();timerButton();displayTime();};
    timerButton();displayTime();setInterval(displayTime,250);
    updatePresenter();
  }
  if(isPresenter)presenter();
  else{
    if(embedded){
      document.body.classList.add("embed");
      pages.forEach((page,index)=>page.style.display=index===current?"flex":"none");
    }
    renderCharts();
    if(!embedded){
      let scrollFrame=0;
      window.addEventListener("scroll",()=>{
        if(scrollFrame)return;
        scrollFrame=requestAnimationFrame(()=>{
          scrollFrame=0;if(Date.now()<suppressScrollUntil)return;
          let index=0,distance=Infinity;
          pages.forEach((page,i)=>{const rect=page.getBoundingClientRect();const d=Math.abs(rect.top-30);if(d<distance){index=i;distance=d;}});
          if(index!==current){current=index;updateCounters();broadcast();}
        });
      },{passive:true});
      if(params.has("page"))go(current,false);
    }
    let resizeTimeout;
    window.addEventListener("resize",()=>{
      clearTimeout(resizeTimeout);resizeTimeout=setTimeout(()=>charts.forEach(({instance})=>instance.resize()),100);
    });
  }
  updateCounters();
  window.lucide?.createIcons();
  window.go=go;
  window.reportCharts=charts;
  window.reportNotes=notes;
  window.reportReady=true;
})();
