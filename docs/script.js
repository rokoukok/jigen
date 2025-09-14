async function loadData() {
  const [imagesResponse, groupsResponse] = await Promise.all([
    fetch('./images.json'),
    fetch('./groups.json')
  ]);

  const images = await imagesResponse.json();
  const groups = await groupsResponse.json();

  return { images, groups };
}

// ウィンドウサイズ調整
function adjustTreeHeight() {
  const searchBarHeight = document.getElementById('search-bar').offsetHeight;
  const statusBarHeight = document.getElementById('status-bar').offsetHeight;
  const windowHeight = window.innerHeight;
  const treeHeight = windowHeight - searchBarHeight - statusBarHeight - 114;
  document.getElementById('mermaid-tree').style.height = `${treeHeight}px`;
}

adjustTreeHeight();
window.addEventListener('resize', adjustTreeHeight);

mermaid.initialize({ startOnLoad: false });

function safeId(name) {
  return "id_" + btoa(unescape(encodeURIComponent(name))).replace(/[^a-zA-Z0-9]/g, "");
}

const eraOrder = ["商","西周","春秋","戦国","秦","漢","近現代","コンピューター"];
const eraColors = {
  "商":"#FFDAB9","西周":"#FFE4B5","春秋":"#FFFACD","戦国":"#E0FFFF",
  "秦":"#AFEEEE","漢":"#ADD8E6","近現代":"#E6E6FA","コンピューター":"#F5DEB3"
};
const groupColors = {
  "商":"#FFB07C","西周":"#FFC47A","春秋":"#E6DFA2","戦国":"#B2E0E0",
  "秦":"#90CCCC","漢":"#82BFE0","近現代":"#C0C0E6","コンピューター":"#D1B06B"
};

function parseEraScript(path) {
  const parts = path.split('/');
  return { era: parts[0], script: parts[1] };
}

// === 子→親 構造を親→子構造に変換 ===
function invertGroups(childToParent, images) {
  const parentToChild = {};
  function addRelation(parent, child, relationText) {
    if (!parentToChild[parent]) parentToChild[parent] = {};
    parentToChild[parent][child] = relationText;
  }
  for (const [childKey, parentSpec] of Object.entries(childToParent)) {
    const cleanChild = childKey.startsWith("c_") ? childKey : childKey;
    if (typeof parentSpec === "string") {
      addRelation(parentSpec, cleanChild, "");
    } 
    else if (Array.isArray(parentSpec)) {
      parentSpec.forEach(p => addRelation(p, cleanChild, ""));
    } 
    else if (typeof parentSpec === "object") {
      for (const [p, rel] of Object.entries(parentSpec)) {
        addRelation(p, cleanChild, rel);
      }
    }
  }
  return parentToChild;
}

// === 各eraにダミーノード生成 ===
function insertEraLayerNodes(data) {
  const eraLayerCount = {};
  const groupParents = {};

  for (const [parent, children] of Object.entries(data.groups)) {
    for (const child of Object.keys(children)) {
      if (!groupParents[child]) groupParents[child] = [];
      groupParents[child].push(parent);
    }
  }

  function getEra(groupId) {
    if (groupId.startsWith("c_")) return "コンピューター";
    const era = Object.entries(data.images)
      .find(([p,g]) => g===groupId);
    return era ? parseEraScript(era[0]).era : null;
  }

  for (const gId of Object.keys(data.groups)) {
    const era = getEra(gId);
    if (!era) continue;
    let depth = 0;
    let cur = gId;
    while (groupParents[cur] && groupParents[cur].some(p => getEra(p)===era)) {
      depth++;
      cur = groupParents[cur].find(p => getEra(p)===era);
    }
    eraLayerCount[era] = Math.max(eraLayerCount[era]||0, depth+1);
  }

  for (const era of Object.keys(eraLayerCount)) {
    eraLayerCount[era] += 2;
  }

  const dummyNodes = {};
  eraOrder.forEach(era => {
    const count = eraLayerCount[era] || 1;
    for (let i=1;i<=count;i++) {
      const nodeId = `${era}_layer_${i}`;
      dummyNodes[nodeId] = {};
      if (i>1) dummyNodes[`${era}_layer_${i-1}`][nodeId] = "";
    }
  });

  for (let i=0;i<eraOrder.length-1;i++) {
    const curEra = eraOrder[i], nextEra = eraOrder[i+1];
    const curLast = `${curEra}_layer_${eraLayerCount[curEra]||1}`;
    const nextFirst = `${nextEra}_layer_1`;
    dummyNodes[curLast][nextFirst] = "";
  }

  Object.assign(data.groups, dummyNodes);
}

