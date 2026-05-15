// Mermaid CDN + theme-aware re-render + pan/zoom + expand modal
export const MERMAID_SCRIPT = `<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

const darkVars = {
  background: '#181818', mainBkg: '#2e3a50', primaryColor: '#2e3a50',
  primaryTextColor: '#d4d4d4', primaryBorderColor: '#3d5a90',
  lineColor: '#888888', secondaryColor: '#202020', tertiaryColor: '#2a2a2a',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
};
function mermaidConfig(dark) {
  return { startOnLoad: false, theme: dark ? 'base' : 'default',
           themeVariables: dark ? darkVars : {} };
}

// ── Modal setup ──────────────────────────────────────────────────────
const modal = document.createElement('div');
modal.id = 'ssg-diagram-modal';
modal.hidden = true;
modal.innerHTML =
  '<div id="ssg-diagram-overlay"></div>' +
  '<div id="ssg-diagram-content"><button id="ssg-diagram-close">✕</button></div>';
document.body.appendChild(modal);

const modalContent = modal.querySelector('#ssg-diagram-content');
const modalOverlay = modal.querySelector('#ssg-diagram-overlay');
const modalClose  = modal.querySelector('#ssg-diagram-close');
let mp = { s: 1, tx: 0, ty: 0, pan: false, ox: 0, oy: 0 };

function applyModal(svg) {
  svg.style.transformOrigin = '0 0';
  svg.style.transform = \`translate(\${mp.tx}px,\${mp.ty}px) scale(\${mp.s})\`;
}
function openModal(srcEl) {
  const svg = srcEl.querySelector('svg');
  if (!svg) return;
  const old = modalContent.querySelector('svg');
  if (old) old.remove();
  const clone = svg.cloneNode(true);
  clone.removeAttribute('style');
  clone.style.maxWidth = 'none';
  modalContent.appendChild(clone);
  mp = { s: 1, tx: 0, ty: 0, pan: false, ox: 0, oy: 0 };
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeModal() { modal.hidden = true; document.body.style.overflow = ''; }

modalOverlay.addEventListener('click', closeModal);
modalClose.addEventListener('click', closeModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

modalContent.addEventListener('wheel', e => {
  e.preventDefault();
  const svg = modalContent.querySelector('svg');
  if (!svg) return;
  mp.s = Math.max(0.2, Math.min(mp.s * (e.deltaY < 0 ? 1.1 : 0.9), 8));
  applyModal(svg);
}, { passive: false });
modalContent.addEventListener('mousedown', e => {
  mp.pan = true; mp.ox = e.clientX - mp.tx; mp.oy = e.clientY - mp.ty;
  modalContent.style.cursor = 'grabbing';
});
window.addEventListener('mousemove', e => {
  if (!mp.pan) return;
  const svg = modalContent.querySelector('svg');
  if (!svg) return;
  mp.tx = e.clientX - mp.ox; mp.ty = e.clientY - mp.oy;
  applyModal(svg);
});
window.addEventListener('mouseup', () => { mp.pan = false; modalContent.style.cursor = 'grab'; });
modalContent.addEventListener('dblclick', () => {
  const svg = modalContent.querySelector('svg');
  if (svg) svg.style.transform = '';
  mp = { ...mp, s: 1, tx: 0, ty: 0 };
});

// ── Pan/zoom + expand button setup (called after each render) ────────
function setupPanZoom(el) {
  if (el.dataset.panzoom) {
    if (el._pzState) Object.assign(el._pzState, { s: 1, tx: 0, ty: 0, pan: false });
    if (el._expandBtn) el.appendChild(el._expandBtn);
    return;
  }
  el.dataset.panzoom = '1';

  const st = { s: 1, tx: 0, ty: 0, pan: false, ox: 0, oy: 0 };
  el._pzState = st;

  const apply = () => {
    const svg = el.querySelector('svg');
    if (!svg) return;
    svg.style.transformOrigin = '0 0';
    svg.style.transform = \`translate(\${st.tx}px,\${st.ty}px) scale(\${st.s})\`;
  };
  el.title = 'Scroll to zoom · Drag to pan · Double-click to reset';
  el.addEventListener('wheel', e => {
    e.preventDefault();
    st.s = Math.max(0.2, Math.min(st.s * (e.deltaY < 0 ? 1.1 : 0.9), 8));
    apply();
  }, { passive: false });
  el.addEventListener('mousedown', e => {
    st.pan = true; st.ox = e.clientX - st.tx; st.oy = e.clientY - st.ty;
    el.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', e => {
    if (!st.pan) return;
    st.tx = e.clientX - st.ox; st.ty = e.clientY - st.oy;
    apply();
  });
  window.addEventListener('mouseup', () => { st.pan = false; el.style.cursor = 'grab'; });
  el.addEventListener('dblclick', () => {
    st.s = 1; st.tx = 0; st.ty = 0;
    const svg = el.querySelector('svg'); if (svg) svg.style.transform = '';
  });

  const btn = document.createElement('button');
  btn.className = 'mermaid-expand-btn';
  btn.textContent = '⛶';
  btn.title = 'Expand diagram';
  btn.onclick = e => { e.stopPropagation(); openModal(el); };
  el._expandBtn = btn;
  el.appendChild(btn);
}

// ── Initial render ───────────────────────────────────────────────────
const savedTheme = document.documentElement.dataset.theme;
const dark = savedTheme ? savedTheme === 'dark'
                        : window.matchMedia('(prefers-color-scheme: dark)').matches;
mermaid.initialize(mermaidConfig(dark));

document.querySelectorAll('.mermaid').forEach(el => {
  el.dataset.src = el.textContent.trim();
});
await mermaid.run();
document.querySelectorAll('.mermaid').forEach(el => setupPanZoom(el));

// ── Re-render on theme toggle (called by ssgToggleTheme) ─────────────
window.ssgReRenderDiagrams = async function(isDark) {
  mermaid.initialize(mermaidConfig(isDark));
  const els = Array.from(document.querySelectorAll('.mermaid'));
  els.forEach(el => {
    el.removeAttribute('data-processed');
    el.textContent = el.dataset.src || '';
  });
  await mermaid.run({ nodes: els });
  els.forEach(el => setupPanZoom(el));
};
</script>`;

