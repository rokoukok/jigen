// generateMermaidCode.js
// Node で mermaid ソースを生成して stdout に出すスクリプト
const fs = require('fs');
const path = require('path');

const EXTRA_LAYERS = 2; // ここで "層 + 2" の分を調整できます
const eraOrder = ["商","西周","春秋","戦国","秦","漢","近現代","コンピューター"];
const eraColors = {
  "商":"#FFDAB9","西周":"#FFE4B5","春秋":"#FFFACD","戦国":"#E0FFFF",
  "秦":"#AFEEEE","漢":"#ADD8E6","近現代":"#E6E6FA","コンピューター":"#F5DEB3"
};
const groupColors = {
  "商":"#FFB07C","西周":"#FFC47A","春秋":"#E6DFA2","戦国":"#B2E0E0",
  "秦":"#90CCCC","漢":"#82BFE0","近現代":"#C0C0E6","コンピューター":"#D1B06B"
};

function safeId(name) {
  const b64 = Buffer.from(name, 'utf8').toString('base64');
  return "id_" + b64.replace(/[^a-zA-Z0-9]/g, "");
}
function parseEraScript(pathStr) {
  const parts = pathStr.split('/');
  return { era: parts[0], script: parts[1] };
}

// load input JSON
const images = JSON.parse(fs.readFileSync(path.join(__dirname, 'images.json'),'utf8'));
const groupsRaw = JSON.parse(fs.readFileSync(path.join(__dirname, 'groups.json'),'utf8'));

// --- invert groups (child->parent -> parent->children) ---
function invertGroups(childToParent) {
  const parentToChild = {};
  function addRelation(parent, child, rel) {
    if (!parentToChild[parent]) parentToChild[parent] = {};
    parentToChild[parent][child] = rel;
  }
  for (const [childKey, parentSpec] of Object.entries(childToParent)) {
    const cleanChild = childKey;
    if (typeof parentSpec === 'string') addRelation(parentSpec, cleanChild, "");
    else if (Array.isArray(parentSpec)) parentSpec.forEach(p => addRelation(p, cleanChild, ""));
    else if (typeof parentSpec === 'object') {
      for (const [p, rel] of Object.entries(parentSpec)) addRelation(p, cleanChild, rel);
    }
  }
  return parentToChild;
}

let groups = invertGroups(groupsRaw);

// auto-create missing group entries (like in your browser code)
(function autoGenerateGroups() {
  const allGroupIdsFromChars = new Set(Object.values(images));
  const allGroupIdsFromRelations = new Set();
  Object.entries(groups).forEach(([parent, children]) => {
    allGroupIdsFromRelations.add(parent);
    Object.keys(children || {}).forEach(child => allGroupIdsFromRelations.add(child));
  });
  const allGroups = new Set([...allGroupIdsFromChars, ...allGroupIdsFromRelations]);
  allGroups.forEach(gId => { if (!groups[gId]) groups[gId] = {}; });
})();

