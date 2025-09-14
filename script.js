// (省略) adjustTreeHeight や必要関数はそのまま残す

async function loadPrebuiltSvg() {
  const container = document.getElementById('mermaid-tree');
  try {
    const resp = await fetch('/graph.svg'); // GitHub Pages でルートに公開される想定
    if (!resp.ok) throw new Error('SVG not found');
    const svgText = await resp.text();
    container.innerHTML = svgText;

    const svgElement = container.querySelector('svg');
    if (!svgElement) throw new Error('svg missing in graph.svg');
    // restore sizing
    svgElement.removeAttribute('width');
    svgElement.removeAttribute('height');
    svgElement.style.width = '100%';
    svgElement.style.height = '100%';

    reattachEvents(svgElement);
  } catch (e) {
    console.error('Failed to load prebuilt SVG:', e);
    // フォールバック：ここで既存の動的描画（mermaid.render）を呼ぶか、エラーメッセージ表示
  }
}

function reattachEvents(svgElement) {
  // --- PanZoom (例) ---
  const params = new URLSearchParams(window.location.search);
  const startX = params.has('x') ? parseFloat(params.get('x')) : 0;
  const startY = params.has('y') ? parseFloat(params.get('y')) : 0;
  const startZoom = params.has('zoom') ? parseFloat(params.get('zoom')) : 1.0;
  const panZoomInstance = svgPanZoom(svgElement, {
    zoomEnabled: true,
    panEnabled: true,
    controlIconsEnabled: false,
    minZoom: 0.3,
    maxZoom: 10,
    zoomScaleSensitivity: 0.3,
    dblClickZoomEnabled: false
  });
  try { panZoomInstance.zoom(startZoom); panZoomInstance.pan({ x: startX, y: startY }); } catch(e){}

  // --- IntersectionObserver for lazy-loading images inside glyph-box ---
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const div = entry.target;
      const src = div.getAttribute('data-src') || div.dataset.src;
      if (!src) return;
      if (entry.isIntersecting) {
        if (!div.querySelector('img')) {
          const img = document.createElement('img');
          img.src = src;
          div.appendChild(img);
        } else div.querySelector('img').style.display = 'block';
      } else {
        const img = div.querySelector('img');
        if (img) img.style.display = 'none';
      }
    });
  }, { root: svgElement, rootMargin: '100px' });

  // Select glyph-box elements inside the rendered SVG (they may be in foreignObject)
  svgElement.querySelectorAll('.glyph-box').forEach(el => observer.observe(el));

  // --- search / selection ---（あなたの既存コードをそのまま流用してください）
  // 例：検索ボタンに既存 performSearch を再接続する etc.
  // ...
}

// on load
loadPrebuiltSvg();
