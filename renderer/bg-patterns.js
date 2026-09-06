'use strict';

// Tileable "sample wall" backgrounds, defined as small SVG tiles encoded as
// data URLs. They repeat seamlessly to fill any window size (the spec's
// "sample wall images that can be tiled together to the formed window size").
(function () {
  function svgUrl(svg) {
    return 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")';
  }

  const cork = `
<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'>
  <rect width='120' height='120' fill='#c9a06a'/>
  <filter id='n'>
    <feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='7' stitchTiles='stitch'/>
    <feColorMatrix type='matrix' values='0 0 0 0 0.55  0 0 0 0 0.38  0 0 0 0 0.18  0 0 0 0.35 0'/>
  </filter>
  <rect width='120' height='120' filter='url(#n)'/>
  <filter id='n2'>
    <feTurbulence type='fractalNoise' baseFrequency='0.35' numOctaves='2' seed='3' stitchTiles='stitch'/>
    <feColorMatrix type='matrix' values='0 0 0 0 0.75  0 0 0 0 0.55  0 0 0 0 0.30  0 0 0 0.25 0'/>
  </filter>
  <rect width='120' height='120' filter='url(#n2)'/>
</svg>`;

  const linen = `
<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'>
  <rect width='64' height='64' fill='#e9e6dc'/>
  <g stroke='#d5d1c2' stroke-width='1'>
    ${Array.from({ length: 16 }, (_, i) => `<line x1='${i * 4}' y1='0' x2='${i * 4}' y2='64'/>`).join('')}
    ${Array.from({ length: 16 }, (_, i) => `<line x1='0' y1='${i * 4}' x2='64' y2='${i * 4}'/>`).join('')}
  </g>
</svg>`;

  const grid = `
<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'>
  <rect width='40' height='40' fill='#fbfaf5'/>
  <path d='M40 0 H0 V40' fill='none' stroke='#dfe3ea' stroke-width='1'/>
  <circle cx='0' cy='0' r='1.1' fill='#c7ccd6'/>
</svg>`;

  const slate = `
<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'>
  <rect width='120' height='120' fill='#2b2f36'/>
  <filter id='s'>
    <feTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='2' seed='11' stitchTiles='stitch'/>
    <feColorMatrix type='matrix' values='0 0 0 0 0.10  0 0 0 0 0.11  0 0 0 0 0.13  0 0 0 0.6 0'/>
  </filter>
  <rect width='120' height='120' filter='url(#s)'/>
</svg>`;

  window.BG_PATTERNS = {
    cork: { css: svgUrl(cork), repeat: 'repeat', label: 'Cork board' },
    linen: { css: svgUrl(linen), repeat: 'repeat', label: 'Linen' },
    grid: { css: svgUrl(grid), repeat: 'repeat', label: 'Paper grid' },
    slate: { css: svgUrl(slate), repeat: 'repeat', label: 'Dark slate' }
  };
})();
