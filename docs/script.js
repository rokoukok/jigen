async function loadData() {
  const [imagesResponse, groupsResponse] = await Promise.all([
    fetch('images.json'),
    fetch('groups.json')
  ]);
  const images = await imagesResponse.json();
  const groups = await groupsResponse.json();
  return { images, groups };
}

// キャッシュ用ハッシュ
async function fetchJSONHash(url) {
  const resp = await fetch(url);
  const text = await resp.text();
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2,'0')).join('');
}

// localStorageキャッシュ管理（容量上限5MB）
function setCache(key, value, maxSizeMB = 5) {
  try {
    localStorage.setItem(key, value);
  } catch(e) {
    if(e.name==='QuotaExceededError'){
      const keys = Object.keys(localStorage).filter(k=>k.startsWith('mermaidSVGCache_'));
      keys.sort((a,b)=>localStorage.getItem(a).length - localStorage.getItem(b).length);
      for(const k of keys){
        localStorage.removeItem(k);
        try { localStorage.setItem(key,value); break; } catch(e2){continue;}
      }
    }
  }
}

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
const eraColors = {"商":"#FFDAB9","西周":"#FFE4B5","春秋":"#FFFACD","戦国":"#E0FFFF","秦":"#AFEEEE","漢":"#ADD8E6","近現代":"#E6E6FA","コンピューター":"#F5DEB3"};
const groupColors = {"商":"#FFB07C","西周":"#FFC47A","春秋":"#E6DFA2","戦国":"#B2E0E0","秦":"#90CCCC","漢":"#82BFE0","近現代":"#C0C0E6","コンピューター":"#D1B06B"};

function parseEraScript(path) {
  const parts = path.split('/');
  return { era: parts[0], script: parts[1] };
}

function invertGroups(childToParent, images) {
  const parentToChild = {};
  function addRelation(parent, child, relationText) {
    if (!parentToChild[parent]) parentToChild[parent]={};
    parentToChild[parent][child] = relationText;
  }
  for(const [childKey,parentSpec] of Object.entries(childToParent)){
    const cleanChild = childKey.startsWith("c_")?childKey:childKey;
    if(typeof parentSpec==="string") addRelation(parentSpec, cleanChild,"");
    else if(Array.isArray(parentSpec)) parentSpec.forEach(p=>addRelation(p, cleanChild,""));
    else if(typeof parentSpec==="object") for(const [p,rel] of Object.entries(parentSpec)) addRelation(p, cleanChild, rel);
  }
  return parentToChild;
}

// --- 時代跨ぎ欠ノード生成 ---
function insertMissingNodesMultiEra(data){
  const newGroups={};
  for(const [parent,children] of Object.entries(data.groups)){
    newGroups[parent]=newGroups[parent]||{};
    for(const [child,rel] of Object.entries(children)){
      let parentEras = Object.entries(data.images).filter(([p,g])=>g===parent).map(([p])=>parseEraScript(p).era);
      let childEras = Object.entries(data.images).filter(([p,g])=>g===child).map(([p])=>parseEraScript(p).era);
      if(child.startsWith("c_")) childEras=["コンピューター"];
      if(parent.startsWith("c_")) parentEras=["コンピューター"];
      if(parentEras.length===0 || childEras.length===0){ newGroups[parent][child]=rel; continue; }
      const minEraIdx=Math.min(...parentEras.map(e=>eraOrder.indexOf(e)));
      const maxEraIdx=Math.max(...childEras.map(e=>eraOrder.indexOf(e)));
      if(maxEraIdx-minEraIdx>1){
        let prev=parent;
        for(let i=minEraIdx+1;i<maxEraIdx;i++){
          const missingEra=eraOrder[i];
          const missingNodeId=`missing_${parent}_${missingEra}`;
          newGroups[missingNodeId]=newGroups[missingNodeId]||{};
          newGroups[prev][missingNodeId]="";
          prev=missingNodeId;
        }
        newGroups[prev][child]=rel;
      } else newGroups[parent][child]=rel;
    }
  }
  Object.assign(data.groups,newGroups);
}

