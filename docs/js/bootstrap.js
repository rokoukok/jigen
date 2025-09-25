import { main } from './main.js';

// --- mermaid のグローバル設定（maxTextSize を増やす） ---
try {
  if (typeof mermaid !== 'undefined' && mermaid.initialize) {
    mermaid.initialize({
      startOnLoad: false,
      maxTextSize: 200000,
      securityLevel: 'strict',
      flowchart: { nodeSpacing: 70, rankSpacing: 120 }
    });
  }
} catch (e) {
  // ignore
}

// reload リンク: 現在ページを再読み込み
try {
  const reload = document.getElementById('reload');
  if (reload) {
    reload.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        // URL のクエリから character を削除してから遷移（履歴を増やさない）
        const p = new URLSearchParams(window.location.search);
        p.delete('character');
        // 正常化した URL を生成
        const newUrl = `${location.origin}${location.pathname}${p.toString() ? '?'+p.toString() : ''}${location.hash || ''}`;
        // replace を使って現在の履歴エントリを置換（リロード相当の振る舞い）
        location.replace(newUrl);
      } catch (err) {
        // 万一失敗したら従来通りリロード
        try { location.reload(); } catch(e2){ /* ignore */ }
      }
    });
  }
} catch (e) {
  // ignore
}

// 追加: ヘッダに character を表示（存在する場合）
(function(){
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const el = document.getElementById('current-character');
    if(!el) return;
    if(urlParams.has('character')){
      const raw = String(urlParams.get('character') || '').trim();
      if(!raw || raw.toLowerCase() === 'none'){
        el.style.display = 'none';
      } else {
        const text = raw.toLowerCase() === 'all' ? '全表' : raw;
        el.textContent = text;
        el.style.display = 'inline-flex';
      }
    } else {
      el.style.display = 'none';
    }
  } catch(e){
    // ignore
  }
})();

// 全表ボタン
try {
  const showAllBtn = document.getElementById('show-all-btn');
  if (showAllBtn) {
    showAllBtn.addEventListener('click', () => {
      try {
        const allowed = new Set(['clearCache','character','x','y','z']);
        const p = new URLSearchParams(window.location.search);
        Array.from(p.keys()).forEach(k => { if(!allowed.has(k)) p.delete(k); });
        p.set('character','all');
        const newUrl = `${location.origin}${location.pathname}${p.toString() ? '?'+p.toString() : ''}${location.hash || ''}`;
        window.open(newUrl, '_blank', 'noopener');
      } catch (e) {
        window.open(`${location.origin}${location.pathname}?character=all`, '_blank', 'noopener');
      }
    });
  }
} catch (e) {
  // ignore
}

// 検索 UI に常時イベントを登録（main 実行済みならグローバル handler を呼ぶ）
(function(){
  const btn = document.getElementById('search-btn');
  const input = document.getElementById('search-input');

  async function fallbackSearch(){
    const raw = (input && input.value) || "";
    const query = String(raw).trim();
    if(!query) return;
    try {
      const r = await fetch('groups.json');
      if(!r.ok) throw new Error('groups.json fetch failed');
      const rawGroups = await r.json();
      const groups = flattenGroupsObj(rawGroups);
      // groups 内に "漢字数字" 形式のキーがあるか（例: 一1, 一2 ...）
      const matches = Object.keys(groups).filter(k => {
        const m = String(k).match(/^([^\d]+)(\d+)/);
        return m && m[1] === query;
      });
      if(matches.length){
        const matched = matches[0];
        const kanji = (matched.match(/^[^\d]+/) || [matched])[0] || query;
        const u = `${location.origin}${location.pathname}?character=${encodeURIComponent(kanji)}`;
        window.open(u, '_blank', 'noopener');
        return;
      }
    } catch(e){
      console.warn('[jigen] fallbackSearch failed', e);
    }
    alert('見つかりませんでした');
  }

  function onSearchTrigger(e){
    e && e.preventDefault && e.preventDefault();
    if(window.__jigen_handleSearch && typeof window.__jigen_handleSearch === 'function'){
      try { window.__jigen_handleSearch(); return; } catch(e){ console.warn('[jigen] __jigen_handleSearch failed', e); }
    }
    fallbackSearch();
  }

  try {
    if(btn) btn.addEventListener('click', onSearchTrigger);
    if(input) input.addEventListener('keydown', (ev)=>{ if(ev.key === 'Enter') onSearchTrigger(ev); });
  } catch(e){
    // ignore
  }
})();