// Runs synchronously before first paint — applies saved theme to avoid flash
export const THEME_INIT_SCRIPT = `<script>
(function(){
  var t = localStorage.getItem('ssg-theme');
  if (t) document.documentElement.dataset.theme = t;
})();
</script>`;

// Defines ssgToggleTheme() and corrects initial button icon after THEME_INIT_SCRIPT has run
export const THEME_TOGGLE_SCRIPT = `<script>
function ssgToggleTheme() {
  var html = document.documentElement;
  var current = html.dataset.theme ||
    (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
  var next = current === 'dark' ? 'light' : 'dark';
  html.dataset.theme = next;
  localStorage.setItem('ssg-theme', next);
  document.getElementById('ssg-theme-btn').textContent = next === 'dark' ? '☀' : '☽';
  if (typeof window.ssgReRenderDiagrams === 'function') {
    window.ssgReRenderDiagrams(next === 'dark');
  }
}
(function(){
  var saved = localStorage.getItem('ssg-theme');
  var dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches;
  var btn = document.getElementById('ssg-theme-btn');
  if (btn) btn.textContent = dark ? '☀' : '☽';
})();
</script>`;

// Design tokens match packages/app-episteme/src/styles/base.css (dark) with
// a light-mode override. Typography rules ported from markdown.css.
export const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#181818;--bg-raised:#202020;--bg-highlight:#2a2a2a;--bg-active:#2e3a50;
  --border:#333333;--border-light:#3d3d3d;
  --text:#d4d4d4;--text-muted:#888888;--text-dim:#555555;
  --accent:#6699dd;--accent-soft:#3d5a90;
  --md-scale-xs:0.75rem;--md-scale-sm:0.857rem;--md-scale-base:1rem;
  --md-scale-h3:1.125rem;--md-scale-h2:1.286rem;--md-scale-h1:1.5rem;
  --md-leading-heading:1.25;--md-leading-body:1.72;--md-leading-code:1.6;
  --md-sp1:0.25rem;--md-sp2:0.5rem;--md-sp3:0.875rem;--md-sp4:1.25rem;--md-sp5:2rem;
  --md-indent:1.5em;
  --md-font-mono:"JetBrains Mono","Fira Code",ui-monospace,monospace;
  --md-code-size:0.857em;--md-radius-sm:3px;--md-radius-md:5px;
  --max-w:720px;
}
@media(prefers-color-scheme:light){
  :root:not([data-theme="dark"]){
    --bg:#ffffff;--bg-raised:#f3f3f3;--bg-highlight:#ebebeb;--bg-active:#dce8ff;
    --border:#e0e0e0;--border-light:#eeeeee;
    --text:#1c1c1c;--text-muted:#666666;--text-dim:#aaaaaa;
    --accent:#2d5fcc;--accent-soft:#d0e4ff;
  }
}
:root[data-theme="light"]{
  --bg:#ffffff;--bg-raised:#f3f3f3;--bg-highlight:#ebebeb;--bg-active:#dce8ff;
  --border:#e0e0e0;--border-light:#eeeeee;
  --text:#1c1c1c;--text-muted:#666666;--text-dim:#aaaaaa;
  --accent:#2d5fcc;--accent-soft:#d0e4ff;
}
body{
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  font-size:14px;background:var(--bg);color:var(--text);
  line-height:var(--md-leading-body);padding:2rem 1.5rem;
}