// --- 各時代内での階層数に応じたダミーノード生成 ---
function insertEraLayerNodes(data){
  const eraMaxDepth={};
  eraOrder.forEach(era=>{
    const eraGroups=new Set();
    for(const [path,g] of Object.entries(data.images)) if(parseEraScript(path).era===era) eraGroups.add(g);
    for(const gId of Object.keys(data.groups)){
      if(gId.startsWith('missing_')&&gId.endsWith(`_${era}`)) eraGroups.add(gId);
      if(era==="コンピューター" && gId.startsWith('c_')) eraGroups.add(gId);
    }
    if(eraGroups.size===0){ eraMaxDepth[era]=0; return; }
    const memo={},visiting=new Set();
    function getDepthEra(node){
      if(memo[node]!==undefined) return memo[node];
      if(visiting.has(node)){ memo[node]=0; return 0; }
      visiting.add(node);
      const parents=[];
      for(const [parent,children] of Object.entries(data.groups)){
        if(!eraGroups.has(parent)) continue;
        if(!children) continue;
        if(Object.prototype.hasOwnProperty.call(children,node) && eraGroups.has(node)) parents.push(parent);
      }
      memo[node]=parents.length?Math.max(...parents.map(p=>getDepthEra(p)))+1:0;
      visiting.delete(node);
      return memo[node];
    }
    let maxDepth=0;
    for(const g of eraGroups){ const d=getDepthEra(g); if(d>maxDepth) maxDepth=d; }
    eraMaxDepth[era]=maxDepth;
  });

  const dummyOrder=[];
  eraOrder.forEach(era=>{
    const maxDepth=eraMaxDepth[era]??0;
    for(let i=0;i<=maxDepth;i++){
      const nodeId=`layer_${era}_${i}`;
      if(!data.groups[nodeId]) data.groups[nodeId]={};
      dummyOrder.push(nodeId);
    }
  });
  for(let i=0;i<dummyOrder.length-1;i++){
    const a=dummyOrder[i],b=dummyOrder[i+1];
    if(!data.groups[a]) data.groups[a]={};
    data.groups[a][b]="";
  }
}

function createGroupSubgraph(groupId, era, data){
  if(groupId.startsWith("missing_")){const nodeId=safeId(groupId);return `  ${nodeId}["（欠）"]\n  style ${nodeId} fill:none,stroke:none,stroke-width:1px\n`;}
  if(groupId.startsWith("layer_")){const nodeId=safeId(groupId);return `  ${nodeId}[" "]\n  style ${nodeId} fill:none,stroke:none,stroke-width:0px\n`;}
  if(groupId.startsWith("c_")){const nodeId=safeId(groupId);const label=`<div class='string-node'>${groupId.slice(2)}</div>`;return `  ${nodeId}["${label}"]\n  style ${nodeId} fill:white,stroke:#333,stroke-width:1px\n`;}
  const safeGroupId=safeId(groupId);
  let code=`  subgraph ${safeGroupId}[ ]\n`;
  const chars=Object.entries(data.images).filter(([p,g])=>g===groupId && (!era||parseEraScript(p).era===era));
  chars.forEach(([path],idx)=>{const nodeId=safeId(`${groupId}_${idx}`);const label=`<div class='glyph-box' data-src='images/${path}.png'></div><br>${parseEraScript(path).script}`;code+=`    ${nodeId}["${label}"]\n    style ${nodeId} fill:white,stroke:#333,stroke-width:1px\n`;});
  code+=`  end\n`;const color=groupColors[era]||"#ccc";code+=`  style ${safeGroupId} fill:none,stroke:${color},stroke-width:4px\n`;return code;
}

function createEraSubgraph(era, allGroups, data){
  const safeEraId=safeId(`era_${era}`);let code=`subgraph ${safeEraId}[${era}]\n`;
  allGroups.forEach(g=>code+=createGroupSubgraph(g, era, data));
  code+=`end\n`;const color=eraColors[era]||"#fff";code+=`style ${safeEraId} fill:${color},stroke:#333,stroke-width:2px\n`;return code;
}

