async function loadData() {
  const [imagesResponse, groupsResponse] = await Promise.all([
    fetch('images.json'),
    fetch('groups.json')
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
  const treeHeight = windowHeight - searchBarHeight - statusBarHeight - 110;
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

async function main() {
  const data = await loadData();

  // グループ正規化
const normalizedGroups = {};
const additionalChars = {};
for (const [parent, children] of Object.entries(data.groups)) {
  if (typeof children === "string") {
    normalizedGroups[parent] = { [children]: "" };
  } else if (Array.isArray(children)) {
    // 1つの子グループにまとめる
    const groupId = `${parent}_group`;
    normalizedGroups[parent] = { [groupId]: "" };
    // 画像をまとめて追加
    children.forEach((ch, idx) => {
      additionalChars[`コンピューター/${ch}`] = groupId;
    });
  } else {
    normalizedGroups[parent] = { ...children };
  }
}
data.groups = normalizedGroups;
Object.assign(data.images, additionalChars);

  // 欠ノード自動生成
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

  // 複数時代跨ぎ欠ノード挿入
  function insertMissingNodesMultiEra(data) {
    const newGroups = {};
    for (const [parent, children] of Object.entries(data.groups)) {
      newGroups[parent] = newGroups[parent] || {};
      for (const [child, relation] of Object.entries(children)) {
        const parentEras = Object.entries(data.images)
          .filter(([p,g]) => g===parent).map(([p])=>parseEraScript(p).era);
        const childEras = Object.entries(data.images)
          .filter(([p,g]) => g===child).map(([p])=>parseEraScript(p).era);
        const minEraIdx = Math.min(...parentEras.map(e=>eraOrder.indexOf(e)));
        const maxEraIdx = Math.max(...childEras.map(e=>eraOrder.indexOf(e)));
        if (maxEraIdx - minEraIdx > 1) {
          let prev = parent;
          for (let i=minEraIdx+1; i<maxEraIdx; i++) {
            const missingEra = eraOrder[i];
            const missingNodeId = `missing_${parent}_${missingEra}`;
            newGroups[missingNodeId] = newGroups[missingNodeId] || {};
            newGroups[prev][missingNodeId] = "";
            prev = missingNodeId;
          }
          newGroups[prev][child] = relation;
        } else newGroups[parent][child] = relation;
      }
    }
    Object.assign(data.groups, newGroups);
  }
  insertMissingNodesMultiEra(data);

  // ノード生成
  function createGroupSubgraph(groupId, era) {
    if (groupId.startsWith("missing_")) {
      const nodeId = safeId(groupId);
      return `  ${nodeId}["（欠）"]\nstyle ${nodeId} fill:none,stroke:none,stroke-width:1px\n`;
    }
    const safeGroupId = safeId(groupId);
    let code = `  subgraph ${safeGroupId}[ ]\n`;
    const chars = Object.entries(data.images).filter(([p,g]) => g===groupId && parseEraScript(p).era===era);
    chars.forEach(([path], idx) => {
      const nodeId = safeId(`${groupId}_${idx}`);
      let label;
      if (path.startsWith("コンピューター/")) {
        label = `<div class='string-node'>${path.split('/')[1]}</div>`;
        code += `    ${nodeId}["${label}"]\n`;
        code += `    style ${nodeId} fill:white,stroke:#333,stroke-width:1px\n`;
      } else {
        // 初期状態では <img> を作らず data-src だけセット
        label = `<div class='glyph-box' data-src='images/${path}.png'></div><br>${parseEraScript(path).script}`;
        code += `    ${nodeId}["${label}"]\n`;
        code += `    style ${nodeId} fill:white,stroke:#333,stroke-width:1px\n`;
      }
    });
    code += `  end\n`;
    const color = groupColors[era] || "#ccc";
    code += `style ${safeGroupId} fill:none,stroke:${color},stroke-width:4px\n`;
    return code;
  }

  function createEraSubgraph(era, allGroups) {
    const safeEraId = safeId(`era_${era}`);
    let code = `subgraph ${safeEraId}[${era}]\n`;
    allGroups.forEach(g => code += createGroupSubgraph(g, era));
    code += `end\n`;
    const color = eraColors[era] || "#fff";
    code += `style ${safeEraId} fill:${color},stroke:#333,stroke-width:2px\n`;
    return code;
  }

  // Mermaidコード生成
  let mermaidCode = `%%{init: {"flowchart": {"nodeSpacing": 70, "rankSpacing": 120}}}%%\ngraph TD\n`;
  const allGroupIds = Object.keys(data.groups);
  eraOrder.forEach(era => {
    const groupsInEra = allGroupIds.filter(gId => {
      return Object.entries(data.images).some(([p,g]) => g===gId && parseEraScript(p).era===era)
        || gId.startsWith(`missing_`) && gId.endsWith(`_${era}`);
    });
    mermaidCode += createEraSubgraph(era, groupsInEra);
  });

  for (const [parent, children] of Object.entries(data.groups)) {
    for (const [child, relation] of Object.entries(children)) {
      const label = relation ? `|${relation}|` : "";
      mermaidCode += `${safeId(parent)} -->${label} ${safeId(child)}\n`;
    }
  }

  // 描画
  const { svg } = await mermaid.render('theGraph', mermaidCode);
  const container = document.getElementById('mermaid-tree');
  container.innerHTML = svg;
  const theGraph = document.querySelector("#theGraph");
  if (theGraph) {
    theGraph.style.maxWidth = "100%";
  }
  const svgElement = container.querySelector('svg');
  svgElement.removeAttribute('width');
  svgElement.removeAttribute('height');
  svgElement.style.width='100%';
  svgElement.style.height='100%';

  // === 遅延ロード＆監視 ===
  const displayState = new Set();

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const div = entry.target;
      const nodeId = div.dataset.src;
      if (entry.isIntersecting) {
        if (!div.querySelector('img')) {
          const newImg = document.createElement('img');
          newImg.src = nodeId;
          div.appendChild(newImg);
        } else {
          div.querySelector('img').style.display = 'block';
        }
        displayState.add(nodeId);
      } else {
        const img = div.querySelector('img');
        if (img) img.style.display = 'none';
        displayState.delete(nodeId);
      }
    });
  }, { root: svgElement, rootMargin: '100px' });

  svgElement.querySelectorAll('.glyph-box').forEach(div => observer.observe(div));

  // 現代ノードクリック選択
  svgElement.querySelectorAll('.string-node').forEach(node => {
    node.style.cursor = 'text';
    node.addEventListener('click', () => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
  });

  svgElement.addEventListener('click', (e) => {
    const targetClass = e.target.getAttribute('class') || '';
    if (!targetClass.includes('string-node')) window.getSelection().removeAllRanges();
  });

  // PanZoom
  const params = new URLSearchParams(window.location.search);
  const startX = parseFloat(params.get('x')) || 0;
  const startY = parseFloat(params.get('y')) || 0;
  const startZoom = parseFloat(params.get('zoom')) || 1;
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

  // 検索
  function performSearch() {
    const query = document.getElementById('search-input').value.trim();
    if (!query) return;
    const allNodes = svgElement.querySelectorAll('.string-node');
    let foundNode = null;
    allNodes.forEach(node => { if (node.textContent.trim() === query) foundNode = node; });
    if (!foundNode) { alert("見つかりませんでした"); return; }
    panZoomInstance.disablePan();
    panZoomInstance.disableZoom();
    panZoomInstance.zoom(5);
    let prevPan = { x: null, y: null };
    function panStep() {
      const bbox = foundNode.getBoundingClientRect();
      const svgBBox = svgElement.getBoundingClientRect();
      const pan = panZoomInstance.getPan();
      const zoom = panZoomInstance.getZoom();
      const offsetX = (bbox.x + bbox.width/2 - svgBBox.width/2)/zoom;
      const offsetY = (bbox.y + bbox.height/2 - svgBBox.height/2)/zoom;
      const newX = pan.x - offsetX;
      const newY = pan.y - offsetY;
      panZoomInstance.pan({ x: newX, y: newY });
      updateStatus();
      if (prevPan.x !== null &&
          Math.round(prevPan.x*10)/10 === Math.round(newX*10)/10 &&
          Math.round(prevPan.y*10)/10 === Math.round(newY*10)/10) {
        panZoomInstance.enablePan();
        panZoomInstance.enableZoom();
        return;
      }
      prevPan = { x: newX, y: newY };
      setTimeout(panStep, 5);
    }
    panStep();
  }

  document.getElementById('search-btn').addEventListener('click', performSearch);
  document.getElementById('search-input').addEventListener('keydown', (e) => {
    if (e.key === "Enter") { e.preventDefault(); performSearch(); }
  });
}

main();