/* ── Nav ─────────────────────────────────────────────────────────────── */
nav{display:flex;align-items:center;max-width:var(--max-w);margin:0 auto 2rem}
.nav-links{display:flex;align-items:center;gap:0.5rem;font-size:var(--md-scale-sm)}
.nav-links a{color:var(--accent);text-decoration:none}
.nav-links a:hover{text-decoration:underline}
#ssg-theme-btn{
  margin-left:auto;background:none;cursor:pointer;
  border:1px solid var(--border);border-radius:var(--md-radius-sm);
  color:var(--text-muted);padding:0.2rem 0.5rem;font-size:var(--md-scale-sm);
  line-height:1
}
#ssg-theme-btn:hover{color:var(--text);border-color:var(--border-light)}

/* ── Page content ────────────────────────────────────────────────────── */
article{max-width:var(--max-w);margin:0 auto}
header{margin-bottom:var(--md-sp4);padding-bottom:var(--md-sp3);border-bottom:1px solid var(--border)}

/* ── Headings — ported from markdown.css ────────────────────────────── */
article h1,article h2,article h3,article h4,article h5,article h6{
  color:var(--text);margin-top:var(--md-sp4);margin-bottom:var(--md-sp2)
}
article :is(h1,h2,h3,h4,h5,h6):first-child{margin-top:0}
article h1{font-size:var(--md-scale-h1);font-weight:700;line-height:1.15;letter-spacing:-0.015em}
article h2{font-size:var(--md-scale-h2);font-weight:700;line-height:1.2;letter-spacing:-0.01em}
article h3{font-size:var(--md-scale-h3);font-weight:600;line-height:var(--md-leading-heading)}
article h4,article h5,article h6{font-size:var(--md-scale-base);font-weight:600;line-height:1.3}
article h2+h3{margin-top:var(--md-sp2)}

/* ── Prose ───────────────────────────────────────────────────────────── */
article p{margin-top:0;margin-bottom:var(--md-sp3)}
article p:last-child{margin-bottom:0}
article a{color:var(--accent);text-decoration:none}
article a:hover{text-decoration:underline}
article strong{font-weight:600;color:var(--text)}
article em{font-style:italic}

/* ── Lists ───────────────────────────────────────────────────────────── */
article ul,article ol{padding-left:var(--md-indent);margin:0 0 var(--md-sp3)}
article ul{list-style-type:disc}
article ul ul{list-style-type:square}
article ol{list-style-type:decimal}
article li{margin-bottom:0.35rem;line-height:var(--md-leading-body)}
article li:last-child{margin-bottom:0}
article li>ul>li,article li>ol>li{margin-bottom:var(--md-sp1)}
article li>ul,article li>ol{margin-top:var(--md-sp1);margin-bottom:0}

/* ── Code ────────────────────────────────────────────────────────────── */
article code{
  font-family:var(--md-font-mono);font-size:var(--md-code-size);
  background:var(--bg-highlight);padding:0.1em 0.35em;
  border-radius:var(--md-radius-sm);line-height:1
}
article pre{
  background:var(--bg-highlight);border:1px solid var(--border);
  border-radius:var(--md-radius-md);padding:var(--md-sp3);
  overflow-x:auto;margin-bottom:var(--md-sp3);line-height:var(--md-leading-code)
}
article pre code{background:none;padding:0;border-radius:0}

/* ── Blockquote ──────────────────────────────────────────────────────── */
article blockquote{
  border-left:2px solid var(--accent-soft);padding-left:var(--md-sp3);
  color:var(--text-muted);margin:0 0 var(--md-sp3);font-style:italic
}
article blockquote>*:last-child{margin-bottom:0}

/* ── HR ──────────────────────────────────────────────────────────────── */
article hr{border:none;border-top:1px solid var(--border);margin:var(--md-sp5) 0}

/* ── Tables ──────────────────────────────────────────────────────────── */
article table{border-collapse:collapse;width:100%;font-size:var(--md-scale-sm);
  line-height:1.5;margin-bottom:var(--md-sp3)}
article th,article td{border:1px solid var(--border);padding:var(--md-sp2) var(--md-sp3);
  text-align:left;vertical-align:top}
article th{background:var(--bg-highlight);font-weight:600;color:var(--text);white-space:nowrap}

/* ── Images ──────────────────────────────────────────────────────────── */
article img{max-width:100%;height:auto;border-radius:var(--md-radius-md)}

