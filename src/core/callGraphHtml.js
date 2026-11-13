'use strict';
/**
 * Renders a call graph (from callGraph.js) into a single self-contained HTML file
 * (no external scripts / fonts, works offline).
 */

function renderCallGraphHtml(graph, meta) {
    const data = {
        title: meta.title,
        generated: meta.generated,
        files: graph.files.map((f) => [f.rel, f.abs]),
        nodes: graph.nodes.map((n) => [n.name, n.pkg, n.kind[0], n.file, n.line, n.sig]),
        out: graph.nodes.map((n) => {
            const a = [];
            for (const [id, c] of n.out) a.push(id, c);
            return a;
        })
    };
    // keep </script> and U+2028/2029 out of the embedded JSON
    const BS = String.fromCharCode(92); // backslash
    const json = JSON.stringify(data)
        .replace(/</g, BS + 'u003c')
        .replace(new RegExp(String.fromCharCode(0x2028), 'g'), BS + 'u2028')
        .replace(new RegExp(String.fromCharCode(0x2029), 'g'), BS + 'u2029');
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Call Graph – ${esc(meta.title)}</title>
<style>
:root {
  --bg: #f7f7f5; --panel: #ffffff; --text: #1f2328; --muted: #6a737d; --border: #dcdcd7;
  --accent: #2f6fdf; --accent-soft: #e5eefc; --hover: #f0f2f5; --edge: #9aa4b2; --edge-hi: #2f6fdf;
  --caller: #b4541a; --callee: #1a7f4b; --focus-bg: #2f6fdf; --focus-text: #fff;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16181c; --panel: #1e2126; --text: #e6e6e3; --muted: #9aa0a8; --border: #33373e;
    --accent: #6ea2ff; --accent-soft: #24324a; --hover: #2a2e35; --edge: #5b6370; --edge-hi: #6ea2ff;
    --caller: #f0a06a; --callee: #5fd39a; --focus-bg: #3f7be6; --focus-text: #fff;
  }
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--text); font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; display: flex; flex-direction: column; }
header { display: flex; align-items: center; gap: 16px; padding: 10px 16px; background: var(--panel); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
header h1 { font-size: 15px; margin: 0; font-weight: 600; }
header .meta { color: var(--muted); font-size: 12px; }
#q { flex: 1; min-width: 220px; max-width: 560px; padding: 7px 10px; font: inherit; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); }
#q:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
#layout { flex: 1; display: flex; min-height: 0; }
aside { width: 340px; min-width: 240px; border-right: 1px solid var(--border); background: var(--panel); overflow: auto; }
aside .hint { padding: 8px 12px; color: var(--muted); font-size: 12px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--panel); }
.item { padding: 5px 12px; cursor: pointer; display: flex; gap: 8px; align-items: baseline; border-bottom: 1px solid transparent; }
.item:hover, .item.sel { background: var(--hover); }
.item.cur { background: var(--accent-soft); }
.item .nm { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item .pk { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.cnt { color: var(--muted); font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.cnt .i { color: var(--caller); } .cnt .o { color: var(--callee); }
main { flex: 1; overflow: auto; padding: 16px 20px 40px; min-width: 0; }
#empty { color: var(--muted); padding: 40px 0; text-align: center; font-size: 14px; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
.title { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.title h2 { margin: 0; font-size: 18px; }
.title .pkg { color: var(--muted); font-weight: 400; }
.badge { font-size: 11px; padding: 1px 7px; border-radius: 10px; background: var(--accent-soft); color: var(--accent); text-transform: uppercase; letter-spacing: .03em; }
.loc a { color: var(--accent); text-decoration: none; font-size: 12px; }
.loc a:hover { text-decoration: underline; }
.stats { margin-top: 6px; color: var(--muted); font-size: 12px; }
.stats b { color: var(--text); font-weight: 600; }
details { margin-top: 8px; }
summary { cursor: pointer; color: var(--muted); font-size: 12px; }
pre { margin: 6px 0 0; padding: 8px 10px; background: var(--bg); border-radius: 6px; overflow: auto; font: 12px/1.4 ui-monospace, Consolas, monospace; }
#diagram { margin-top: 14px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 6px; overflow-x: auto; }
#diagram svg { display: block; width: 100%; min-width: 760px; }
#diagram .lbl { font-size: 11px; fill: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.nd rect { fill: var(--panel); stroke: var(--border); rx: 5; }
.nd text { font-size: 12px; fill: var(--text); pointer-events: none; }
.nd text.p { fill: var(--muted); font-size: 10px; }
.nd { cursor: pointer; }
.nd:hover rect { stroke: var(--accent); stroke-width: 2; }
.nd.focus rect { fill: var(--focus-bg); stroke: var(--focus-bg); }
.nd.focus text { fill: var(--focus-text); }
.nd.more { cursor: default; } .nd.more rect { stroke-dasharray: 3 3; }
.eg { fill: none; stroke: var(--edge); stroke-width: 1.2; opacity: .8; }
.eg.hi { stroke: var(--edge-hi); stroke-width: 2.2; opacity: 1; }
.trees { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; }
@media (max-width: 1000px) { .trees { grid-template-columns: 1fr; } aside { width: 260px; } }
.tree { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 8px 0; min-width: 0; }
.tree h3 { margin: 0 12px 6px; font-size: 13px; display: flex; gap: 8px; align-items: center; }
.tree h3 small { color: var(--muted); font-weight: 400; flex: 1; }
.tree h3.in { color: var(--caller); } .tree h3.out { color: var(--callee); }
button { font: inherit; font-size: 11px; padding: 2px 8px; border: 1px solid var(--border); border-radius: 5px; background: var(--bg); color: var(--text); cursor: pointer; }
button:hover { border-color: var(--accent); }
.row { display: flex; align-items: center; gap: 6px; padding: 2px 12px; white-space: nowrap; }
.row:hover { background: var(--hover); }
.tw { width: 14px; text-align: center; color: var(--muted); cursor: pointer; user-select: none; flex: none; }
.tw.leaf { cursor: default; opacity: .35; }
.row a { color: var(--text); text-decoration: none; font-weight: 600; cursor: pointer; }
.row a:hover { color: var(--accent); text-decoration: underline; }
.row .pk { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
.row .x { color: var(--muted); font-size: 11px; }
.row .cyc { color: var(--caller); font-size: 11px; }
.none { color: var(--muted); padding: 4px 12px; font-style: italic; }
kbd { font: 11px ui-monospace, monospace; border: 1px solid var(--border); border-radius: 3px; padding: 0 4px; }
</style>
</head>
<body>
<header>
  <h1>Call graph</h1>
  <span class="meta" id="meta"></span>
  <input id="q" type="search" placeholder="Search procedure / function / trigger — name or pkg.name   ( / )" autocomplete="off" autofocus>
</header>
<div id="layout">
  <aside><div class="hint" id="hint"></div><div id="list"></div></aside>
  <main>
    <div id="empty">Search for a procedure or function on the left, then click it.<br>Click any name in the diagram or trees to move to it. Browser Back/Forward work.</div>
    <section id="focus" hidden>
      <div class="card">
        <div class="title"><span class="badge" id="fKind"></span><h2 id="fName"></h2></div>
        <div class="loc" id="fLoc"></div>
        <div class="stats" id="fStats"></div>
        <details id="fSigBox"><summary>signature</summary><pre id="fSig"></pre></details>
      </div>
      <div id="diagram"></div>
      <div class="trees">
        <div class="tree"><h3 class="in">▲ Callers <small>who calls it (expand ▸ for their callers)</small><button data-exp="in">expand all</button><button data-col="in">collapse</button></h3><div id="tin"></div></div>
        <div class="tree"><h3 class="out">▼ Callees <small>what it calls (expand ▸ to go deeper)</small><button data-exp="out">expand all</button><button data-col="out">collapse</button></h3><div id="tout"></div></div>
      </div>
    </section>
  </main>
</div>
<script id="graph-data" type="application/json">${json}</script>
<script>
(function () {
  'use strict';
  const G = JSON.parse(document.getElementById('graph-data').textContent);
  const KIND = { p: 'procedure', f: 'function', t: 'trigger' };
  const N = G.nodes.map((a, i) => ({ id: i, name: a[0], pkg: a[1], kind: a[2], file: a[3], line: a[4], sig: a[5], out: [], cnt: [], inc: [] }));
  G.out.forEach((lst, i) => {
    for (let k = 0; k < lst.length; k += 2) { N[i].out.push(lst[k]); N[i].cnt.push(lst[k + 1]); if (lst[k] !== i) N[lst[k]].inc.push(i); }
  });
  const full = (n) => (n.pkg ? n.pkg + '.' : '') + n.name;
  const byName = (a, b) => full(N[a]).localeCompare(full(N[b]));
  N.forEach((n) => { n.inc.sort(byName); const o = n.out.map((id, k) => [id, n.cnt[k]]).sort((a, b) => byName(a[0], b[0])); n.out = o.map((x) => x[0]); n.cnt = o.map((x) => x[1]); });
  const edges = N.reduce((s, n) => s + n.out.length, 0);
  document.getElementById('meta').textContent = G.title + ' · ' + N.length + ' subprograms · ' + edges + ' call edges · generated ' + G.generated;

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const cntEl = (n) => { const s = el('span', 'cnt'); s.append(el('span', 'i', '▲' + n.inc.length), ' ', el('span', 'o', '▼' + n.out.length)); s.title = n.inc.length + ' callers, ' + n.out.length + ' callees'; return s; };
  const vscodeLink = (n) => 'vscode://file/' + G.files[n.file][1] + ':' + (n.line + 1);

  // ---------------------------------------------------------------- search list
  let current = -1, results = [], sel = 0;
  const q = $('q');
  function search() {
    const s = q.value.trim().toLowerCase();
    let res;
    if (!s) {
      res = N.slice().sort((a, b) => b.inc.length - a.inc.length).slice(0, 150).map((n) => n.id);
      $('hint').textContent = 'Most called (type to search)';
    } else {
      const dot = s.lastIndexOf('.');
      const ps = dot >= 0 ? s.slice(0, dot) : null, ns = dot >= 0 ? s.slice(dot + 1) : s;
      const scored = [];
      for (const n of N) {
        const nm = n.name.toLowerCase(), pk = n.pkg.toLowerCase();
        let sc = -1;
        if (ps !== null) { if (pk.includes(ps) && nm.includes(ns)) sc = (pk === ps ? 2 : 0) + (nm === ns ? 4 : nm.startsWith(ns) ? 2 : 0); }
        else if (nm === s) sc = 10; else if (nm.startsWith(s)) sc = 6; else if (nm.includes(s)) sc = 3; else if ((pk + '.' + nm).includes(s)) sc = 1;
        if (sc >= 0) scored.push([sc, n]);
      }
      scored.sort((a, b) => b[0] - a[0] || b[1].inc.length - a[1].inc.length || full(a[1]).localeCompare(full(b[1])));
      res = scored.slice(0, 400).map((x) => x[1].id);
      $('hint').textContent = scored.length + ' match' + (scored.length === 1 ? '' : 'es') + (scored.length > 400 ? ' (first 400)' : '') + ' · ↑↓ Enter';
    }
    results = res; sel = 0; renderList();
  }
  function renderList() {
    const list = $('list'); list.textContent = '';
    results.forEach((id, i) => {
      const n = N[id];
      const it = el('div', 'item' + (i === sel ? ' sel' : '') + (id === current ? ' cur' : ''));
      it.append(el('span', 'nm', n.name), el('span', 'pk', n.pkg + (n.kind === 't' ? ' (trigger)' : '')), cntEl(n));
      it.title = full(n);
      it.onclick = () => go(id);
      list.append(it);
    });
  }
  q.addEventListener('input', search);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(results.length - 1, sel + 1); renderList(); scrollSel(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); renderList(); scrollSel(); e.preventDefault(); }
    else if (e.key === 'Enter' && results.length) go(results[sel]);
  });
  function scrollSel() { const s = $('list').children[sel]; if (s) s.scrollIntoView({ block: 'nearest' }); }
  document.addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement !== q) { q.focus(); q.select(); e.preventDefault(); } });

  // ---------------------------------------------------------------- focus view
  function go(id) { if (location.hash !== '#' + id) location.hash = '#' + id; else show(id); }
  window.addEventListener('hashchange', () => show(parseInt(location.hash.slice(1), 10)));

  function reach(id, dir) {
    const seen = new Set([id]), stack = [id];
    while (stack.length) for (const x of N[stack.pop()][dir]) if (!seen.has(x)) { seen.add(x); stack.push(x); }
    return seen.size - 1;
  }

  function show(id) {
    if (!(id >= 0 && id < N.length)) return;
    current = id;
    const n = N[id];
    $('empty').hidden = true; $('focus').hidden = false;
    $('fKind').textContent = KIND[n.kind] || n.kind;
    const h = $('fName'); h.textContent = '';
    if (n.pkg) h.append(el('span', 'pkg', n.pkg + '.'));
    h.append(n.name);
    const loc = $('fLoc'); loc.textContent = '';
    const a = el('a', null, G.files[n.file][0] + ':' + (n.line + 1)); a.href = vscodeLink(n); a.title = 'Open in VS Code';
    loc.append(a);
    const st = $('fStats'); st.textContent = '';
    st.append('Direct: ', el('b', null, String(n.inc.length)), ' callers, ', el('b', null, String(n.out.length)),
      ' callees · Transitive: ', el('b', null, String(reach(id, 'inc'))), ' callers, ', el('b', null, String(reach(id, 'out'))), ' callees');
    $('fSig').textContent = n.sig || '';
    $('fSigBox').hidden = !n.sig;
    diagram(n);
    tree($('tin'), id, 'inc');
    tree($('tout'), id, 'out');
    document.title = full(n) + ' – Call Graph';
    renderList();
    document.querySelector('main').scrollTop = 0;
  }

  // ---------------------------------------------------------------- neighbourhood diagram (SVG)
  const SVG = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs) => { const e = document.createElementNS(SVG, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const MAXSIDE = 40;
  function clip(s, len) { return s.length > len ? s.slice(0, len - 1) + '…' : s; }
  function diagram(n) {
    const box = $('diagram'); box.textContent = '';
    const L = n.inc.slice(0, MAXSIDE), R = n.out.filter((x) => x !== n.id).slice(0, MAXSIDE);
    const moreL = n.inc.length - L.length, moreR = n.out.filter((x) => x !== n.id).length - R.length;
    const rowH = 30, top = 34;
    const rowsL = L.length + (moreL ? 1 : 0), rowsR = R.length + (moreR ? 1 : 0);
    const H = Math.max(rowsL, rowsR, 1) * rowH + top + 10;
    const W = 1000, bw = 270, cx = 380, cw = 240;
    const svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, height: H });
    svg.append(Object.assign(sv('text', { x: 10, y: 18, class: 'lbl' }), { textContent: '▲ callers (' + n.inc.length + ')' }));
    svg.append(Object.assign(sv('text', { x: W - bw - 10, y: 18, class: 'lbl' }), { textContent: '▼ callees (' + n.out.filter((x) => x !== n.id).length + ')' + (n.out.includes(n.id) ? ' · recursive' : '') }));
    const cy = top + (Math.max(rowsL, rowsR, 1) * rowH) / 2 - 18;
    const edgesG = sv('g', {}); svg.append(edgesG);
    const edgeOf = {};
    const yOf = (i, rows) => top + i * rowH + (Math.max(rowsL, rowsR, 1) - rows) * rowH / 2;
    function nodeBox(id, x, y, w, cls) {
      const m = N[id];
      const g = sv('g', { class: 'nd ' + (cls || ''), transform: 'translate(' + x + ',' + y + ')' });
      g.append(sv('rect', { width: w, height: 24, rx: 5 }));
      const t = sv('text', { x: 8, y: 16 }); t.textContent = clip(m.name, m.pkg ? 26 : 36); g.append(t);
      if (m.pkg) { const p = sv('text', { x: w - 6, y: 16, class: 'p', 'text-anchor': 'end' }); p.textContent = clip(m.pkg, 14); g.append(p); }
      const title = sv('title', {}); title.textContent = full(m) + '  (▲' + m.inc.length + ' ▼' + m.out.length + ')'; g.append(title);
      if (id !== n.id) {
        g.addEventListener('click', () => go(id));
        g.addEventListener('mouseenter', () => edgeOf[id] && edgeOf[id].classList.add('hi'));
        g.addEventListener('mouseleave', () => edgeOf[id] && edgeOf[id].classList.remove('hi'));
      }
      svg.append(g);
    }
    function more(count, x, y) {
      const g = sv('g', { class: 'nd more', transform: 'translate(' + x + ',' + y + ')' });
      g.append(sv('rect', { width: bw, height: 24, rx: 5 }));
      const t = sv('text', { x: 8, y: 16 }); t.textContent = '+' + count + ' more – see list below'; g.append(t);
      svg.append(g);
    }
    L.forEach((id, i) => {
      const y = yOf(i, rowsL);
      const p = sv('path', { class: 'eg', d: 'M' + (10 + bw) + ',' + (y + 12) + ' C' + (cx - 40) + ',' + (y + 12) + ' ' + (bw + 60) + ',' + (cy + 12) + ' ' + cx + ',' + (cy + 12) });
      edgesG.append(p); edgeOf[id] = p;
      nodeBox(id, 10, y, bw);
    });
    if (moreL) more(moreL, 10, yOf(L.length, rowsL));
    R.forEach((id, i) => {
      const y = yOf(i, rowsR);
      const x = W - bw - 10;
      const p = sv('path', { class: 'eg', d: 'M' + (cx + cw) + ',' + (cy + 12) + ' C' + (cx + cw + 60) + ',' + (cy + 12) + ' ' + (x - 60) + ',' + (y + 12) + ' ' + x + ',' + (y + 12) });
      edgesG.append(p); if (!edgeOf[id]) edgeOf[id] = p;
      nodeBox(id, x, y, bw);
    });
    if (moreR) more(moreR, W - bw - 10, yOf(R.length, rowsR));
    nodeBox(n.id, cx, cy, cw, 'focus');
    box.append(svg);
  }

  // ---------------------------------------------------------------- expandable trees
  const MAXROWS = 3000;
  function tree(container, rootId, dir) {
    container.textContent = '';
    container.dataset.root = rootId;
    const kids = N[rootId][dir].filter((x) => x !== rootId);
    if (!kids.length) { container.append(el('div', 'none', dir === 'inc' ? 'No callers found (entry point, called dynamically or from outside the indexed sources).' : 'Calls no indexed procedures/functions.')); return; }
    const ul = el('div');
    container.append(ul);
    kids.forEach((id) => ul.append(row(id, dir, 0, [rootId], N[rootId], rootId)));
  }
  function row(id, dir, depth, path, parent, parentId) {
    const n = N[id];
    const wrap = el('div');
    const r = el('div', 'row'); r.style.paddingLeft = (12 + depth * 18) + 'px';
    const cyc = path.includes(id);
    const kids = n[dir].filter((x) => x !== id);
    const tw = el('span', 'tw' + (cyc || !kids.length ? ' leaf' : ''), cyc || !kids.length ? '·' : '▸');
    const a = el('a', null, n.name); a.title = 'Show ' + full(n); a.onclick = () => go(id);
    r.append(tw, a, el('span', 'pk', n.pkg));
    if (dir === 'out') { const k = N[parentId].out.indexOf(id); const c = k >= 0 ? N[parentId].cnt[k] : 0; if (c > 1) r.append(el('span', 'x', '×' + c)); }
    if (cyc) r.append(el('span', 'cyc', '↻ cycle'));
    r.append(cntEl(n));
    const open = el('a', null, '↗'); open.href = vscodeLink(n); open.title = 'Open in VS Code'; open.style.fontWeight = '400';
    r.append(open);
    wrap.append(r);
    const box = el('div'); wrap.append(box);
    wrap._expand = (deep, budget) => {
      if (cyc || !kids.length) return;
      if (!box.childElementCount) kids.forEach((k) => { if (budget.n-- > 0) box.append(row(k, dir, depth + 1, path.concat(id), n, id)); });
      box.hidden = false; tw.textContent = '▾';
      if (deep > 1) for (const c of box.children) c._expand && c._expand(deep - 1, budget);
    };
    tw.onclick = () => {
      if (cyc || !kids.length) return;
      if (!box.hidden && box.childElementCount) { box.hidden = true; tw.textContent = '▸'; }
      else wrap._expand(1, { n: MAXROWS });
    };
    return wrap;
  }
  document.querySelectorAll('button[data-exp]').forEach((b) => b.onclick = () => {
    const c = $(b.dataset.exp === 'in' ? 'tin' : 'tout');
    const budget = { n: MAXROWS };
    for (const w of c.firstChild ? c.firstChild.children : []) w._expand && w._expand(6, budget);
    if (budget.n <= 0) b.textContent = 'expand all (limited)';
  });
  document.querySelectorAll('button[data-col]').forEach((b) => b.onclick = () => {
    const c = $(b.dataset.col === 'in' ? 'tin' : 'tout');
    if (current >= 0) tree(c, current, b.dataset.col === 'in' ? 'inc' : 'out');
  });

  search();
  const h = parseInt(location.hash.slice(1), 10);
  if (h >= 0) show(h);
})();
</script>
</body>
</html>
`;
}

module.exports = { renderCallGraphHtml };