function createGroupSubgraph(groupId, era, data) {
  if (groupId.includes("_layer_")) {
    const nodeId = safeId(groupId);
    return `  ${nodeId}[" "]\nstyle ${nodeId} fill:none,stroke:none,stroke-width:0px\n`;
  }
  if (groupId.startsWith("missing_")) {
    const nodeId = safeId(groupId);
    return `  ${nodeId}["（欠）"]\nstyle ${nodeId} fill:none,stroke:none,stroke-width:1px\n`;
  }
  if (groupId.startsWith("c_")) {
    const nodeId = safeId(groupId);
    const label = `<div class='string-node'>${groupId.slice(2)}</div>`;
    return `  ${nodeId}["${label}"]\nstyle ${nodeId} fill:white,stroke:#333,stroke-width:1px\n`;
  }
  const safeGroupId = safeId(groupId);
  let code = `  subgraph ${safeGroupId}[ ]\n`;
  const chars = Object.entries(data.images).filter(([p,g]) => g===groupId && (!era || parseEraScript(p).era===era));
  chars.forEach(([path], idx) => {
    const nodeId = safeId(`${groupId}_${idx}`);
    let label = `<div class='glyph-box' data-src='images/${path}.png'></div><br>${parseEraScript(path).script}`;
    code += `    ${nodeId}["${label}"]\n`;
    code += `    style ${nodeId} fill:white,stroke:#333,stroke-width:1px\n`;
  });
  code += `  end\n`;
  const color = groupColors[era] || "#ccc";
  code += `style ${safeGroupId} fill:none,stroke:${color},stroke-width:4px\n`;
  return code;
}

function createEraSubgraph(era, allGroups, data) {
  const safeEraId = safeId(`era_${era}`);
  let code = `subgraph ${safeEraId}[${era}]\n`;
  allGroups.forEach(g => code += createGroupSubgraph(g, era, data));
  code += `end\n`;
  const color = eraColors[era] || "#fff";
  code += `style ${safeEraId} fill:${color},stroke:#333,stroke-width:2px\n`;
  return code;
}