// 動的生成: URL に character パラメータが存在する場合のみ mermaid-tree を生成して main() を呼ぶ
{
  const urlParams = new URLSearchParams(window.location.search);
  if(urlParams.has('character')){
    const root = document.getElementById('app-root') || document.body;
    if(!document.getElementById('mermaid-tree')){
      const mermaidTree = document.createElement('div');
      mermaidTree.id = 'mermaid-tree';
      root.appendChild(mermaidTree);
    }

    // 追加: character が存在し、かつ all でない場合に サイドバーを生成して charinfo.json を表示
    try {
      const rawChar = String(urlParams.get('character') || '').trim();
      const charVal = rawChar ? rawChar : null;
      if(charVal && charVal.toLowerCase() !== 'all'){
        // サイドバーが無ければ作る
        if(!document.getElementById('char-sidebar')){
          const sidebar = document.createElement('aside');
          sidebar.id = 'char-sidebar';
          // ヘッダにトグルボタンを追加（aria 属性付与）
          sidebar.innerHTML = `
            <div class="char-header">
              <button id="char-sidebar-toggle" aria-expanded="true" aria-label="サイドバーを閉じる">◀</button>
            </div>
            <div class="char-body">読み込み中…</div>`;
          // body にサイドバーを追加
          document.body.appendChild(sidebar);
          // body に has-sidebar クラスを付与（CSS で mermaid-tree の left を決める）
          document.body.classList.add('has-sidebar');
          // トグル要素をサイドバー内から切り出して body に固定配置する
          try {
            let t = document.getElementById('char-sidebar-toggle');
            if(t){
              // detach and append to body so it can be visible when sidebar is off-screen
              t.parentNode && t.parentNode.removeChild(t);
              // create a new button container to ensure predictable styling
              const togg = document.createElement('button');
              togg.id = 'char-sidebar-toggle';
              togg.setAttribute('aria-expanded','true');
              togg.setAttribute('aria-label','サイドバーを閉じる');
              togg.textContent = '◀';
              document.body.appendChild(togg);
              t = togg;
              // 常に展開された状態で開始（読み込み時に折りたたみ状態を復元しない）
              document.body.classList.remove('sidebar-collapsed');
              t.textContent = '◀';
              t.setAttribute('aria-expanded','true');
              t.setAttribute('aria-label','サイドバーを閉じる');
              // トグルイベント（ページ内のみで折りたたみ状態を切替、状態は保存しない）
              t.addEventListener('click', ()=>{
                const collapsedNow = document.body.classList.toggle('sidebar-collapsed');
                t.textContent = collapsedNow ? '▶' : '◀';
                t.setAttribute('aria-expanded', String(!collapsedNow));
                t.setAttribute('aria-label', collapsedNow ? 'サイドバーを開く' : 'サイドバーを閉じる');
              });
            }
          } catch(e){ /* ignore */ }
        }
        // charinfo.json から情報を取得して描画
        (async function loadCharInfo(){
          try {
            const r = await fetch('./charinfo.json');
            if(!r.ok) throw new Error('charinfo fetch failed');
            const json = await r.json();
            // info が見つからない場合は空オブジェクトにして続行（"字源" / "意味" は空表示）
            const info = (json && json[charVal]) ? json[charVal] : {};
            const body = document.querySelector('#char-sidebar .char-body');
            if(!body) return;

            // escape helper
            function escapeHtml(s){ return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

            // --- 追加: groups.json を読み込んで起源タイプと異体字を判定 ---
            let groups = {};
            try {
              const gresp = await fetch('./groups.json');
              if(gresp && gresp.ok){
                const rawG = await gresp.json();
                groups = flattenGroupsObj(rawG);
              }
            } catch(e) { /* 無視して続行 */ }

            // 対象漢字に属するグループキー集合（例: 呂14, 呂13, c_呂 等）
            const targetGroupKeys = new Set();
            Object.keys(groups).forEach(k=>{
              try {
                const base = (k.match(/^[^\d]+/)||[k])[0];
                if(base === charVal) targetGroupKeys.add(k);
                if(k === `c_${charVal}`) targetGroupKeys.add(k);
              } catch(e){}
            });

            // 起源タイプ検出
            const types = new Set();
            Object.entries(groups).forEach(([gId, gInfo])=>{
              if(!targetGroupKeys.has(gId)) return;
              try {
                if(gInfo && gInfo.class === '象形') types.add('象形。');
                const parents = gInfo && gInfo.parents;
                if(typeof parents === 'object' && parents){
                  Object.values(parents).forEach(rel=>{
                    if(rel === '声符') types.add('形声。');
                    else if(rel === '義符') types.add('会意。');
                    else if(rel === '分化') types.add('分化。');
                    else if(rel === '部件') types.add('象形。');
                    else if(rel === '指事') types.add('指事。');
                  });
                }
                // parents が文字列の場合はラベルが無いため判定できない（無視）
              } catch(e){}
            });

            // 形声がある場合は会意を表示しない
            if(types.has('形声。')) {
              types.delete('会意。');
            }

            // 異体字検出: c_ で始まる他のキーが targetGroupKeys のいずれかを parents に参照している場合
            const variants = new Set();
            // ヘルパ: 親指定が targetGroupKeys に含まれるか判定（親が groupKey／c_キー／配列／object の場合に対応）
            function parentReferencesTarget(parentSpec){
              if(!parentSpec) return false;
              if(typeof parentSpec === 'string') return targetGroupKeys.has(parentSpec) || targetGroupKeys.has(parentSpec.toString());
              if(Array.isArray(parentSpec)){
                return parentSpec.some(p => parentReferencesTarget(p));
              }
              if(typeof parentSpec === 'object'){
                // 親がオブジェクト形式ならキーが親グループID
                return Object.keys(parentSpec).some(p => parentReferencesTarget(p));
              }
              return false;
            }

            Object.entries(groups).forEach(([k, gInfo])=>{
              if(!k.startsWith('c_')) return;
              const otherChar = k.slice(2);
              if(otherChar === charVal) return; // 自身は除外
              try {
                const parents = gInfo && gInfo.parents;
                if(parentReferencesTarget(parents)) variants.add(otherChar);
              } catch(e){}
            });

            // 追加: targetGroupKeys に含まれるグループ自身が variants プロパティを持っている場合、それらを追加
            // variants は文字列または配列に対応
            Object.keys(groups).forEach(gId => {
              try {
                if(!targetGroupKeys.has(gId)) return;
                const g = groups[gId] || {};
                const v = g.variants || g.variant;
                if(!v) return;
                if(Array.isArray(v)){
                  v.forEach(ch => { if(ch && String(ch) !== charVal) variants.add(String(ch)); });
                } else {
                  const s = String(v).trim();
                  if(s && s !== charVal) variants.add(s);
                }
              } catch(e){}
            });

            // 追加: targetGroupKeys に含まれる各グループが持つ characters 配列を参照して、
            //        その groups の基底漢字と一致しない文字を異体字として追加する
            try {
              Object.keys(groups).forEach(gId => {
                if(!targetGroupKeys.has(gId)) return;
                try {
                  const info = groups[gId] || {};
                  const chars = info && (info.characters || info.chars || info.characters_list);
                  if(!chars) return;
                  const arr = Array.isArray(chars) ? chars : [chars];
                  // gId の基底漢字（例: "乙14" -> "乙"）
                  const base = (String(gId).match(/^[^\d]+/) || [String(gId)])[0];
                  arr.forEach(ch => {
                    try {
                      if(!ch) return;
                      const s = String(ch).trim();
                      // 基底漢字と異なるもの（かつ現在表示中の文字と同一でないもの）を variants に追加
                      if(s && s !== base && s !== charVal){
                        variants.add(s);
                      }
                    } catch(e){}
                  });
                } catch(e){}
              });
            } catch(e){/* ignore */ }

            // 追加: variants に含まれる各文字について、対応する c_<文字> ノードがあれば
            // そのノードの variants も再帰的に展開して variants に追加する
            (function expandVariantChains(){
              if(!groups || typeof groups !== 'object') return;
              const queue = Array.from(variants);
              const seen = new Set(queue);
              while(queue.length){
                const ch = queue.shift();
                if(!ch) continue;
                const checkKey = `c_${String(ch)}`;
                const grp = groups[checkKey];
                if(!grp) continue;
                const nested = grp.variants || grp.variant;
                if(!nested) continue;
                const arr = Array.isArray(nested) ? nested : [nested];
                arr.forEach(nch => {
                  try {
                    const s = String(nch).trim();
                    if(!s || s === charVal) return;
                    if(!seen.has(s)){
                      seen.add(s);
                      queue.push(s);
                      variants.add(s);
                    }
                  } catch(e){}
                });
              }
            })();

            // --- /追加 ---

            // 新レイアウト: 字源 -> 起源タイプ -> 異体字 -> info, 意味 -> 各 entry (mean / oc / 廃韻)
            const out = [];
            out.push(`<div class="char-side-content">`);
            // 大きい見出し: 字源
            out.push(`<h3 class="char-side-title">字源</h3>`);

            // 起源タイプ出力（あれば）
            if(types.size){
              out.push(`<div class="char-origin-types">`);
              const inline = Array.from(types).map(t => `<span class="char-origin-type">${escapeHtml(String(t))}</span>`).join('');
              out.push(inline);
              out.push(`</div>`);
            }

            // info 本文（{{...}} / [[...]] / {...} 置換および改行処理）
            out.push(`<div class="char-info">`);
            if(info.info){
               const raw = String(info.info || '');

              // 参照チェーンを辿って最終的なオブジェクトを返すヘルパー
              function resolveReference(id){
                // id: "舌2"
                const seen = new Set();
                let curId = id;
                while(curId && !seen.has(curId)){
                  seen.add(curId);
                  const m = String(curId).match(/^([^\d]+)(\d+)$/);
                  if(!m) break;
                  const b = m[1], i = m[2];
                  const obj = (json && json[b] !== undefined) ? json[b][i] : undefined;
                  if(obj === undefined) {
                    // not found
                    return { finalObj: null, finalBase: b, finalIdx: i };
                  }
                  if(typeof obj === 'string'){
                    // 次の参照へ
                    curId = obj;
                    continue;
                  }
                  // object found
                  return { finalObj: obj, finalBase: b, finalIdx: i };
                }
                // fallback: try single-step lookup
                const mm = String(id).match(/^([^\d]+)(\d+)$/);
                if(mm){
                  return { finalObj: (json && json[mm[1]] ? json[mm[1]][mm[2]] : null), finalBase: mm[1], finalIdx: mm[2] };
                }
                return { finalObj: null, finalBase: id, finalIdx: null };
              }

              // 1) {{...}} を置換（意味＋漢語形式） — 参照チェーンの最終オブジェクトから mean(先頭) と oc を取得
               let replaced = raw.replace(/\{\{\s*([^\}\s]+)\s*\}\}/g, (m, id)=>{
                try {
                  const mm = id.match(/^([^\d]+)(\d+)$/);
                  if(!mm) return escapeHtml(id);
                  const base = mm[1];
                  const idx = mm[2];
                  const res = resolveReference(id);
                  const final = res.finalObj;
                  // mean: 配列なら先頭要素
                  let meanText = base;
                  if(final && final.mean !== undefined){
                    meanText = Array.isArray(final.mean) ? (final.mean[0] || base) : final.mean;
                  }
                  const ocText = final && final.oc ? final.oc : '';
                  return `<b>${escapeHtml(meanText)}</b>を意味する漢語｛<b>${escapeHtml(base)}</b>/<span class="serif">*${escapeHtml(ocText)}</span>/｝`;
                } catch(e){
                  return escapeHtml(id);
                }
              });

              // 2) [[...]]（二重角括弧）を置換：表示は「原形 /*oc*/」で、oc は参照チェーンの最終オブジェクトから取得
               replaced = replaced.replace(/\[\[\s*([^\]\s]+)\s*\]\]/g, (m, id) => {
                try {
                  const mm = id.match(/^([^\d]+)(\d+)$/);
                  if(!mm) return escapeHtml(id);
                  const base = mm[1];
                  const res = resolveReference(id);
                  const final = res.finalObj;
                  const ocText = final && final.oc ? final.oc : '';
                  return `「${escapeHtml(base)}/<span class="serif">*${escapeHtml(ocText)}</span>/」`;
                } catch(e){
                  return escapeHtml(id);
                }
              });
              // 3) 次に {...}（単一ブレース）を置換（簡潔表示：｛漢字 /spanで上古音/｝）
              replaced = replaced.replace(/\{\s*([^\}\s]+)\s*\}/g, (m, id) => {
                try {
                  const mm = id.match(/^([^\d]+)(\d+)$/);
                  if(!mm) return escapeHtml(id);
                  const base = mm[1];
                  const res = resolveReference(id);
                  const final = res.finalObj;
                  const ocText = final && final.oc ? final.oc : '';
                  return `｛${escapeHtml(base)} /<span class="serif">*${escapeHtml(ocText)}</span>/｝`;
                } catch(e){
                  return escapeHtml(id);
                }
              });

               // replaced は既に挿入すべき HTML を含むため、そのまま改行だけ <br> に変換して出力する
               const infoHtml = replaced.replace(/\r?\n/g, '<br>');
               out.push(infoHtml);
            } else {
              // types に起源情報があれば「情報なし」を出さず空表示にする
              if(!types.size){
                out.push(`<i>情報なし</i>`);
              }
            }
            out.push(`</div>`);

            // 大きい見出し: 意味
            out.push(`<h3 class="char-side-title">漢語</h3>`);
            const entries = Object.keys(info).filter(k => k !== 'info').sort((a,b)=>isNaN(a)?1:(isNaN(b)?-1:(parseInt(a)-parseInt(b))));
            if(entries.length){
              entries.forEach(k => {
                const v = info[k];
                if(typeof v === 'object'){
                  // mean が配列なら全要素を「、」で結合して表示
                  const meanRaw = v.mean !== undefined ? (Array.isArray(v.mean) ? v.mean.join('、') : v.mean) : '—';
                  const mean = escapeHtml(meanRaw);
                  const oc = v.oc ? escapeHtml(v.oc) : '—';
                  const mc = v.mc ? escapeHtml(v.mc) : '—';
                  out.push(`<div class="char-meaning-item">`);
                  out.push(`<div class="char-meaning-num"><b>(${escapeHtml(k)})</b> ${mean}。</div>`);
                  out.push(`<ul class="char-phonetics"><p>上古音再構 : <span class="serif">*${oc}</span></p><p>中古音擬音 : <span class="serif">${mc}</span></p></ul>`);
                  out.push(`</div>`);
                } else {
                  // 非オブジェクト値: "漢字+数字" 参照 (例: "一1") の場合は参照先の意味を表示する
                  const sval = String(v || '').trim();
                  const refMatch = sval.match(/^([^\d]+)(\d+)$/);
                  const base = refMatch[1];
                  const idx = refMatch[2];
                  const refObj = json[base][idx] || {};
                  // 参照先の mean が配列なら全要素を「、」で結合して表示
                  const refMeanRaw = refObj.mean !== undefined ? (Array.isArray(refObj.mean) ? refObj.mean.join('、') : refObj.mean) : '—';
                  const refMean = escapeHtml(refMeanRaw);
                  const refOc = refObj.oc ? escapeHtml(refObj.oc) : '—';
                  const refMc = refObj.mc ? escapeHtml(refObj.mc) : '—';
                  out.push(`<div class="char-meaning-item">`);
                  out.push(`<div class="char-meaning-ref">→<b>${escapeHtml(base)} (${escapeHtml(idx)})</b> ${refMean}。</div>`);
                  out.push(`<ul class="char-phonetics"><p>上古音再構 : <span class="serif">*${refOc}</span></p><p>中古音擬音 : <span class="serif">${refMc}</span></p></ul>`);
                  out.push(`</div>`);
                }
              });
            } else {
              out.push(`<div class="char-meaning-item"><i>意味情報なし</i></div>`);
            }

            // 異体字出力（あれば）
            if(variants.size){
              out.push(`<h3 class="char-side-title">異体字</h3>`);
              out.push(`<div class="char-variants">`);
              // インラインで表示：各異体字を span にして「、」で区切る
              const inline = Array.from(variants).map(ch => `<span class="char-variant">${escapeHtml(ch)}</span>`).join(' ');
              out.push(inline);
              out.push(`</div>`);
            }

            out.push(`</div>`);
            body.innerHTML = out.join('');
          } catch(e){
            const body = document.querySelector('#char-sidebar .char-body');
            if(body) body.innerHTML = `<p>情報の取得に失敗しました。</p>`;
            console.warn('[jigen] loadCharInfo failed', e);
          }
        })();
      }
    } catch(e){
      // 無視して続行
    }
    // /追加

    main();
  } else {
    // character パラメータが無い場合：c_漢字一覧を生成して表示する
    (async function renderCList(){
      try {
        const resp = await fetch('groups.json');
        if(!resp.ok){ console.warn('[jigen] groups.json fetch failed'); return; }
        const rawGroups = await resp.json();
        const groups = flattenGroupsObj(rawGroups);
        // groups に数値付きキーが存在する漢字ベースを抽出（例: 一1 があれば "一" をリストにする）
        const bases = new Set();
        Object.keys(groups).forEach(k => {
          try {
            const m = String(k).match(/^([^\d]+)(\d+)/);
            if(m) bases.add(m[1]);
          } catch(e){}
        });
        const cKeys = Array.from(bases).sort((a,b)=>a.localeCompare(b,'ja'));
        if(!cKeys.length) { console.log('[jigen] no base-group keys found'); return; }

        const root = document.getElementById('app-root') || document.body;
        // 既に作成済みなら再利用
        let idx = document.getElementById('kanji-index');
        if(!idx){
          idx = document.createElement('div');
          idx.id = 'kanji-index';
          // サイト概要（簡易）
          const summary = document.createElement('div');
          summary.className = 'site-summary';
          summary.innerHTML = `
            <h3>字源（サイト概要）</h3>
            <p>このサイトは、漢字の字形がどのように変化してきたかを視覚的に追える辞典的ツールです。</p>
            <p>各グループは時代・系統・関係（例：声符・義符・象形 など）を持ち、系譜として表示されます。</p>
            <h4>基本的な使い方</h4>
            <ul>
              <li>上部の検索に漢字を入れて検索すると、その漢字に関連するグループを表示します。</li>
              <li>一覧から漢字を選ぶと、新しいタブで該当するグラフを開きます。</li>
            </ul>
            <h4>見方のポイント</h4>
            <ul>
              <li>サブグループの色は時代を示します。各ノードは代表図版や代表字を表示します。</li>
              <li>矢印は字形の関係を示します。</li>
            </ul>
            <p>まずは検索または一覧から興味のある漢字を開き、ノードをたどって変遷を確認してみてください。</p>
          `;
          idx.appendChild(summary);
          // 追加: site-summary とグリッドの間に見出しを表示
          const heading = document.createElement('div');
          heading.className = 'c-list-title';
          heading.innerHTML = `<h3 style="margin:0.6rem 0 0.4rem 0;">対応漢字一覧</h3>`;
          idx.appendChild(heading);
          // グリッド
          const grid = document.createElement('div');
          grid.className = 'kanji-grid';
          grid.id = 'kanji-grid';
          idx.appendChild(grid);
          root.appendChild(idx);
        } else {
          // 既存グリッドをクリア
          const existing = idx.querySelector('.kanji-grid');
          if(existing) existing.innerHTML = '';
        }

        const gridEl = idx.querySelector('.kanji-grid');
        // click handler: 表示漢字（base）を直接開く
        function openBase(kanji){
          try {
            const u = `${location.origin}${location.pathname}?character=${encodeURIComponent(kanji)}`;
            window.open(u, '_blank', 'noopener');
          } catch(e){
            // ignore
          }
        }

        // 画面に追加
        cKeys.forEach(base => {
          const cell = document.createElement('div');
          cell.className = 'kanji-cell';
          cell.textContent = base;
          cell.title = base;
          cell.addEventListener('click', ()=> openBase(base));
          gridEl.appendChild(cell);
        });

      } catch(e){
        console.error('[jigen] failed to render c_ list', e);
      }
    })();
    console.log('[jigen] rendered c_ index (character param absent)');
  }
}