/* ── Wikilinks ───────────────────────────────────────────────────────── */
.wikilink-broken{color:var(--text-muted);border-bottom:1px dashed currentColor;cursor:help}

/* ── Mermaid diagrams ────────────────────────────────────────────────── */
.mermaid{
  overflow:hidden;position:relative;cursor:grab;user-select:none;
  background:var(--bg-raised);border:1px solid var(--border);
  border-radius:var(--md-radius-md);padding:var(--md-sp3);
  margin-bottom:var(--md-sp3);min-height:60px
}
.mermaid svg{display:block;max-width:100%}
.mermaid-expand-btn{
  position:absolute;top:8px;right:8px;z-index:1;
  background:var(--bg-highlight);border:1px solid var(--border);
  border-radius:var(--md-radius-sm);color:var(--text-muted);
  cursor:pointer;padding:0.2rem 0.5rem;font-size:var(--md-scale-xs);
  line-height:1;opacity:0;transition:opacity 0.15s
}
.mermaid:hover .mermaid-expand-btn{opacity:1}
#ssg-diagram-modal{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center}
#ssg-diagram-modal[hidden]{display:none}
#ssg-diagram-overlay{position:absolute;inset:0;background:rgba(0,0,0,0.6)}
#ssg-diagram-content{
  position:relative;z-index:1;width:90vw;height:80vh;
  background:var(--bg-raised);border:1px solid var(--border);
  border-radius:var(--md-radius-md);overflow:hidden;
  cursor:grab;user-select:none
}
#ssg-diagram-content svg{display:block;max-width:none}
#ssg-diagram-close{
  position:absolute;top:8px;right:8px;z-index:2;
  background:var(--bg-highlight);border:1px solid var(--border);
  border-radius:var(--md-radius-sm);color:var(--text-muted);
  cursor:pointer;padding:0.2rem 0.5rem;line-height:1
}
#ssg-diagram-close:hover{color:var(--text);border-color:var(--border-light)}

/* ── Page header meta ────────────────────────────────────────────────── */
time{display:block;color:var(--text-muted);font-size:var(--md-scale-sm);margin-bottom:var(--md-sp2)}
.summary{color:var(--text-muted);font-style:italic;margin-bottom:var(--md-sp2)}
.tags{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:0.4rem;margin-bottom:var(--md-sp2)}
.tags li a{
  display:inline-block;background:var(--bg-raised);color:var(--text-muted);
  border-radius:10px;padding:0.15rem 0.6rem;font-size:var(--md-scale-xs);text-decoration:none
}
.tags li a:hover{background:var(--accent);color:var(--bg)}

/* ── Tags details/summary toggle ────────────────────────────────────── */
details.tags-section{margin-bottom:var(--md-sp4)}
details.tags-section summary{
  display:flex;align-items:center;gap:0.4rem;cursor:pointer;user-select:none;
  list-style:none;font-size:var(--md-scale-xs);font-weight:600;
  text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim);
  margin-bottom:0;padding:var(--md-sp2) 0
}
details.tags-section summary::-webkit-details-marker{display:none}
details.tags-section summary::before{
  content:'▶';font-size:0.65em;flex-shrink:0;transition:transform 0.15s
}
details.tags-section[open] summary::before{transform:rotate(90deg)}
details.tags-section summary:hover{color:var(--text-muted)}
details.tags-section[open] summary{margin-bottom:var(--md-sp2)}

/* ── File listing (index / tag pages) ───────────────────────────────── */
.file-list{list-style:none;padding:0}
.file-list li{padding:var(--md-sp2) 0;border-bottom:1px solid var(--border)}
.file-list li:last-child{border-bottom:none}
.file-list a{text-decoration:none;color:var(--accent);font-weight:500}
.file-list a:hover{text-decoration:underline}
.file-meta{font-size:var(--md-scale-xs);color:var(--text-muted);margin-top:0.15rem}
.section-header{
  font-size:var(--md-scale-xs);font-weight:600;text-transform:uppercase;
  letter-spacing:0.08em;color:var(--text-dim);margin:var(--md-sp4) 0 var(--md-sp2)
}
.tag-cloud{display:flex;flex-wrap:wrap;gap:0.5rem;margin-bottom:var(--md-sp4)}
.tag-cloud a{
  display:inline-flex;align-items:center;gap:0.3rem;background:var(--bg-raised);
  color:var(--text-muted);border-radius:10px;padding:0.25rem 0.75rem;
  font-size:var(--md-scale-sm);text-decoration:none
}
.tag-cloud a:hover{background:var(--accent);color:var(--bg)}
.tag-count{opacity:0.65;font-size:0.8em}
`.trim();