function reattachEvents(svgElement) {
  // PanZoom
  const params = new URLSearchParams(window.location.search);
  const startX = params.has('x') ? parseFloat(params.get('x')) : 426.1;
  const startY = params.has('y') ? parseFloat(params.get('y')) : -3424.0;
  const startZoom = params.has('zoom') ? parseFloat(params.get('zoom')) : 5.00;
  const panZoomInstance = svgPanZoom(svgElement, {
    zoomEnabled: true,
    panEnabled: true,
    controlIconsEnabled: false,
    minZoom: 0.3,
    maxZoom: 10,
    zoomScaleSensitivity: 0.3,
    dblClickZoomEnabled: false
  });
  panZoomInstance.zoom(startZoom);
  panZoomInstance.pan({ x: startX, y: startY });

  const statusBar = document.getElementById('status-bar');
  function updateStatus() {
    const pan = panZoomInstance.getPan();
    const zoom = panZoomInstance.getZoom();
    statusBar.textContent = `x: ${pan.x.toFixed(1)}, y: ${pan.y.toFixed(1)}, zoom: ${zoom.toFixed(2)}`;
    const newUrl = `${location.origin}${location.pathname}?x=${pan.x.toFixed(1)}&y=${pan.y.toFixed(1)}&zoom=${zoom.toFixed(2)}`;
    window.history.replaceState({}, '', newUrl);
  }
  svgElement.addEventListener('mousemove', updateStatus);
  svgElement.addEventListener('wheel', updateStatus);

  // IntersectionObserver (画像遅延ロード)
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const div = entry.target;
        const src = div.dataset.src;
        if (src) {
          div.style.backgroundImage = `url(${src})`;
          div.style.backgroundSize = "contain";
          div.style.backgroundRepeat = "no-repeat";
          div.style.backgroundPosition = "center";
          observer.unobserve(div);
        }
      }
    });
  }, { root: document.getElementById('mermaid-tree'), threshold: 0.1 });
  document.querySelectorAll('.glyph-box').forEach(div => observer.observe(div));

  // 検索機能
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const keyword = searchInput.value.trim();
      document.querySelectorAll('.nodeLabel').forEach(label => {
        if (!keyword) {
          label.style.outline = '';
          return;
        }
        if (label.textContent.includes(keyword)) {
          label.style.outline = '2px solid red';
        } else {
          label.style.outline = '';
        }
      });
    });
  }
}

async function main() {
  const cacheKey = "cachedMermaidSvg_v2";

  const cachedSvg = localStorage.getItem(cacheKey);
  if (cachedSvg) {
    const container = document.getElementById('mermaid-tree');
    container.innerHTML = cachedSvg;
    const svgElement = container.querySelector('svg');
    svgElement.style.width='100%';
    svgElement.style.height='100%';
    reattachEvents(svgElement);
    return;
  }

  const data = await loadData();
  data.groups = invertGroups(data.groups, data.images);

  (function autoGenerateGroups() {
    const allGroupIdsFromChars = new Set(Object.values(data.images));
    const allGroupIdsFromRelations = new Set();
    Object.entries(data.groups).forEach(([parent, children]) => {
      allGroupIdsFromRelations.add(parent);
      Object.keys(children).forEach(child => allGroupIdsFromRelations.add(child));
    });
    const allGroups = new Set([...allGroupIdsFromChars, ...allGroupIdsFromRelations]);
    allGroups.forEach(gId => { if (!data.groups[gId]) data.groups[gId] = {}; });
  })();

  insertEraLayerNodes(data);

  let mermaidCode = `%%{init: {"flowchart": {"nodeSpacing": 70, "rankSpacing": 120}}}%%\ngraph TD\n`;
  const allGroupIds = Object.keys(data.groups);

  eraOrder.forEach(era => {
    const groupsInEra = allGroupIds.filter(gId => {
      if (gId.startsWith("c_")) return era === "コンピューター";
      if (gId.includes("_layer_")) return gId.startsWith(era);
      return Object.entries(data.images).some(([p,g]) => g===gId && parseEraScript(p).era===era)
        || gId.startsWith(`missing_`) && gId.endsWith(`_${era}`);
    });
    mermaidCode += createEraSubgraph(era, groupsInEra, data);
  });

  for (const [parent, children] of Object.entries(data.groups)) {
    for (const [child, relation] of Object.entries(children)) {
      const label = relation ? `|${relation}|` : "";
      mermaidCode += `${safeId(parent)} -->${label} ${safeId(child)}\n`;
    }
  }

  const { svg } = await mermaid.render('theGraph', mermaidCode);
  const container = document.getElementById('mermaid-tree');
  container.innerHTML = svg;

  const svgElement = container.querySelector('svg');
  svgElement.removeAttribute('width');
  svgElement.removeAttribute('height');
  svgElement.style.width='100%';
  svgElement.style.height='100%';

  localStorage.setItem(cacheKey, svg);

  reattachEvents(svgElement);
}

main();
