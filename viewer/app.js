// RAG Viewer — app.js (3D Edition)

const RAG_ROOT = '../data';

let graph3d          = null;
let allNodes         = [];
let currentProject   = null;
let currentGraphData = null;
let projects         = {};

// ── Palette ────────────────────────────────────────────────────────────────────

const GROUP_COLORS = {
  api:     '#58a6ff',
  ui:      '#bc8cff',
  service: '#3fb950',
  model:   '#ff9f1a',
  util:    '#39d353',
  hook:    '#f78166',
  config:  '#8b949e',
  test:    '#e3b341',
  other:   '#6e7681',
};

const TYPE_COLORS = {
  file:     '#58a6ff',
  function: '#3fb950',
  class:    '#bc8cff',
};

function nodeColor(node) {
  if (node.type === 'file') return GROUP_COLORS[node.group] ?? '#58a6ff';
  return TYPE_COLORS[node.type] ?? '#6e7681';
}

function nodeSize3D(type, deg, maxDeg) {
  const t = Math.sqrt((deg || 0) / maxDeg);
  if (type === 'file')     return 4  + t * 16;
  if (type === 'class')    return 2.5 + t * 7;
  return 1.2 + t * 4;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function init() {
  try {
    const res = await fetch(`${RAG_ROOT}/projects.json`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    projects = data.projects ?? {};
  } catch { projects = {}; }

  renderTabs();
  const names = Object.keys(projects);
  if (names.length > 0) loadProject(names[0]);
  else showEmpty();
}

// ── Project picker ────────────────────────────────────────────────────────────

function renderTabs() {
  const menu  = document.getElementById('project-picker-menu');
  const names = Object.keys(projects);

  if (names.length === 0) {
    document.getElementById('current-project-name').textContent = 'Nenhum projeto';
    menu.innerHTML = '<div style="padding:10px 14px;font-size:11px;color:#8b949e">Rode sync.py num projeto</div>';
    return;
  }

  menu.innerHTML = '';
  for (const name of names) {
    const stats = projects[name]?.stats ?? {};
    const item  = document.createElement('div');
    item.className = 'project-picker-item';
    item.id = `pi-${name}`;
    item.innerHTML = `
      <span class="pi-dot"></span>
      <span class="pi-name">${name}</span>
      <span class="pi-stats">${stats.files ?? 0}f · ${stats.functions ?? 0}fn</span>
    `;
    item.onclick = () => { loadProject(name); closeProjectMenu(); };
    menu.appendChild(item);
  }
}

function setActiveTab(name) {
  document.getElementById('current-project-name').textContent = name;
  document.querySelectorAll('.project-picker-item').forEach(i => i.classList.remove('active'));
  const item = document.getElementById(`pi-${name}`);
  if (item) item.classList.add('active');
}

function toggleProjectMenu() {
  const m = document.getElementById('project-picker-menu');
  m.style.display = m.style.display === 'none' ? 'block' : 'none';
}

function closeProjectMenu() {
  document.getElementById('project-picker-menu').style.display = 'none';
}

document.addEventListener('click', e => {
  if (!e.target.closest('#project-picker')) closeProjectMenu();
  if (!e.target.closest('.search-wrap'))
    document.getElementById('search-results').style.display = 'none';
});

// ── Load project ──────────────────────────────────────────────────────────────

function showLoading() { document.getElementById('canvas-loading').style.display = 'flex'; }
function hideLoading() { document.getElementById('canvas-loading').style.display = 'none'; }

async function loadProject(name) {
  currentProject = name;
  setActiveTab(name);
  closeDetails();
  showLoading();
  await new Promise(r => setTimeout(r, 40));

  try {
    const res = await fetch(`${RAG_ROOT}/${name}/graph/graph.json`);
    if (!res.ok) throw new Error();
    const graph = await res.json();
    currentGraphData = graph;
    allNodes = graph.nodes;
    renderGraph(graph);
    renderNodeList(graph.nodes, graph.edges);
    updateStats(graph);
    if (logsOpen) await loadLogsList();
  } catch {
    hideLoading();
    showProjectEmpty(name);
  }
}

// ── 3D Graph ──────────────────────────────────────────────────────────────────

function graphBgColor() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? '#f0f2f5' : '#080c12';
}

function renderGraph(graph) {
  const elem = document.getElementById('cy');

  const degree = {};
  for (const e of graph.edges) {
    if (e.source) degree[e.source] = (degree[e.source] || 0) + 1;
    if (e.target) degree[e.target] = (degree[e.target] || 0) + 1;
  }
  const maxDeg = Math.max(1, ...Object.values(degree));

  const gData = {
    nodes: graph.nodes.map(n => ({
      id:    n.id,
      label: n.label,
      type:  n.type,
      group: n.group,
      file:  n.file,
      color: nodeColor(n),
      val:   nodeSize3D(n.type, degree[n.id] || 0, maxDeg),
    })),
    links: graph.edges
      .filter(e => e.source && e.target && e.source !== e.target)
      .map(e => ({ source: e.source, target: e.target, relation: e.relation })),
  };

  if (graph3d) {
    try { graph3d._destructor(); } catch (_) {}
    elem.innerHTML = '';
  }

  graph3d = ForceGraph3D({ antialias: true, alpha: false })(elem)
    .width(elem.offsetWidth  || elem.parentElement.offsetWidth)
    .height(elem.offsetHeight || elem.parentElement.offsetHeight)
    .backgroundColor(graphBgColor())
    .graphData(gData)
    .nodeLabel(n => labelHtml(n))
    .nodeVal(n  => n.val)
    .nodeColor(n => n.color)
    .nodeOpacity(0.92)
    .nodeResolution(14)
    .linkColor(l  => l.relation === 'imports' ? '#1a4d9e' : '#1c2128')
    .linkOpacity(0.5)
    .linkWidth(l  => l.relation === 'imports' ? 0.8 : 0.3)
    .linkDirectionalArrowLength(l  => l.relation === 'imports' ? 5  : 0)
    .linkDirectionalArrowRelPos(1)
    .linkDirectionalParticles(l      => l.relation === 'imports' ? 2 : 0)
    .linkDirectionalParticleWidth(1.8)
    .linkDirectionalParticleSpeed(0.005)
    .linkDirectionalParticleColor(() => '#4d94ff')
    .cooldownTicks(300)
    .onNodeClick(node => {
      focusNode(node.id);
      showDetailsFromNode(node);
    })
    .onBackgroundClick(() => closeDetails());

  graph3d.controls().autoRotate      = true;
  graph3d.controls().autoRotateSpeed = 0.35;

  let fitted = false;
  const loadingFallback = setTimeout(() => {
    if (!fitted) { fitted = true; graph3d?.zoomToFit(400, 80); hideLoading(); }
  }, 3000);

  graph3d.onEngineStop(() => {
    if (!fitted) {
      clearTimeout(loadingFallback);
      fitted = true;
      graph3d.zoomToFit(600, 80);
      hideLoading();
    }
  });
}

function labelHtml(n) {
  return `
    <div style="
      background:rgba(22,27,34,0.9);
      border:1px solid #30363d;
      padding:6px 10px;
      border-radius:6px;
      font-family:ui-monospace,monospace;
      font-size:12px;
      color:#e6edf3;
      pointer-events:none;
    ">
      <b style="color:${n.color}">${n.label}</b>
      <span style="color:#8b949e;margin-left:6px;font-size:10px">${n.type}</span>
      ${n.file ? `<div style="font-size:10px;color:#6e7681;margin-top:2px">${n.file}</div>` : ''}
    </div>
  `;
}

// ── Focus on node ─────────────────────────────────────────────────────────────

function focusNode(id) {
  if (!graph3d) return;
  const node = graph3d.graphData().nodes.find(n => n.id === id);
  if (!node) return;

  graph3d.controls().autoRotate = false;

  const dist  = 90;
  const len   = Math.hypot(node.x || 0.01, node.y || 0.01, node.z || 0.01);
  const ratio = 1 + dist / len;

  graph3d.cameraPosition(
    { x: (node.x || 0) * ratio, y: (node.y || 0) * ratio, z: (node.z || 0) * ratio },
    node,
    800,
  );

  setTimeout(() => { if (graph3d) graph3d.controls().autoRotate = true; }, 5000);

  document.querySelectorAll('.tree-file.selected, .node-item.selected')
    .forEach(i => i.classList.remove('selected'));
  const el = document.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (el) { el.classList.add('selected'); el.scrollIntoView({ block: 'nearest' }); }

  showDetailsFromNode(graph3d.graphData().nodes.find(n => n.id === id));
}

function resetLayout() {
  if (graph3d) graph3d.d3ReheatSimulation();
}

function zoomFit() {
  if (graph3d) graph3d.zoomToFit(600, 80);
}

// ── Details panel ─────────────────────────────────────────────────────────────

function showDetailsFromNode(nodeData) {
  if (!nodeData) return;
  const panel = document.getElementById('details');
  const body  = document.getElementById('details-body');
  panel.classList.remove('hidden');
  document.getElementById('details-title').textContent = nodeData.label;

  const edges   = currentGraphData?.edges ?? [];
  const nodeMap = Object.fromEntries((currentGraphData?.nodes ?? []).map(n => [n.id, n]));

  const outIds = edges.filter(l => l.source === nodeData.id).map(l => l.target);
  const inIds  = edges.filter(l => l.target === nodeData.id).map(l => l.source);

  let html = `
    <div class="details-row">
      <span class="details-label">Nome</span>
      <span class="details-value" style="color:${nodeData.color}">${nodeData.label}</span>
    </div>
    <div class="details-row">
      <span class="details-label">Tipo</span>
      <span class="details-value">${nodeData.type}</span>
    </div>
    <div class="details-row">
      <span class="details-label">Grupo</span>
      <span class="details-value">${nodeData.group ?? '—'}</span>
    </div>
    <div class="details-row">
      <span class="details-label">Arquivo</span>
      <span class="details-value" style="color:#8b949e;word-break:break-all;font-size:11px">${nodeData.file ?? '—'}</span>
    </div>
  `;

  if (outIds.length > 0) {
    html += `<div class="details-row"><span class="details-label">Importa / Define (${outIds.length})</span></div>
             <div class="details-connections">`;
    outIds.slice(0, 25).forEach(tid => {
      const t = nodeMap[tid]; if (!t) return;
      html += connItem(t, '→', tid);
    });
    if (outIds.length > 25) html += moreLabel(outIds.length - 25);
    html += '</div>';
  }

  if (inIds.length > 0) {
    html += `<div class="details-row" style="margin-top:8px"><span class="details-label">Usado por (${inIds.length})</span></div>
             <div class="details-connections">`;
    inIds.slice(0, 25).forEach(sid => {
      const s = nodeMap[sid]; if (!s) return;
      html += connItem(s, '←', sid);
    });
    if (inIds.length > 25) html += moreLabel(inIds.length - 25);
    html += '</div>';
  }

  body.innerHTML = html;
}

function connItem(node, arrow, id) {
  const c = nodeColor(node);
  return `<div class="conn-item" onclick="focusNode('${id}')">
    <span class="node-dot" style="background:${c}"></span>
    <span>${node.label}</span>
    <span class="conn-arrow">${arrow}</span>
  </div>`;
}

function moreLabel(n) {
  return `<div style="padding:4px 8px;font-size:10px;color:#8b949e">+${n} mais</div>`;
}

function closeDetails() {
  document.getElementById('details').classList.add('hidden');
  document.getElementById('btn-memory')?.classList.remove('active');
  document.querySelectorAll('.tree-file.selected, .node-item.selected')
    .forEach(i => i.classList.remove('selected'));
}

// ── Sidebar — file tree ───────────────────────────────────────────────────────

function renderNodeList(nodes, edges = []) {
  const list = document.getElementById('node-list');
  list.innerHTML = '';
  allNodes = nodes;

  const degree = {};
  for (const e of edges) {
    degree[e.source] = (degree[e.source] || 0) + 1;
    degree[e.target] = (degree[e.target] || 0) + 1;
  }

  const fileNodeMap = {};
  for (const n of nodes) if (n.type === 'file') fileNodeMap[n.file] = n;

  const childrenMap = {};
  for (const n of nodes) {
    if (n.type !== 'file' && n.file) {
      if (!childrenMap[n.file]) childrenMap[n.file] = [];
      childrenMap[n.file].push(n);
    }
  }
  for (const p of Object.keys(childrenMap))
    childrenMap[p].sort((a, b) => (degree[b.id] || 0) - (degree[a.id] || 0));

  const tree = {};
  for (const path of Object.keys(fileNodeMap)) {
    const parts = path.split('/');
    let cur = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]]) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = { _file: path };
  }

  renderTree(list, tree, fileNodeMap, childrenMap, degree, 0);
}

