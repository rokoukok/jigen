export const eraPalette = {
  // ...existing code...
  0: "#bc86e9ff",
  1: ["#6159d1ff","#5977d1","#5989d1ff"],
  2: ["#7faff8ff","#7fcaf8","#7fe6f8ff"],
  3: ["#5ecfa4ff","#5ecf77ff","#a4cf5eff"],
  4: "#fcf37bff",
  5: "#fcd191ff",
  6: "#f5a78fff",
  7: "#f09999",
  8: "#f099ccff"
};

export const descTranslations = {
  "shang_oracle": "商代/甲骨文",
  "shang_bronze": "商代/金文",
  "zhou_early_oracle": "西周早期/甲骨文",
  "zhou_early": "西周早期/金文",
  "zhou_middle": "西周中期/金文",
  "zhou_late": "西周晩期/金文",
  "spring_autumn_early": "春秋早期/金文",
  "spring_autumn_early_seal": "春秋早期/石鼓文",
  "spring_autumn_middle": "春秋中期/金文",
  "spring_autumn_late": "春秋晩期/金文",
  "spring_autumn_late_slip": "春秋晩期/侯馬",
  "warring_states_early": "戦国早期/金文",
  "warring_states_middle": "戦国中期/金文",
  "warring_states_middle_qi": "戦国中期/斉系",
  "warring_states_middle_yan": "戦国中期/燕系",
  "warring_states_middle_jin": "戦国中期/晉系",
  "warring_states_middle_qin": "戦国中期/秦系",
  "warring_states_middle_slip": "戦国中期/楚系簡帛",
  "warring_states_late": "戦国晩期/金文",
  "qin_slip": "秦/簡牘",
  "qin_seal": "秦/小篆",
  "qin_clerical": "秦/隷書",
  "western_han_slip": "西漢/簡帛",
  "western_han_clerical": "西漢/隷書",
  "xin_clerical": "新/隷書",
  "eastern_han_seal": "東漢/説文",
  "eastern_han_clerical": "東漢/隷書",
  "computer_print": "現代/印刷体"
};

// prefixToEraIndex
export const prefixToEraIndex = [
  {prefix: "shang_", idx: 0},
  {prefix: "zhou_", idx: 1},
  {prefix: "spring_autumn_", idx: 2},
  {prefix: "warring_states_", idx: 3},
  {prefix: "qin_", idx: 4},
  {prefix: "western_han_", idx: 5},
  {prefix: "xin_", idx: 6},
  {prefix: "eastern_han_", idx: 7},
  {prefix: "computer_", idx: 8}
];

export function parseEraScript(path) {
  if (!path) return { era: "", script: "" };
  if (path.includes('/')) {
    const [descId, imageId] = path.split('/');
    const text = descTranslations[descId] || descId;
    const parts = text.split('/');
    return { era: parts[0] || "", script: parts.slice(1).join('/') || parts[0] || descId };
  }
  // フォールバック
  const parts = path.split('/');
  return { era: parts[0] || "", script: parts[1] || parts[0] || path };
}

export function eraInfoFromDescId(descId){
  if(!descId || typeof descId !== "string") return null;
  for(const mapping of prefixToEraIndex){
    if(descId.startsWith(mapping.prefix)){
      let shade = 1; // default 中期
      if(descId.includes("_early")) shade = 0;
      else if(descId.includes("_middle")) shade = 1;
      else if(descId.includes("_late")) shade = 2;
      return { eraIdx: mapping.idx, shadeIdx: shade };
    }
  }
  return null;
}

export function eraIndexFromDescId(descId){
  if(!descId || typeof descId !== "string") return null;
  for(const m of prefixToEraIndex){
    if(descId.startsWith(m.prefix)) return m.idx;
  }
  return null;
}

export function computeGroupEraInfo(groupId, data){
  if(!groupId) return null;
  const infos = [];
  Object.keys(data.images).forEach(path => {
    const g = data.images[path];
    if(g !== groupId) return;
    const descId = path.split('/')[0] || "";
    const info = eraInfoFromDescId(descId);
    if(info) infos.push(info);
  });
  if(infos.length === 0) return null;
  const minEra = Math.min(...infos.map(i=>i.eraIdx));
  const shadesForMin = infos.filter(i=>i.eraIdx===minEra).map(i=>i.shadeIdx);
  const minShade = Math.min(...shadesForMin);
  return { eraIdx: minEra, shadeIdx: minShade };
}

export function strokeFor(color){
  if(!color || typeof color !== "string") return "#666666";
  let c = color.replace('#','').toLowerCase();
  if(c.length === 8) c = c.slice(0,6); // 末尾の alpha 部分を除去
  if(c.length !== 6) return "#666666";
  const r = Math.max(0, parseInt(c.slice(0,2),16) - 0x20);
  const g = Math.max(0, parseInt(c.slice(2,4),16) - 0x20);
  const b = Math.max(0, parseInt(c.slice(4,6),16) - 0x20);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}