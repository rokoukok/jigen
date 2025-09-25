// data.js
// ここにキャッシュ関連の処理を移動しました。

// images.json: { descId: ["一1","一2", ...], ... }
// groups.json: { groupId: { images?: number|[num...], parents?: ... }, ... }
export async function loadData() {
  const [imagesResponse, groupsResponse] = await Promise.all([
    fetch('./images.json'),
    fetch('./groups.json')
  ]);
  const imagesRaw = await imagesResponse.json();
  const groupsRaw = await groupsResponse.json();

  // groups.json が "基底文字" -> { "1": {...}, "2": {...} } の形式になっている場合に
  // 内部キーを展開して平坦なキー (例: "一1") に変換する。
  // すでに平坦なキーが混在している場合はそのままコピーする。
  const flattenGroups = {};
  try {
    Object.entries(groupsRaw).forEach(([k, v]) => {
      if (v && typeof v === 'object' && Object.keys(v).length) {
        // 子キーに数字で始まるキーがあれば展開対象とみなす
        const childKeys = Object.keys(v);
        const hasNumericChild = childKeys.some(ck => /^[0-9]/.test(ck));
        if (hasNumericChild) {
          childKeys.forEach(ck => {
            try {
              const childVal = v[ck];
              const flatKey = `${k}${ck}`;
              // 深いコピーしてから parents の数値参照を正規化
              const copy = (childVal && typeof childVal === 'object') ? JSON.parse(JSON.stringify(childVal)) : childVal;
              // normalize parents that are numeric-only (e.g. "1" -> "一1")
              try {
                const base = k;
                if (copy && copy.parents !== undefined) {
                  const p = copy.parents;
                  // 単一参照が数値または数字文字列の場合
                  if (typeof p === 'number' || (typeof p === 'string' && /^[\d.]+$/.test(p))) {
                    copy.parents = `${base}${p}`;
                  } else if (typeof p === 'string') {
                    // 非数値文字列はそのまま
                  } else if (Array.isArray(p)) {
                    copy.parents = p.map(x => {
                      if (typeof x === 'number' || (typeof x === 'string' && /^[\d.]+$/.test(x))) return `${base}${x}`;
                      return x;
                    });
                  } else if (p && typeof p === 'object') {
                    const newObj = {};
                    Object.entries(p).forEach(([k2, v2]) => {
                      // オブジェクトのキーは通常文字列だが数値文字列も許容
                      const nk = (/^[\d.]+$/.test(k2)) ? `${base}${k2}` : k2;
                      newObj[nk] = v2;
                    });
                    copy.parents = newObj;
                  }
                }
              } catch(e){}
              // parents が存在しない場合は class を象形にする
              try {
                if (copy && (copy.parents === undefined || copy.parents === null)) {
                  if (!copy.class) copy.class = "象形";
                }
              } catch(e){}
              flattenGroups[flatKey] = copy;
            } catch(e){}
          });
          return;
        }
      }
      // それ以外はそのままコピー
      // 非展開エントリも parents が無ければ class を補う
      try {
        const copyTop = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
        if (copyTop && (copyTop.parents === undefined || copyTop.parents === null)) {
          if (!copyTop.class) copyTop.class = "象形";
        }
        flattenGroups[k] = copyTop;
      } catch(e){
        flattenGroups[k] = v;
      }
    });
  } catch(e){
    // フラット化に失敗したら元データをそのまま使う
    Object.assign(flattenGroups, groupsRaw);
  }

  // 平坦化後に念のため全グループの parents を走査して
  // 数字のみ参照 -> 基底文字+数字 に正規化しておく（安全対策）
  try {
    Object.entries(flattenGroups).forEach(([flatId, info])=>{
      try {
        if(!info) return;
        // parents が無ければ class を補ってこのエントリの親正規化はスキップ
        if (info.parents === undefined || info.parents === null) {
          if(!info.class) info.class = "象形";
          return;
        }
        const base = (String(flatId).match(/^[^\d]+/) || [flatId])[0];
        const p = info.parents;
        if(typeof p === 'number' || (typeof p === 'string' && /^[\d.]+$/.test(p))){
          info.parents = `${base}${p}`;
        } else if(typeof p === 'string'){
          // non-numeric string: leave as-is
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

  // groupsRaw から group が参照する画像IDを生成して image->group マップを作成
  const imageToGroup = {}; // e.g. "一3" => "一1"
  Object.entries(flattenGroups).forEach(([groupId, info]) => {
    // groupId をそのまま使う（c_ のノーマライズは行わない）
    const kanji = (groupId.match(/^[^\d]+/) || [groupId])[0];
    if (!info || info.images === undefined) return;
    const vals = Array.isArray(info.images) ? info.images : [info.images];
    vals.forEach(v => {
      if (v === null || v === undefined) return;
      const num = String(v);
      const imageId = `${kanji}${num}`;
      imageToGroup[imageId] = groupId;
    });
  });

  // data.images を "descId/画像ID" -> groupId の map にする
  const dataImages = {};
  Object.entries(imagesRaw).forEach(([descId, vals]) => {
    if (Array.isArray(vals)) {
      vals.forEach(v => {
        if (!v) return;
        // 変更: groupsByKanji をフォールバックに使わず、imageToGroup が無ければ
        // 画像ID 自身 (v) をグループID として残す。後で missing_<漢字> に振り分ける。
        const fallbackGroup = imageToGroup[v] || null;
        dataImages[`${descId}/${v}`] = (fallbackGroup || v);
      });
    } else if (typeof vals === 'string' && vals) {
      const v = vals;
      const fallbackGroup = imageToGroup[v] || null;
      dataImages[`${descId}/${v}`] = (fallbackGroup || v);
    }
  });

  // groups.json 側で指定されている画像だが images.json に記載がないものは最低限ノード化
  Object.keys(imageToGroup).forEach(imageId => {
    const key = Object.keys(dataImages).find(k => k.endsWith('/' + imageId));
    if (!key) {
      // descId が無い場合は暫定的に descId = imageId としておく（ラベル表示用）
      const fallbackGroup = imageToGroup[imageId];
      dataImages[`${imageId}/${imageId}`] = fallbackGroup || imageId;
    }
  });

  // imagesRaw は内部で参照するが外部で使われていないため返却から除外
  return { images: dataImages, groups: flattenGroups };
}

// --- 強制キャッシュクリア ---
export function clearSVGCache() {
  Object.keys(localStorage)
    .filter(k => k.startsWith('mermaidSVGCache_'))
    .forEach(k => localStorage.removeItem(k));
}

// キャッシュ用ハッシュ
export async function fetchJSONHash(url) {
  const resp = await fetch(url);
  const text = await resp.text();
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2,'0')).join('');
}

// localStorageキャッシュ管理（容量上限5MB）
export function setCache(key, value, maxSizeMB = 5) {
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