// insertMissingNodesMultiEra (same logic as client)
function insertMissingNodesMultiEra() {
  const newGroups = {};
  for (const [parent, children] of Object.entries(groups)) {
    newGroups[parent] = newGroups[parent] || {};
    for (const [child, relation] of Object.entries(children)) {
      const parentEras = Object.entries(images).filter(([p,g]) => g===parent).map(([p])=>parseEraScript(p).era);
      let childEras = Object.entries(images).filter(([p,g]) => g===child).map(([p])=>parseEraScript(p).era);

      if (child.startsWith("c_")) childEras = ["コンピューター"];
      if (parent.startsWith("c_")) parentEras = ["コンピューター"];

      if (parentEras.length === 0 || childEras.length === 0) {
        newGroups[parent][child] = relation;
        continue;
      }
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
  Object.assign(groups, newGroups);
}
insertMissingNodesMultiEra();

// Era 内のみで深さを計算してレイヤー（+ EXTRA_LAYERS）を作成
function insertEraLayerNodes() {
  const eraMaxDepth = {};
  eraOrder.forEach(era => {
    const eraGroups = new Set();
    for (const [p, g] of Object.entries(images)) {
      try { if (parseEraScript(p).era === era) eraGroups.add(g); } catch(e){}
    }
    for (const gId of Object.keys(groups)) {
      if (gId.startsWith('missing_') && gId.endsWith(`_${era}`)) eraGroups.add(gId);
    }
    if (era === "コンピューター") {
      for (const gId of Object.keys(groups)) if (gId.startsWith('c_')) eraGroups.add(gId);
    }
    if (eraGroups.size === 0) { eraMaxDepth[era] = 0 + EXTRA_LAYERS; return; }

    const memo = {};
    const visiting = new Set();
    function getDepthEra(node) {
      if (memo[node] !== undefined) return memo[node];
      if (visiting.has(node)) { memo[node] = 0; return 0; }
      visiting.add(node);

      const parents = [];
      for (const [parent, children] of Object.entries(groups)) {
        if (!eraGroups.has(parent)) continue;
        if (!children) continue;
        if (Object.prototype.hasOwnProperty.call(children, node)) {
          if (eraGroups.has(node)) parents.push(parent);
        }
      }

      if (parents.length === 0) memo[node] = 0;
      else {
        let maxP = 0;
        parents.forEach(p => { const d = getDepthEra(p); if (d > maxP) maxP = d; });
        memo[node] = maxP + 1;
      }
      visiting.delete(node);
      return memo[node];
    }

    let maxDepth = 0;
    for (const g of eraGroups) {
      const depth = getDepthEra(g);
      if (depth > maxDepth) maxDepth = depth;
    }
    eraMaxDepth[era] = maxDepth + EXTRA_LAYERS;
  });

  // create layer nodes in era order and link them serially
  const dummyOrder = [];
  eraOrder.forEach(era => {
    const maxDepth = eraMaxDepth[era] ?? 0;
    for (let i = 0; i <= maxDepth; i++) {
      const nodeId = `layer_${era}_${i}`;
      if (!groups[nodeId]) groups[nodeId] = {};
      dummyOrder.push(nodeId);
    }
  });
  for (let i = 0; i < dummyOrder.length - 1; i++) {
    const a = dummyOrder[i], b = dummyOrder[i+1];
    if (!groups[a]) groups[a] = {};
    groups[a][b] = "";
  }
}
insertEraLayerNodes();

// --- mermaid ソース生成 ---
function createGroupSubgraph(groupId, era) {
  if (groupId.startsWith("missing_")) {
    const nodeId = safeId(groupId);
    return `  ${nodeId}["（欠）"]\n  style ${nodeId} fill:none,stroke:none,stroke-width:1px\n`;
  }
  if (groupId.startsWith("layer_")) {
    const nodeId = safeId(groupId);
    // 空ラベルはパースエラーになるので半角スペースを入れる
    return `  ${nodeId}[" "]\n  style ${nodeId} fill:none,stroke:none,stroke-width:0px\n`;
  }
  if (groupId.startsWith("c_")) {
    const nodeId = safeId(groupId);
    const label = `<div class='string-node'>${groupId.slice(2)}</div>`;
    return `  ${nodeId}["${label}"]\n  style ${nodeId} fill:white,stroke:#333,stroke-width:1px\n`;
  }

  const safeGroupId = safeId(groupId);
  let code = `  subgraph ${safeGroupId}[ ]\n`;
  const chars = Object.entries(images).filter(([p,g]) => g===groupId);
  chars.forEach(([path], idx) => {
    const nodeId = safeId(`${groupId}_${idx}`);
    const label = `<div class='glyph-box' data-src='images/${path}.png'></div><br>${parseEraScript(path).script}`;
    code += `    ${nodeId}["${label}"]\n`;
    code += `    style ${nodeId} fill:white,stroke:#333,stroke-width:1px\n`;
  });
  code += `  end\n`;
  const color = groupColors[era] || "#ccc";
  code += `  style ${safeGroupId} fill:none,stroke:${color},stroke-width:4px\n`;
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

let mermaidCode = `%%{init: {"flowchart": {"nodeSpacing": 70, "rankSpacing": 120, "htmlLabels": true}}}%%\n`;
mermaidCode += `graph TD\n`;

const allGroupIds = Object.keys(groups);
eraOrder.forEach(era => {
  const groupsInEra = allGroupIds.filter(gId => {
    if (gId.startsWith("c_")) return era === "コンピューター";
    const hasImageInEra = Object.entries(images).some(([p,g]) => g===gId && parseEraScript(p).era===era);
    const isMissingForEra = gId.startsWith(`missing_`) && gId.endsWith(`_${era}`);
    const isLayerForEra = gId.startsWith(`layer_${era}_`);
    return hasImageInEra || isMissingForEra || isLayerForEra;
  });
  mermaidCode += createEraSubgraph(era, groupsInEra);
});

// relations
for (const [parent, children] of Object.entries(groups)) {
  for (const [child, relation] of Object.entries(children)) {
    const label = relation ? `|${relation}|` : "";
    mermaidCode += `${safeId(parent)} -->${label} ${safeId(child)}\n`;
  }
}

// output to stdout
process.stdout.write(mermaidCode);