// --- 変更: 凡例をフッターの左（先頭）に格納する ---
const legend = document.getElementById('graph-legend') || document.getElementById('graph-arrow-legend');
if(legend){
  // 不要な空要素を削除
  const empty = Array.from(legend.querySelectorAll('div')).filter(d => !d.innerHTML.trim());
  empty.forEach(e => e.parentNode.removeChild(e));

  // 高さ自動調整のためのスタイルを追加
  legend.style.removeProperty('height');
  legend.style.removeProperty('flex-basis');
  legend.style.removeProperty('overflow');

  const footer = document.getElementById('site-footer');
  if(footer){
    footer.insertBefore(legend, footer.firstChild);
  } else {
    // フッターが無ければ従来通り挿入（互換性維持）
    const container = document.getElementById('mermaid-tree');
    if(container && container.parentNode) container.parentNode.insertBefore(legend, container.nextSibling);
    else root.appendChild(legend);
  }
}
// --- /変更 ---

// groups.json が新形式 (基底文字 -> { "1": {...}, ... }) の場合に平坦化するヘルパ
function flattenGroupsObj(raw){
  if(!raw || typeof raw !== 'object') return raw || {};
  const out = {};
  try {
    Object.entries(raw).forEach(([k, v])=>{
      if(v && typeof v === 'object' && Object.keys(v).length){
        const childKeys = Object.keys(v);
        const hasNumericChild = childKeys.some(ck => /^[0-9]/.test(ck));
        if(hasNumericChild){
          childKeys.forEach(ck => {
            try {
              // 深いコピーしてから parents を正規化（子キーは基底 k）
              const childVal = v[ck];
              const copy = (childVal && typeof childVal === 'object') ? JSON.parse(JSON.stringify(childVal)) : childVal;
              // normalize parents inside this child: numeric -> `${k}${num}`
              try {
                if(copy && copy.parents !== undefined){
                  const p = copy.parents;
                  if(typeof p === 'number' || (typeof p === 'string' && /^[\d.]+$/.test(p))) {
                    copy.parents = `${k}${p}`;
                  } else if(typeof p === 'string') {
                    // leave as-is
                  } else if(Array.isArray(p)){
                    copy.parents = p.map(x => (typeof x === 'number' || (typeof x === 'string' && /^[\d.]+$/.test(x))) ? `${k}${x}` : x);
                  } else if(p && typeof p === 'object'){
                    const newObj = {};
                    Object.entries(p).forEach(([kk,vv]) => {
                      const nk = (/^[\d.]+$/.test(kk)) ? `${k}${kk}` : kk;
                      newObj[nk] = vv;
                    });
                    copy.parents = newObj;
                  }
                }
             } catch(e){}
              // parents が無ければ class を補う
              try {
                if(copy && (copy.parents === undefined || copy.parents === null)){
                  if(!copy.class) copy.class = "象形";
                }
              } catch(e){}
               out[`${k}${ck}`] = copy;
            } catch(e){}
          });
           return;
        }
      }
      out[k] = v;
    });
  } catch(e){
    return raw;
  }

  // 最後に out 全体を走査して parents の数値参照が残っていないかを確認し、必要なら当該キーの基底を使って修正する
  try {
    Object.entries(out).forEach(([flatId, info])=>{
      try {
        if(!info) return;
        // parents が無ければ class を補って親正規化はスキップ
        if (info.parents === undefined || info.parents === null) {
          if(!info.class) info.class = "象形";
          return;
        }
        const base = (String(flatId).match(/^[^\d]+/) || [flatId])[0];
        const p = info.parents;
        if(typeof p === 'number' || (typeof p === 'string' && /^[\d.]+$/.test(p))){
          info.parents = `${base}${p}`;
        } else if(typeof p === 'string'){
          // leave as-is
        } else if(Array.isArray(p)){
          info.parents = p.map(x => (typeof x === 'number' || (typeof x === 'string' && /^[\d.]+$/.test(x))) ? `${base}${x}` : x);
        } else if(p && typeof p === 'object'){
          const newObj = {};
          Object.entries(p).forEach(([k2,v2]) => {
            const nk = (/^[\d.]+$/.test(k2)) ? `${base}${k2}` : k2;
            newObj[nk] = v2;
          });
          info.parents = newObj;
        }
      } catch(e){}
    });
  } catch(e){}

  return out;
}