async function main(){
  const imagesHash=await fetchJSONHash('images.json');
  const groupsHash=await fetchJSONHash('groups.json');
  const cacheKey=`mermaidSVGCache_${imagesHash}_${groupsHash}`;

  let cachedSVG=localStorage.getItem(cacheKey);
  let data=await loadData();
  if(!cachedSVG){
    data.groups=invertGroups(data.groups,data.images);
    (function autoGenerateGroups(){
      const allGroupIdsFromChars=new Set(Object.values(data.images));
      const allGroupIdsFromRelations=new Set();
      Object.entries(data.groups).forEach(([parent,children])=>{allGroupIdsFromRelations.add(parent);Object.keys(children).forEach(child=>allGroupIdsFromRelations.add(child));});
      const allGroups=new Set([...allGroupIdsFromChars,...allGroupIdsFromRelations]);
      allGroups.forEach(gId=>{if(!data.groups[gId]) data.groups[gId]={};});
    })();
    insertMissingNodesMultiEra(data);
    insertEraLayerNodes(data);

    let mermaidCode=`%%{init: {"flowchart": {"nodeSpacing": 70, "rankSpacing": 120}}}%%\ngraph TD\n`;
    const allGroupIds=Object.keys(data.groups);
    eraOrder.forEach(era=>{
      const groupsInEra=allGroupIds.filter(gId=>{
        if(gId.startsWith("c_")) return era==="コンピューター";
        const hasImageInEra=Object.entries(data.images).some(([p,g])=>g===gId && parseEraScript(p).era===era);
        const isMissingForEra=gId.startsWith(`missing_`) && gId.endsWith(`_${era}`);
        const isLayerForEra=gId.startsWith(`layer_${era}_`);
        return hasImageInEra || isMissingForEra || isLayerForEra;
      });
      mermaidCode+=createEraSubgraph(era,groupsInEra,data);
    });
    for(const [parent,children] of Object.entries(data.groups)){
      for(const [child,rel] of Object.entries(children)){
        const label=rel?`|${rel}|`:"";
        mermaidCode+=`${safeId(parent)} -->${label} ${safeId(child)}\n`;
      }
    }
    const { svg } = await mermaid.render('theGraph', mermaidCode);
    cachedSVG=svg;
    setCache(cacheKey,svg);
  }

  const container=document.getElementById('mermaid-tree');
  container.innerHTML=cachedSVG;

  const svgElement=container.querySelector('svg');
  svgElement.removeAttribute('width');svgElement.removeAttribute('height');
  svgElement.style.width='100%';svgElement.style.height='100%';

  // 遅延ロード＆監視
  const displayState=new Set();
  const observer=new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      const div=entry.target;
      const nodeId=div.dataset.src;
      if(entry.isIntersecting){
        if(!div.querySelector('img')){
          const newImg=document.createElement('img');
          newImg.src=nodeId;
          div.appendChild(newImg);
        } else div.querySelector('img').style.display='block';
        displayState.add(nodeId);
      } else {
        const img=div.querySelector('img');
        if(img) img.style.display='none';
        displayState.delete(nodeId);
      }
    });
  },{root: svgElement, rootMargin:'100px'});
  svgElement.querySelectorAll('.glyph-box').forEach(div=>observer.observe(div));

  // 現代ノードクリック選択
  svgElement.querySelectorAll('.string-node').forEach(node=>{
    node.style.cursor='text';
    node.addEventListener('click',()=>{const range=document.createRange();range.selectNodeContents(node);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);});
  });
  svgElement.addEventListener('click',e=>{const targetClass=e.target.getAttribute('class')||'';if(!targetClass.includes('string-node'))window.getSelection().removeAllRanges();});

  // PanZoom
  const params=new URLSearchParams(window.location.search);
  const startX=params.has('x')?parseFloat(params.get('x')):426.1;
  const startY=params.has('y')?parseFloat(params.get('y')):-3424.0;
  const startZoom=params.has('zoom')?parseFloat(params.get('zoom')):5.00;
  const panZoomInstance=svgPanZoom(svgElement,{zoomEnabled:true,panEnabled:true,controlIconsEnabled:false,minZoom:0.3,maxZoom:10,zoomScaleSensitivity:0.3,dblClickZoomEnabled:false});
  panZoomInstance.zoom(startZoom);
  panZoomInstance.pan({x:startX,y:startY});
  const statusBar=document.getElementById('status-bar');
  function updateStatus(){
    const pan=panZoomInstance.getPan();
    const zoom=panZoomInstance.getZoom();
    statusBar.textContent=`x: ${pan.x.toFixed(1)}, y: ${pan.y.toFixed(1)}, zoom: ${zoom.toFixed(2)}`;
    const newUrl=`${location.origin}${location.pathname}?x=${pan.x.toFixed(1)}&y=${pan.y.toFixed(1)}&zoom=${zoom.toFixed(2)}`;
    window.history.replaceState({},'',newUrl);
  }
  svgElement.addEventListener('mousemove',updateStatus);
  svgElement.addEventListener('wheel',updateStatus);

  // 検索
  function performSearch(){
    const query=document.getElementById('search-input').value.trim();
    if(!query) return;
    const allNodes=svgElement.querySelectorAll('.string-node');
    let foundNode=null;
    allNodes.forEach(node=>{if(node.textContent.trim()===query) foundNode=node;});
    if(!foundNode){alert("見つかりませんでした");return;}
    panZoomInstance.disablePan();panZoomInstance.disableZoom();
    panZoomInstance.zoom(5);
    let prevPan={x:null,y:null};
    function panStep(){
      const bbox=foundNode.getBoundingClientRect();
      const svgBBox=svgElement.getBoundingClientRect();
      const pan=panZoomInstance.getPan();
      const zoom=panZoomInstance.getZoom();
      const offsetX=(bbox.x+bbox.width/2-svgBBox.width/2)/zoom;
      const offsetY=(bbox.y+bbox.height/2-svgBBox.height/2)/zoom;
      const newX=pan.x-offsetX;
      const newY=pan.y-offsetY;
      panZoomInstance.pan({x:newX,y:newY});
      updateStatus();
      if(prevPan.x!==null && Math.round(prevPan.x*10)/10===Math.round(newX*10)/10 && Math.round(prevPan.y*10)/10===Math.round(newY*10)/10){
        panZoomInstance.enablePan();panZoomInstance.enableZoom();return;
      }
      prevPan={x:newX,y:newY};
      setTimeout(panStep,5);
    }
    panStep();
  }
  document.getElementById('search-btn').addEventListener('click',performSearch);
  document.getElementById('search-input').addEventListener('keydown',e=>{if(e.key==="Enter"){e.preventDefault();performSearch();}});
}

main();