function renderTree(container, tree, fileNodeMap, childrenMap, degree, depth) {
  const entries = Object.entries(tree).sort(([ak, av], [bk, bv]) => {
    const aF = av._file !== undefined, bF = bv._file !== undefined;
    if (aF !== bF) return aF ? 1 : -1;
    return ak.localeCompare(bk);
  });
  for (const [name, val] of entries) {
    if (val._file !== undefined)
      renderFileRow(container, name, val._file, fileNodeMap, childrenMap, degree, depth);
    else
      renderFolderRow(container, name, val, fileNodeMap, childrenMap, degree, depth);
  }
}

function renderFolderRow(container, name, subtree, fileNodeMap, childrenMap, degree, depth) {
  const wrap   = document.createElement('div');
  const header = document.createElement('div');
  header.className = 'tree-folder';
  header.style.paddingLeft = (10 + depth * 14) + 'px';
  header.innerHTML = `<span class="tree-arrow">▶</span><span class="tree-name">${name}</span>`;

  const body = document.createElement('div');
  body.className = 'tree-body';
  body.style.display = 'none';
  header.onclick = () => {
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : '';
    header.querySelector('.tree-arrow').textContent = open ? '▶' : '▼';
  };

  renderTree(body, subtree, fileNodeMap, childrenMap, degree, depth + 1);
  wrap.appendChild(header);
  wrap.appendChild(body);
  container.appendChild(wrap);
}

