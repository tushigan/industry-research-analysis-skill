(() => {
  "use strict";
  const data = JSON.parse(document.getElementById("report-data").textContent);
  const pages = [...document.querySelectorAll("#report > .report-page")];
  window.__reportReady = false;
  window.__report = { ...(window.__report || {}), pageCount: pages.length, titles: data.titles, fingerprint: data.fingerprint,
    productionMode: data.productionMode, deliveryScope: data.deliveryScope,
    reportConfigSha256: data.reportConfigSha256, chartPlanRequired: data.chartPlanRequired,
    chartPlanSha256: data.chartPlanSha256 };
  window.__reportData = data;
  window.__reportCharts = [];
  const scale = () => document.documentElement.style.setProperty("--report-scale", Math.min(1, (innerWidth - 32) / (data.pageMode === "a4_portrait" ? 794 : 1440)));
  scale(); window.addEventListener("resize", scale);
  async function ready() {
    try {
      await document.fonts.ready;
      for (const image of document.querySelectorAll("#report img")) await image.decode();
      for (const config of data.charts) {
        const target = document.getElementById(config.id);
        const chart = window.echarts.init(target, null, { renderer: "svg" });
        chart.setOption(config.option);
        window.__reportCharts.push(chart);
        if (!target.querySelector("svg")) throw new Error(`图表未生成：${config.id}`);
      }
      window.lucide?.createIcons();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.__reportReady = true;
      document.dispatchEvent(new Event("report-ready"));
    } catch (error) {
      window.__reportError = error.message;
      const box = document.getElementById("report-error"); box.hidden = false; box.textContent = error.message;
    }
  }
  window.addEventListener("resize", () => { if (!document.body.classList.contains("presenter")) window.__reportCharts.forEach(chart => chart.resize()); });
  window.addEventListener("beforeprint", () => window.__reportCharts.forEach(chart => chart.resize()));
  ready();
})();
