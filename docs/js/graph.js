import { safeId } from './utils.js';
import { parseEraScript, descTranslations, computeGroupEraInfo, eraPalette, strokeFor } from './palette.js';

// 追加: HTML エスケープヘルパ（軽量）
function escapeHtml(s){
	 return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// createGroupSubgraph を移植
export function createGroupSubgraph(groupId, era, data, showImageId = false, origGroups = null){
	// groupId が空なら何も出さない（mermaid の空ラベルを避ける）
	if(!groupId) return "";

	// 表示名は c_ を省いたものを使う（内部ID はそのまま）
	const safeGroupId = safeId(groupId);
	const displayGroup = groupId;
	let code = `  subgraph ${safeGroupId}[" "]\n`;

	// data.images: keys like "descId/画像ID" -> groupId
	let chars = Object.entries(data.images).filter(([p, g]) => g === groupId);

	// 画像ID の数値部分で安定ソート
	chars.sort((a,b)=>{
		const aImg = (a[0].split('/')[1] || "");
		const bImg = (b[0].split('/')[1] || "");
		const aNumMatch = aImg.match(/(\d+)/);
		const bNumMatch = bImg.match(/(\d+)/);
		const aNum = aNumMatch ? parseInt(aNumMatch[1],10) : 0;
		const bNum = bNumMatch ? parseInt(bNumMatch[1],10) : 0;
		if(aNum !== bNum) return aNum - bNum;
		const aDesc = a[0].split('/')[0] || "";
		const bDesc = b[0].split('/')[0] || "";
		return aDesc.localeCompare(bDesc);
	});

	// グループの時代情報を計算して色を決定（無ければグレー）
	// まず images ベースで era を取得できればそれを優先し、なければ characters グループやフォールバックを使う
	let fillColor, strokeColor;
	let isXiang = false; // 象形相当フラグ（class === '象形' または parents が存在しない）
	{
		const info = computeGroupEraInfo(groupId, data);
		if(info && eraPalette.hasOwnProperty(info.eraIdx)){
			const p = eraPalette[info.eraIdx];
			if(Array.isArray(p)){
				const shadeIdx = Math.min(2, Math.max(0, info.shadeIdx ?? 1));
				fillColor = p[shadeIdx] || p[1] || p[0];
			} else {
				fillColor = p;
			}
		} else if (origGroups && origGroups[groupId] && (origGroups[groupId].characters || origGroups[groupId].chars || origGroups[groupId].characters_list)) {
			// 現代サブグループ (characters を持つグループ) は
			// images 情報が無い場合でも computer_print 相当の色を使う
			if (typeof eraPalette !== 'undefined' && eraPalette.hasOwnProperty(8)) {
				const p = eraPalette[8];
				fillColor = Array.isArray(p) ? (p[1] || p[0]) : p;
			} else {
				fillColor = "#FFFFFF";
			}
		} else {
			// それ以外は薄いグレーをデフォルトにする
			fillColor = "#EEEEEE";
		}
		// 象形相当の判定: groups 定義で class === '象形'、あるいは parents が存在しない（null/空/空オブジェクト）場合
		try {
			const ginfo = origGroups && origGroups[groupId] ? origGroups[groupId] : null;
			if(ginfo){
				const parents = ginfo.parents;
				const parentsMissing = (parents === undefined || parents === null || parents === '' ||
					(typeof parents === 'object' && !Array.isArray(parents) && Object.keys(parents).length === 0));
				if(ginfo.class === '象形' || parentsMissing) isXiang = true;
			}
		} catch(e){ /* ignore */ }
		strokeColor = strokeFor(fillColor);
	}

	if(chars.length === 0){
		// 画像が無い場合の扱い:
		// 1) このグループ自身に characters が定義されているなら、それを優先して各文字ノードを作成する
		//    （作成した文字に対応する c_<文字> は data._embeddedVariants に登録して重複を防ぐ）
		const groupInfo = origGroups && origGroups[groupId] ? origGroups[groupId] : null;
		const groupChars = groupInfo && (groupInfo.characters || groupInfo.chars || groupInfo.characters_list);
		// compText (現代/印刷体) を準備
		const compText = (descTranslations && descTranslations['computer_print']) ? descTranslations['computer_print'] : 'computer_print';
		const compParts = String(compText).split('/');
		const eraText = compParts[0] || "";
		const scriptText = compParts.slice(1).join('/') || compParts[0] || '';

		if(groupChars){
			const arr = Array.isArray(groupChars) ? groupChars : [groupChars];
			arr.forEach((ch, idx) => {
				if(!ch) return;
				const safeCh = String(ch);
				const nodeId = safeId(`${groupId}_char_${idx}_${safeCh}`);
				// ボックス背景はサブグループの色を用いる（可視部分は box 内）
				let bg = String(fillColor || "#FFFFFF");
				if(bg.startsWith("#") && bg.length === 9) bg = `#${bg.slice(1,7)}`;
				let textColor = "#000000";
				try{
				  const c = bg.replace('#','');
				  const r = parseInt(c.slice(0,2),16)/255;
				  const g = parseInt(c.slice(2,4),16)/255;
				  const b = parseInt(c.slice(4,6),16)/255;
				  const L = 0.2126*r + 0.7152*g + 0.0722*b;
				  textColor = (L > 0.6) ? "#000000" : "#FFFFFF";
				}catch(e){ textColor = "#000000"; }
				const boxStyle = `background:${bg};color:${textColor};padding:6px 10px;border-radius:6px;display:inline-block;font-weight:bold;`;
				const label = `<div class='glyph-text' style='${boxStyle}'>${escapeHtml(safeCh)}</div><br>${escapeHtml(eraText)}<br>${escapeHtml(scriptText.replace(/\//g,' '))}`;
				// ノードは画像ノード風（ノード自体は白、内部で色表示）
				code += `    ${nodeId}["${label}"]\n`;
				code += `    style ${nodeId} fill:white,stroke:${strokeColor},stroke-width:1px\n`;
				// 埋め込みマーカーを残す（既存の c_<char> を後でスキップするため）
				if(data){
					if(!data._embeddedVariants) data._embeddedVariants = new Set();
					data._embeddedVariants.add(`c_${safeCh}`);
				}
			});
			// characters によるノードで代替したため、グループ自身の別ノードは生成しない
		} else {
			// フォールバック: characters が無い場合は従来どおりグループラベルを出力
			const nodeId = safeId(`${groupId}_label`);
			const label = `<div class='glyph-text'>${escapeHtml(displayGroup)}</div>`;
			code += `    ${nodeId}["${label}"]\n    style ${nodeId} fill:${fillColor},stroke:${strokeColor},stroke-width:1px\n`;
		}
	} else {
		chars.forEach(([path], idx) => {
			const nodeId = safeId(`${groupId}_${idx}`);
			const [descId, imageId] = path.split('/');
			const imgSrc = `images/${imageId}.png`;
			const parsed = parseEraScript(path); // { era, script }
			const eraText = parsed.era || "";
			const scriptText = parsed.script || (descTranslations[descId] || descId);
			// 未定義グループの場合のみ画像IDを説明欄に付ける
			const imageIdText = showImageId ? ` ${imageId}` : "";
			const label = `<div class='glyph-box' data-src='${imgSrc}'></div><br>${eraText}<br>${scriptText.replace(/\//g, ' ')}${imageIdText}`;
			// ノード背景は白のままにしたい場合は fill:white を使う。ここではノード自体は白にしておきつつ、
			// グループ枠（subgraph）の背景で時代色を表現するためノードは白で固定。
			code += `    ${nodeId}["${label}"]\n    style ${nodeId} fill:white,stroke:${strokeColor},stroke-width:1px\n`;
		});
	}

	// c_ ノードに variants が定義されている場合、同サブグループ内に variants を埋め込む
	// グループに variants プロパティがあれば同サブグループ内に variants を埋め込む（旧 c_ 依存はしない）
	if(origGroups && origGroups[groupId]){
		try {
			const rawV = origGroups[groupId].variants || origGroups[groupId].variant;
			if(rawV){
				const variantsArr = Array.isArray(rawV) ? rawV : [rawV];
				variantsArr.forEach((ch)=>{
					if(!ch) return;
					const varNodeId = safeId(`${groupId}_variant_${String(ch)}`);
					const compText = (descTranslations && descTranslations['computer_print']) ? descTranslations['computer_print'] : 'computer_print';
					const compParts = String(compText).split('/');
					const eraText = compParts[0] || "";
					const scriptText = compParts.slice(1).join('/') || compParts[0] || String(ch);
					const vLabel = `<div class='glyph-text' style='background:${fillColor};padding:6px 10px;border-radius:6px;font-weight:bold;color:${strokeFor(fillColor)}'>${escapeHtml(String(ch))}</div><br>${escapeHtml(eraText)}<br>${escapeHtml(scriptText.replace(/\//g,' '))}`;
					code += `    ${varNodeId}["${vLabel}"]\n`;
					code += `    style ${varNodeId} fill:white,stroke:${strokeColor},stroke-width:1px\n`;
					if(data){
						if(!data._embeddedVariants) data._embeddedVariants = new Set();
						data._embeddedVariants.add(`${groupId}_variant_${String(ch)}`);
					}
				});
			}
		} catch(e){ /* ignore */ }
	}

	code += `  end\n`;
	// サブグラフ（グループ枠）に背景色と枠色を付ける
	// 注意: 中身（画像ノードや子ノード）が無いプレースホルダ的なグループで
	// fill を付けると外側の「未定義」サブグラフ色が隠れてしまうため、
	// 実際に中身がある場合のみ背景色を適用し、そうでなければ fill:none を使う。
	const hasChildren = data && data.groups && data.groups[groupId] && Object.keys(data.groups[groupId]).length > 0;
	// ここで "characters を持つグループ" を塗りつぶし対象に含める（c_ プレフィックスには依存しない）
	const hasCharacters = origGroups && origGroups[groupId] && (origGroups[groupId].characters || origGroups[groupId].chars || origGroups[groupId].characters_list);
	const shouldApplyFill = (chars.length > 0) || hasChildren || Boolean(hasCharacters);
	// 背景の不透明度（0.0 - 1.0）
	// 象形相当は目立たせるために不透明度を高める
	const groupFillOpacity = isXiang ? 0.9 : 0.6;
	if(shouldApplyFill){
		// 背景と枠の不透明度を同じ値で設定
		code += `  style ${safeGroupId} fill:${fillColor},fill-opacity:${groupFillOpacity},stroke:none\n`;
	} else {
		// プレースホルダでも枠を半透明にする（必要に応じて変更）
		code += `  style ${safeGroupId} fill:none,stroke:none\n`;
	}
   return code;
 }