function renderFileRow(container, name, filePath, fileNodeMap, childrenMap, degree, depth) {
  const fileNode = fileNodeMap[filePath];
  const children = childrenMap[filePath] || [];
  const wrap     = document.createElement('div');
  const header   = document.createElement('div');
  header.className = 'tree-file';
  if (fileNode) header.dataset.id = fileNode.id;
  header.style.paddingLeft = (10 + depth * 14) + 'px';

  const color   = fileNode ? nodeColor(fileNode) : '#58a6ff';
  const hasKids = children.length > 0;

  header.innerHTML = `
    <span class="tree-arrow tree-arrow-sm ${hasKids ? '' : 'tree-arrow-hidden'}">${hasKids ? '▶' : ''}</span>
    <span class="tree-file-dot" style="background:${color}"></span>
    <span class="tree-name">${name}</span>
    ${hasKids ? `<span class="node-deg">${children.length}</span>` : ''}
  `;

  const body = document.createElement('div');
  body.className = 'tree-body';
  body.style.display = 'none';

  if (hasKids) {
    header.querySelector('.tree-arrow-sm').onclick = e => {
      e.stopPropagation();
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      header.querySelector('.tree-arrow-sm').textContent = open ? '▶' : '▼';
    };
  }

  if (fileNode) {
    header.onclick = e => {
      if (e.target.classList.contains('tree-arrow-sm')) return;
      focusNode(fileNode.id);
    };
  }

  for (const child of children) {
    const item = document.createElement('div');
    item.className = 'node-item';
    item.dataset.id = child.id;
    item.style.paddingLeft = (10 + (depth + 1) * 14 + 10) + 'px';
    const deg  = degree[child.id] || 0;
    const icon = child.type === 'class' ? '◆' : 'ƒ';
    item.innerHTML = `
      <span class="tree-child-icon" style="color:${nodeColor(child)}">${icon}</span>
      <span class="node-label">${child.label}</span>
      ${deg > 1 ? `<span class="node-deg">${deg}</span>` : ''}
    `;
    item.onclick = () => focusNode(child.id);
    body.appendChild(item);
  }

  wrap.appendChild(header);
  if (hasKids) wrap.appendChild(body);
  container.appendChild(wrap);
}

