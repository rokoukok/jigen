import { loadData, fetchJSONHash, setCache, clearSVGCache } from './data.js';
import { createGroupSubgraph } from './graph.js';
import { invertGroups, safeId } from './utils.js';
import { parseEraScript, eraPalette, descTranslations, strokeFor } from './palette.js';

// URLパラメータで強制クリア（存在すればキャッシュをクリアして URL から削除）
const params = new URLSearchParams(window.location.search);
if(params.has('clearCache') || params.has('clearcache')){
  try {
    clearSVGCache();
  } catch(e){
    // clear が失敗しても続行
  }
  try {
    // 現在のクエリから clearCache / clearcache を削除して URL を正規化（履歴置換）
    const p = new URLSearchParams(window.location.search);
    p.delete('clearCache');
    p.delete('clearcache');
    const newUrl = `${location.origin}${location.pathname}${p.toString() ? '?'+p.toString() : ''}${location.hash || ''}`;
    window.history.replaceState({}, '', newUrl);
  } catch(e){
    // URL 書換に失敗しても処理継続
  }
}

// --- メイン処理 ---
export async function main(){
  // モバイル判定: userAgent に加えタッチ環境の判定も使う
  const isMobile = (typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad|Phone/i.test(navigator.userAgent))
                   || (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  // --- 追加: グラフ描画領域高さ自動調整 ---
  function adjustTreeHeight(){
    const Header = document.getElementById('site-header');
    const Footer = document.getElementById('site-footer');
    const container = document.getElementById('mermaid-tree');
    if(!container) return;
    const HeaderHeight = Header ? Header.offsetHeight : 0;
    const FooterHeight = Footer ? Footer.offsetHeight : 0;
    const windowHeight = window.innerHeight;
    // 元の実装に合わせて余白を確保（114 は元コード由来の固定オフセット）
    const treeHeight = Math.max(100, windowHeight - HeaderHeight - FooterHeight - 2);
    container.style.height = `${treeHeight}px`;
  }
  // 初回調整とリサイズ監視
  adjustTreeHeight();
  window.addEventListener('resize', adjustTreeHeight);
  // --- /追加 ---

  const imagesHash = await fetchJSONHash('images.json');
  const groupsHash = await fetchJSONHash('groups.json');

  // --- 追加: 画像フォルダと重要な JS ファイルの更新を検出するためのアセットハッシュを作る ---
  async function digestHex(inputStr){
    if(window.crypto && crypto.subtle && typeof TextEncoder !== 'undefined'){
      try{
        const buf = new TextEncoder().encode(inputStr);
        const digest = await crypto.subtle.digest('SHA-1', buf);
        const arr = Array.from(new Uint8Array(digest));
        return arr.map(b => b.toString(16).padStart(2,'0')).join('');
      }catch(e){}
    }
    // フォールバック: 単純な数値ハッシュ
    let h = 0;
    for(let i=0;i<inputStr.length;i++) h = (h*31 + inputStr.charCodeAt(i)) >>> 0;
    return h.toString(16);
  }

  async function fetchDirFilenames(dirUrl){
    try{
      const r = await fetch(dirUrl);
      if(!r.ok) return [];
      const txt = await r.text();
      const re = /href=["']([^"']+\.(?:png|jpg|jpeg|gif|svg))["']/ig;
      const names = [];
      for(const m of txt.matchAll(re)){
        try{
          const fn = decodeURIComponent(m[1].split('/').pop());
          names.push(fn);
        }catch(e){}
      }
      return Array.from(new Set(names)).sort();
    }catch(e){
      return [];
    }
  }

  async function fetchHeadInfo(url){
    try{
      const r = await fetch(url, { method: 'HEAD' });
      if(!r || !r.ok) return null;
      const lm = r.headers.get('last-modified') || r.headers.get('etag') || r.headers.get('content-length') || '';
      return lm;
    }catch(e){
      return null;
    }
  }

  async function computeAssetsHash(){
    // 画像フォルダ（images/）のファイル名一覧と HEAD の更新情報を集めるのみ（JS は含めない）
    const files = await fetchDirFilenames('images/');
    const parts = [];
    if(files.length){
      for(const fn of files){
        const info = await fetchHeadInfo(`images/${encodeURIComponent(fn)}`);
        parts.push(`${fn}|${info||''}`);
      }
    } else {
      // 取得できない場合は images.json の内容をフォールバックに使う
      parts.push(JSON.stringify(Object.keys(imagesHash || {})));
    }
    const joined = parts.join('||');
    return await digestHex(joined);
  }

  let assetsHash = '';
  try{
    assetsHash = await computeAssetsHash();
  }catch(e){
    assetsHash = ''; // フォールバック
  }
  // --- 追加: 早期に character を取得して正規化し、キャッシュキーに含める ---
  const charParams = new URLSearchParams(window.location.search);
  // 小文字 'character' を使う（大文字 'Character' の対応は削除）
  // パラメータが無ければ null を返し、内部では未指定を "none 相当" として扱う（URL は変更しない）
  const charParam = charParams.has('character') ? String(charParams.get('character')).toLowerCase() : null;
  const showGraphEarly = (charParam && String(charParam).toLowerCase() !== 'none');
  // キャッシュキー: character が無い場合は空文字を使う
  const cacheKey = `mermaidSVGCache_${imagesHash}_${groupsHash}_${assetsHash}_${charParam || ''}`;
  // --- /追加 ---

  let cachedSVG = localStorage.getItem(cacheKey);
  let data = await loadData(); // now returns { images: dataImages, groups: groupsRaw }

  // --- 追加: 元の groups.json を後で検索に使えるよう複製して保持 ---
  const groupsRaw = JSON.parse(JSON.stringify(data.groups || {}));
  // デバッグ: 読み込んだ groupsRaw の概要を出力
  try {
    console.log('[jigen] groupsRaw loaded, total keys:', Object.keys(groupsRaw).length);
    // c_ で始まるキーの一部を表示（確認用）
    const cKeys = Object.keys(groupsRaw).filter(k => k.startsWith('c_')).slice(0,20);
    console.log('[jigen] sample c_ keys:', cKeys);
    console.log('[jigen] cacheKey:', cacheKey);
  } catch(e){ console.warn('[jigen] debug log failed', e); }
  // --- 追加: グラフ非表示でも検索が動作するように、早めに検索イベントを登録 ---
  try {
    const searchBtn = document.getElementById('search-btn');
    const searchInput = document.getElementById('search-input');
    if(searchBtn){
      searchBtn.addEventListener('click', ()=>{
        console.log('[jigen] search button clicked');
        try{ handleSearch(); } catch(err){ console.error('[jigen] handleSearch error', err); }
      });
      console.log('[jigen] search button listener registered');
    }
    if(searchInput){
      searchInput.addEventListener('keydown', e=>{
        if(e.key === 'Enter'){ e.preventDefault(); console.log('[jigen] search input Enter pressed'); try{ handleSearch(); }catch(err){ console.error('[jigen] handleSearch error', err); } }
      });
      console.log('[jigen] search input listener registered');
    }
  } catch(e){
    console.warn('[jigen] failed to register search listeners', e);
  }
  // --- /追加 ---

  // character=none の場合はここでグラフ生成処理を完全にスキップ（軽量プレースホルダ表示）
  if(!showGraphEarly){
    const container = document.getElementById('mermaid-tree');
    if(container){
      container.innerHTML = `<div class="graph-disabled" style="padding:1em;color:#666;">グラフは無効です（character=none）。URL に <code>?character=all</code> 等を付けてください。</div>`;
      adjustTreeHeight();
    }
    return;
  }

  if(!cachedSVG){
    // groupsRaw の各エントリは { images?: ..., parents?: ... }
    // c_ の正規化は行わず、そのまま child->parent を構築する
    const childToParent = {};
    Object.entries(data.groups).forEach(([childId, info])=>{
      const parents = (info && info.parents !== undefined) ? info.parents : "";
      childToParent[childId] = parents;
    });

    // 元の groups.json の定義済みグループ一覧と元の定義オブジェクトを保持（この直前の data.groups は groupsRaw)
    const originalGroups = Object.keys(data.groups).slice();
    // NOTE: groupsRaw は外側で既に定義済みのため再定義しない（デバッグのため保持）
 
    data.groups = invertGroups(childToParent, data.images);

    // --- 追加: character が none/all 以外 の場合は c_<漢字> を起点に親を遡って
    //           表示対象の漢字集合を作り、data.groups / data.images を絞り込む ---
    try {
      const charValue = String(charParam || '').trim();
      if(charValue && charValue !== 'none' && charValue !== 'all'){
        console.log('[jigen] building restricted graph for character (new mode):', charValue);
        const kanji = charValue;
        const displayedGroups = new Set();
        const startKey = `c_${kanji}`;
        if(!(groupsRaw && groupsRaw.hasOwnProperty(startKey))){
          console.log('[jigen] start c_ key not found:', startKey);
        }
        // 1) 漢字に属する全グループ（例: 弌1..弌N）を追加
        Object.keys(groupsRaw).forEach(gId=>{
          if(!gId) return;
          const base = (gId.startsWith('missing_') ? gId.slice('missing_'.length) : gId).match(/^[^\d]+/);
          const gBase = base ? base[0] : gId;
          if(gBase === kanji) displayedGroups.add(gId);
        });
        // 2) 各漢字グループについて (a) その parents を表示対象に追加、(b) そのグループを parents に持つグループを追加
        const kanjiGroupsArray = Array.from(displayedGroups);
        kanjiGroupsArray.forEach(gId=>{
          const gInfo = groupsRaw[gId] || {};
          const gParents = gInfo.parents || "";
          if(typeof gParents === 'string' && gParents){
            displayedGroups.add(gParents);
          } else if(Array.isArray(gParents)){
            gParents.forEach(p => { if(p) displayedGroups.add(p); });
          } else if(typeof gParents === 'object' && gParents){
            Object.keys(gParents).forEach(p => { if(p) displayedGroups.add(p); });
          }
          // groupsRaw を走査して「この gId を parents に持つグループ」を追加
          Object.entries(groupsRaw).forEach(([otherId, otherInfo])=>{
            if(!otherId) return;
            const op = otherInfo && otherInfo.parents !== undefined ? otherInfo.parents : "";
            if(typeof op === 'string'){
              if(op === gId) displayedGroups.add(otherId);
            } else if(Array.isArray(op)){
              if(op.includes(gId)) displayedGroups.add(otherId);
            } else if(typeof op === 'object' && op){
              if(Object.prototype.hasOwnProperty.call(op, gId)) displayedGroups.add(otherId);
            }
          });
        });
        // 3) data.groups と data.images を displayedGroups のみに絞る（ただし child-only のキーは確保する）
        const origGroups = data.groups || {};
        const filteredGroups = {};
        Object.entries(origGroups).forEach(([parent, children])=>{
          if(!displayedGroups.has(parent)) return;
          const keepChildren = {};
          Object.entries(children || {}).forEach(([child, rel])=>{
            if(displayedGroups.has(child)) keepChildren[child] = rel;
          });
          filteredGroups[parent] = keepChildren;
        });
        // child-only ノードがあればキーを確保
        Array.from(displayedGroups).forEach(g=>{
          if(!filteredGroups[g]) filteredGroups[g] = {};
        });
        data.groups = filteredGroups;
        // images をフィルタ
        const origImages = data.images || {};
        const filteredImages = {};
        Object.entries(origImages).forEach(([path, grp])=>{
          if(displayedGroups.has(grp)) filteredImages[path] = grp;
        });
        data.images = filteredImages;
        console.log('[jigen] displayedGroups:', Array.from(displayedGroups));
        console.log('[jigen] filtered groups/images sizes:', Object.keys(data.groups).length, Object.keys(data.images).length);
      } // /if character specific
    } catch(e){
      console.warn('[jigen] restricted-graph build error', e);
    }
    // --- /追加 ---

    // --- 追加: groups.json に定義されているグループ（originalGroups）を
    // invertGroups の結果にも必ずキーとして残す（親無しの c_ ノード等を保持）
    // originalGroups.forEach(gId => {
    //   if(!gId) return;
    //   if(!data.groups[gId]) data.groups[gId] = {};
    // });
    // 制限モード（character 指定で部分グラフを作っている場合）は
    // originalGroups を復活させない（非対象グループを描画しない）
    const inRestrictedMode = (charParam && String(charParam).toLowerCase() !== 'none' && String(charParam).toLowerCase() !== 'all');
    if(!inRestrictedMode){
      originalGroups.forEach(gId => {
        if(!gId) return;
        if(!data.groups[gId]) data.groups[gId] = {};
      });
    } else {
      console.log('[jigen] restricted mode active — not restoring originalGroups');
    }
    // --- /追加 ---

    let mermaidCode = `%%{init: {"flowchart": {"nodeSpacing": 0, "rankSpacing": 0}}}%%\ngraph LR\n`;
    // 選択中の漢字（URL パラメータ character）を比較用に正規化して保持
    const selKanji = String(charParam || '').trim();
    const allGroupIds = Object.keys(data.groups);

    // （変更）漢字ごとのサブグループ作成: 未定義グループは同漢字内の "未定義" サブグループにまとめる
    const kanjiMap = {};
    // undefinedGroups: originalGroups に含まれていないグループ
    const undefinedGroups = new Set(allGroupIds.filter(id => !originalGroups.includes(id)));
    allGroupIds.forEach(gId => {
      if(!gId) return;
      // 基底漢字（先頭の非数字部分）を取得してグループ化
      const baseRaw = (gId.startsWith('missing_') ? gId.slice('missing_'.length) : gId);
      const baseLetters = (baseRaw.match(/^[^\d]+/) || [baseRaw])[0] || baseRaw;
      const kanji = baseLetters || 'その他';

      if(!kanjiMap[kanji]) kanjiMap[kanji] = { defined: [], undef: [] };
      if(undefinedGroups.has(gId)) kanjiMap[kanji].undef.push(gId);
      else kanjiMap[kanji].defined.push(gId);
    });
    Object.entries(kanjiMap).forEach(([kanji, bucket]) => {
      const safeKanjiId = safeId(`kanji_${kanji || 'その他'}`);
      const label = kanji || 'その他';
      // 検索対象があり、かつこの漢字が検索された漢字でない場合は
      // ヘッダラベルをリンク化して新規タブで character=<漢字> を開く
      let headerLabel = label;
      if(selKanji && kanji !== selKanji){
        try {
          const url = `${location.origin}${location.pathname}?character=${encodeURIComponent(kanji)}`;
          headerLabel = `<a style="color: black; text-decoration: underline;" href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        } catch(e){
          headerLabel = label;
        }
      }
      mermaidCode += `subgraph ${safeKanjiId}[${headerLabel}]\n`;
      // まず定義済グループを通常どおり追加
      bucket.defined.forEach(gId => {
        // variants として他の c_ ノードに埋め込まれているグループはここで描画しない
        if(data && data._embeddedVariants && data._embeddedVariants.has(gId)) return;
        mermaidCode += createGroupSubgraph(gId, null, data, false, groupsRaw);
      });
      // 未定義グループは漢字単位の単一グループIDにまとめて展開する
      if(bucket.undef.length){
        const undefGroupId = `undefined_${kanji || 'その他'}`;
        const safeUndefGroup = safeId(undefGroupId);
        mermaidCode += `  subgraph ${safeUndefGroup}[未定義]\n`;
        // compute era color for the undefined_<漢字> group by scanning contained images
        // undefined グループ全体の色は、そのグループに含まれる画像の最小 eraIdx を使う
        let undefEraIdxs = [];
        const undefEraIdx = undefEraIdxs.length ? Math.min(...undefEraIdxs) : null;
        // 未定義ノードは基本的に黄色で目立たせる（西周/春秋/戦国が見つかれば中期色を使う）
        let undefFill = "#FFEB3B";
        if(undefEraIdx !== null && eraPalette.hasOwnProperty(undefEraIdx)){
          const p = eraPalette[undefEraIdx];
          undefFill = Array.isArray(p) ? (p[1] || p[0]) : p;
        }
        const undefStroke = strokeFor(undefFill);
        // NOTE: style は子ノード出力後に追加します（下側へ移動）

         // 各未定義グループ(gId) を個別サブグラフとしてではなく、
         // この undefined_<漢字> 内のノードとして展開（画像ID を表示）
         bucket.undef.forEach(gId => {
           const chars = Object.entries(data.images).filter(([p,g]) => g === gId);
           const groupNodeId = safeId(gId);
           // 表示ラベルは可能なら画像や時代/説明を含めるが、最低限グループID を表示
           let label = `${gId}`;
           if(chars.length > 0){
             // 代表例として最初の画像情報をラベルに含める（視認性向上）
             const [firstPath] = chars;
             const parsed = parseEraScript(firstPath[0]);
             const eraText = parsed.era || "";
             const scriptText = parsed.script || (descTranslations[firstPath[0].split('/')[0]] || firstPath[0].split('/')[0]);
             label = `<div class='glyph-box' data-src='images/${firstPath[0]}.png'></div><br>${eraText}<br>${scriptText.replace(/\//g,' ')} ${firstPath[0].split('/')[1] || ''}`;
           }
           // ノード定義（必ず safeId(gId) を使う）
           // 個々の group ノードは背景色を変更せず、createGroupSubgraph の出力に任せる
           mermaidCode += `    ${groupNodeId}["${label}"]\n`;
           mermaidCode += `    style ${groupNodeId} fill:white,stroke:${undefStroke},stroke-width:1px\n`;
         });
        // children 出力が終わった後で親サブグラフの style を追加（子の fill による上書きを避けるため）
        // 半透明にするため fill-opacity と stroke-opacity を追加
        mermaidCode += `  style ${safeUndefGroup} fill:${undefFill},fill-opacity:0.6,stroke:none\n`;
        mermaidCode += `  end\n`;
      }
      mermaidCode += `end\n`;
      // 漢字グループは半透明にしない
      // 検索中の漢字がある場合は「検索した漢字以外」を灰色にする。
      // - 検索対象 (selKanji) が無ければ従来どおり白背景
      // - selKanji がある場合、kanji === selKanji のとき白、それ以外は薄い灰で塗る
      if(selKanji){
        if(kanji === selKanji){
          mermaidCode += `style ${safeKanjiId} fill:white,stroke:#666,stroke-width:2px\n`;
        } else {
          mermaidCode += `style ${safeKanjiId} fill:#EEEEEE,stroke:#999,stroke-width:1px\n`;
        }
      } else {
        mermaidCode += `style ${safeKanjiId} fill:white,stroke:#666,stroke-width:2px\n`;
      }
    });

    // --- 追加: groups.json の元定義(groupsRaw) を参照して class:"象形" のグループ用に
    // 見た目のないノードを生成し、そのノードから該当グループへの "象形" リレーションを作る
    const extraClassEdges = [];
    try {
      Object.entries(groupsRaw || {}).forEach(([gId, info]) => {
        if(info && info.class === '象形'){
          const classNodeName = `__class_${gId}`;
          // 見た目のないノードを出力（空ラベル + 非表示スタイル）
          mermaidCode += `${safeId(classNodeName)}[\" \"]\n`;
          mermaidCode += `style ${safeId(classNodeName)} fill:none,stroke:none\n`;
          // 親=classNode -> 子=gId, rel='象形'
          extraClassEdges.push({ parent: classNodeName, child: gId, rel: '象形' });
        }
      });
    } catch(e){
      // 無視
    }
    
    // relations (parent -> child)
    // 各 rel に応じてコネクタ／スタイルを変えて出力し、後で linkStyle を適用する
    const edges = [];
    Object.entries(data.groups).forEach(([parent, children]) => {
      Object.entries(children).forEach(([child, rel]) => {
        edges.push({ parent, child, rel });
      });
    });
    // groupsRaw に基づく象形エッジを追加
    // ただし extraClassEdges は、描画対象に含まれる child（data.groups に存在）だけ追加する
    if(extraClassEdges.length){
      const filteredExtra = extraClassEdges.filter(e => data.groups && Object.prototype.hasOwnProperty.call(data.groups, e.child));
      if(filteredExtra.length) edges.push(...filteredExtra);
    }


    // edges を mermaidCode に出力（ラベル文字は表示しない）
    edges.forEach(e => {
      // rel に基づいてコネクタ文字列を選択（矢印/破線/点線 等）
      let connector = '-->'; // デフォルトは矢印
      if(e.rel === '分化' || e.rel === '疑' || e.rel === '部件') connector = '-.->'; // 破線矢印
      else if(e.rel === '象形') connector = '-.-'; // 点線・矢印なし
      // ラベルなしで出力（見た目のスタイルは linkStyle 側で制御）
      mermaidCode += `${safeId(e.parent)} ${connector} ${safeId(e.child)}\n`;
    });
    // linkStyle を追加：rel ごとに色・線幅・破線パターンを設定
    edges.forEach((e, idx) => {
      const rel = e.rel;
      let styles = [];
      styles.push('stroke-width:4px');
      if(rel === '声符'){
        styles.push('stroke:#06c');
      } else if(rel === '分化'){
        styles.push('stroke:#06c','stroke-dasharray:10 5');
      } else if(rel === '義符'){
        styles.push('stroke:#f00');
      } else if(rel === '部件' || rel === '指事'){
        styles.push('stroke:#f00','stroke-dasharray:10 5');
      } else if(rel === '象形'){
        styles.push('stroke:#6c6','stroke-dasharray:10 5');
      } else if(rel === '疑'){
        styles.push('stroke:#333','stroke-dasharray:10 5');
      } else {
        styles.push('stroke:#333');
      }
      if(styles.length) mermaidCode += `linkStyle ${idx} ${styles.join(',')}\n`;
    });
 
    const { svg } = await mermaid.render('theGraph', mermaidCode);
    cachedSVG = svg;
    setCache(cacheKey, svg);
  }

  const container=document.getElementById('mermaid-tree');

   container.innerHTML = cachedSVG;

  // 追加: グラフ直下に「矢印の種類」凡例を表示（既にあれば再作成しない）
  (function insertArrowLegend(){
    try {
      // 既存の凡例（graph-legend）と競合しないよう個別 ID を使う
      if(document.getElementById('graph-arrow-legend')) return;
      const parent = container.parentNode || document.body;
      const legend = document.createElement('div');
      legend.id = 'graph-arrow-legend';
      legend.className = 'legend-section arrow-legend';
      // タイトル
      const title = document.createElement('div');
      legend.appendChild(title);
      // リスト
      const list = document.createElement('div');
      list.className = 'legend-samples';
      // main.js の linkStyle と整合する配色・破線パターン
      const arrows = [
        {label:'演変', color:'#333', dash:false},
        {label:'疑演変', color:'#333', dash:true},
        {label:'声符', color:'#06c', dash:false},
        {label:'義符', color:'#f00', dash:false},
        {label:'分化', color:'#06c', dash:true},
        {label:'部件', color:'#f00', dash:true},
        {label:'象形', color:'#6c6', dash:true},
      ];
      arrows.forEach(a=>{
        const item = document.createElement('div');
        item.className = 'legend-item legend-arrow';
        const line = document.createElement('span');
        line.className = 'legend-line';
        line.style.borderTop = `4px ${a.dash ? 'dashed' : 'solid'} ${a.color}`;
        const lbl = document.createElement('span');
        lbl.className = 'legend-label';
        lbl.textContent = a.label;
        item.appendChild(line);
        item.appendChild(lbl);
        list.appendChild(item);
      });
      legend.appendChild(list);
      // 挿入位置: フッターの左（先頭）に格納（無ければ従来の位置へフォールバック）
      const footer = document.getElementById('site-footer');
      if(footer) footer.insertBefore(legend, footer.firstChild);
      else if(container && container.parentNode) container.parentNode.insertBefore(legend, container.nextSibling);
      else parent.appendChild(legend);
    } catch(e){
      // 無視
    }
  })();
  
  // SVG を挿入した直後にも高さを再調整（ステータス高さやレンダリング差分を考慮）
  adjustTreeHeight();

  const svgElement=container.querySelector('svg');
  svgElement.removeAttribute('width');svgElement.removeAttribute('height');
  svgElement.style.width='100%';
  svgElement.style.height='100%';
  // theGraph の最大横幅を親要素に合わせて 100% に制限
  svgElement.style.maxWidth='100%';

  // 遅延ロード＆監視
  const displayState=new Set();
    svgElement.querySelectorAll('.glyph-box').forEach(div=>{
      const nodeId = div.dataset.src;
      if(!div.querySelector('img')){
        const newImg = document.createElement('img');
        newImg.src = nodeId;
        div.appendChild(newImg);
      } else {
        div.querySelector('img').style.display = 'block';
      }
      displayState.add(nodeId);
    });
  
  // PanZoom
  const params=new URLSearchParams(window.location.search);
  const startX=params.has('x')?parseFloat(params.get('x')):0.00;
  const startY=params.has('y')?parseFloat(params.get('y')):0.00;
  const startZoom=params.has('z')?parseFloat(params.get('z')):1.00;
  const panZoomInstance = svgPanZoom(svgElement, {
    zoomEnabled: true,
    panEnabled: true,
    controlIconsEnabled: false,
    minZoom: 0.5,
    maxZoom: 20,
    zoomScaleSensitivity: 0.3,
    dblClickZoomEnabled: true
  });
  panZoomInstance.zoom(startZoom);
  panZoomInstance.pan({ x: startX, y: startY });
}