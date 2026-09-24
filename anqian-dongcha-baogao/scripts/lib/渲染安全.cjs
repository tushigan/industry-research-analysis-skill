"use strict";
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, x => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[x]));
}
function jsonScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
function staticScript(value = "") {
  return String(value).replace(/<\/script/gi, "<\\/script");
}
function sourceLink(source) {
  const label = escapeHTML(`${source.source_id} ${source.title}`);
  try {
    const url = new URL(source.original_url_or_file);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) {
      return `<a href="${escapeHTML(url.href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    }
  } catch {}
  return `<span>${label}</span>`;
}
module.exports = { escapeHTML, jsonScript, staticScript, sourceLink };