function collapseAll() {
  document.querySelectorAll('.tree-body').forEach(b => b.style.display = 'none');
  document.querySelectorAll('.tree-arrow').forEach(a => a.textContent = '▶');
  document.querySelectorAll('.tree-arrow-sm').forEach(a => { if (a.textContent) a.textContent = '▶'; });
}

// ── Search ────────────────────────────────────────────────────────────────────

let searchTimeout = null;

function onSearch(value) {
  clearTimeout(searchTimeout);
  const q = value.trim().toLowerCase();
  const resultsEl = document.getElementById('search-results');

  if (!q) { resultsEl.innerHTML = ''; resultsEl.style.display = 'none'; return; }

  searchTimeout = setTimeout(() => {
    const matches = allNodes
      .filter(n => n.label.toLowerCase().includes(q) || (n.file && n.file.toLowerCase().includes(q)))
      .slice(0, 20);

    if (matches.length === 0) {
      resultsEl.innerHTML = '<div class="search-result-item" style="color:#8b949e">Sem resultados</div>';
    } else {
      resultsEl.innerHTML = matches.map(n => `
        <div class="search-result-item" onclick="selectSearchResult('${n.id}')">
          <span class="node-dot" style="background:${nodeColor(n)}"></span>
          <span>${n.label}</span>
          <span class="sr-file">${n.type} · ${n.file ?? ''}</span>
        </div>
      `).join('');
    }
    resultsEl.style.display = 'block';
  }, 150);
}

function selectSearchResult(id) {
  document.getElementById('search-results').style.display = 'none';
  document.getElementById('search-input').value = '';
  focusNode(id);
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function updateStats(graph) {
  const s = graph.stats ?? {};
  document.getElementById('stat-files').textContent  = s.files     ?? 0;
  document.getElementById('stat-fns').textContent    = s.functions ?? 0;
  document.getElementById('stat-cls').textContent    = s.classes   ?? 0;
  document.getElementById('stat-edges').textContent  = s.edges     ?? 0;
  const badge = document.getElementById('stat-project-badge');
  if (badge) badge.textContent = graph.project ?? currentProject ?? '—';
}

// ── Empty states ──────────────────────────────────────────────────────────────

function showEmpty() {
  document.getElementById('cy').innerHTML = `
    <div class="empty">
      <h2>RAG Viewer 3D</h2>
      <p>Nenhum projeto sincronizado ainda. Vá ao seu projeto real e rode:</p>
      <code>python3 /path/to/nodum/scripts/sync.py /caminho/do/projeto</code>
      <p style="margin-top:8px">Depois recarregue esta página.</p>
    </div>
  `;
}

function showProjectEmpty(name) {
  document.getElementById('cy').innerHTML = `
    <div class="empty">
      <h2>${name}</h2>
      <p>Grafo ainda não gerado. Rode:</p>
      <code>python3 ~/Dev/nodum/scripts/sync.py /caminho/para/${name}</code>
      <p style="margin-top:8px">Depois recarregue esta página.</p>
    </div>
  `;
}

// ── Logs drawer ───────────────────────────────────────────────────────────────

let logsOpen = false;
let activeLogDate = null;

async function toggleLogs() {
  const drawer = document.getElementById('logs-drawer');
  const btn    = document.getElementById('btn-logs');
  logsOpen = !logsOpen;

  if (!logsOpen) {
    drawer.style.display = 'none';
    btn.classList.remove('active');
    return;
  }

  drawer.style.display = 'flex';
  btn.classList.add('active');
  await loadLogsList();
}

async function loadLogsList() {
  if (!currentProject) return;
  const listEl = document.getElementById('logs-dates-list');
  listEl.innerHTML = '';

  let dates = projects[currentProject]?.log_dates ?? [];

  if (dates.length === 0) {
    try {
      const fresh = await fetch(`${RAG_ROOT}/projects.json`);
      const data  = await fresh.json();
      dates = data.projects?.[currentProject]?.log_dates ?? [];
      if (data.projects?.[currentProject]) {
        projects[currentProject] = data.projects[currentProject];
      }
    } catch (_) {}
  }

  if (dates.length === 0) {
    listEl.innerHTML = '<div class="logs-empty-small">Rode sync para gerar logs.</div>';
    return;
  }

  for (const date of dates) {
    const btn = document.createElement('button');
    btn.className = 'log-date-btn';
    btn.dataset.date = date;
    btn.innerHTML = `
      <span class="log-date-day">${date.slice(8)}</span>
      <span class="log-date-month">${date.slice(0, 7)}</span>
    `;
    btn.onclick = () => loadLogFile(date);
    listEl.appendChild(btn);
  }

  loadLogFile(dates[0]);
}

async function loadLogFile(date) {
  if (!currentProject) return;
  activeLogDate = date;

  document.querySelectorAll('.log-date-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.date === date)
  );

  document.getElementById('logs-content-title').querySelector('span').textContent = date;

  const body = document.getElementById('logs-content-body');
  body.innerHTML = '<div class="logs-loading">Carregando…</div>';

  try {
    const res  = await fetch(`${RAG_ROOT}/${currentProject}/logs/${date}.md`);
    const text = await res.text();
    body.innerHTML = renderLogMd(text);
  } catch (_) {
    body.innerHTML = '<div class="logs-empty">Erro ao carregar log.</div>';
  }
}

function renderLogMd(text) {
  const lines = text.split('\n');
  let html = '';
  let inCode = false;
  let inList = false;

  for (const raw of lines) {
    const line = raw
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    if (line.startsWith('```')) {
      if (inList) { html += '</ul>'; inList = false; }
      if (inCode) { html += '</code></pre>'; inCode = false; }
      else        { html += '<pre><code>'; inCode = true; }
      continue;
    }
    if (inCode) { html += line + '\n'; continue; }

    if (line.startsWith('# '))   { if(inList){html+='</ul>';inList=false;} html += `<h2>${line.slice(2)}</h2>`; continue; }
    if (line.startsWith('## '))  { if(inList){html+='</ul>';inList=false;} html += `<h3>${line.slice(3)}</h3>`; continue; }
    if (line.startsWith('### ')) { if(inList){html+='</ul>';inList=false;} html += `<h4>${line.slice(4)}</h4>`; continue; }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${md_inline(line.slice(2))}</li>`;
      continue;
    }

    if (inList) { html += '</ul>'; inList = false; }
    if (line.trim() === '') { html += '<div class="log-spacer"></div>'; continue; }
    html += `<p>${md_inline(line)}</p>`;
  }
  if (inList) html += '</ul>';
  if (inCode) html += '</code></pre>';
  return html;
}

function md_inline(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
}

// ── Memory / RESUMO ───────────────────────────────────────────────────────────

async function showMemory() {
  if (!currentProject) return;

  const panel = document.getElementById('details');
  const body  = document.getElementById('details-body');
  const btn   = document.getElementById('btn-memory');

  if (btn.classList.contains('active')) {
    closeDetails();
    btn.classList.remove('active');
    return;
  }

  panel.classList.remove('hidden');
  document.getElementById('details-title').textContent = currentProject;
  body.innerHTML = '<div class="logs-loading">Carregando…</div>';
  btn.classList.add('active');

  try {
    const res  = await fetch(`${RAG_ROOT}/${currentProject}/memory/RESUMO.md`);
    if (!res.ok) throw new Error();
    const text = await res.text();
    body.innerHTML = `<div class="resumo-body">${renderLogMd(text)}</div>`;
  } catch {
    body.innerHTML = '<div class="logs-empty">RESUMO.md não encontrado. Rode sync primeiro.</div>';
  }
}

// ── Export PNG ────────────────────────────────────────────────────────────────

function exportPNG() {
  if (!graph3d) return;
  graph3d.renderer().render(graph3d.scene(), graph3d.camera());
  graph3d.renderer().domElement.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentProject ?? 'graph'}-3d.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 'image/png');
}

// ── Theme toggle ──────────────────────────────────────────────────────────────

function toggleTheme() {
  const html    = document.documentElement;
  const isLight = html.getAttribute('data-theme') !== 'light';
  html.setAttribute('data-theme', isLight ? 'light' : 'dark');
  localStorage.setItem('nodum-theme', isLight ? 'light' : 'dark');
  document.getElementById('theme-icon-moon').style.display = isLight ? 'none' : '';
  document.getElementById('theme-icon-sun').style.display  = isLight ? '' : 'none';
  if (graph3d) graph3d.backgroundColor(graphBgColor());
}

// ── Notifications ─────────────────────────────────────────────────────────────

let notificationTimeout = null;

function showNotification(message, type = 'success') {
  const toast   = document.getElementById('notification-toast');
  const content = document.getElementById('toast-content');

  if (notificationTimeout) clearTimeout(notificationTimeout);

  content.textContent = message;
  toast.className = `notification-toast ${type}`;
  toast.classList.remove('hide');

  notificationTimeout = setTimeout(() => {
    toast.classList.add('hide');
  }, 4000);
}

function closeNotification() {
  const toast = document.getElementById('notification-toast');
  toast.classList.add('hide');
  if (notificationTimeout) clearTimeout(notificationTimeout);
}

// ── Sync Project ──────────────────────────────────────────────────────────────

async function syncProject() {
  if (!currentProject) {
    showNotification('Nenhum projeto selecionado.', 'error');
    return;
  }

  const btn = document.getElementById('btn-sync');
  const originalText = btn.textContent.trim();
  btn.disabled = true;
  btn.textContent = 'Sincronizando…';

  const projData = projects[currentProject];
  if (!projData || !projData.project_path) {
    showNotification('Caminho do projeto não encontrado. Execute sync.py uma vez para registrar o caminho.', 'error');
    btn.disabled = false;
    btn.textContent = originalText;
    return;
  }

  try {
    const response = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: projData.project_path })
    });

    const result = await response.json();

    if (result.success) {
      showNotification('✓ Projeto sincronizado com sucesso!', 'success');
      await loadProject(currentProject);
    } else {
      showNotification(`✗ Erro ao sincronizar: ${result.error || result.output}`, 'error');
    }
  } catch (err) {
    showNotification(`✗ Erro: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

window.addEventListener('load', () => {
  const saved = localStorage.getItem('nodum-theme');
  if (saved === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    document.getElementById('theme-icon-moon').style.display = 'none';
    document.getElementById('theme-icon-sun').style.display  = '';
  }
  init();
});

window.addEventListener('resize', () => {
  if (!graph3d) return;
  const elem = document.getElementById('cy');
  graph3d.width(elem.offsetWidth).height(elem.offsetHeight);
});
