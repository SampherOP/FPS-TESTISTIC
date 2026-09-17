import { WEAPONS } from '../shared/weapons.js';
const paths={
  arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',
  play:'<path d="m8 4 12 8-12 8Z"/>',
  crosshair:'<circle cx="12" cy="12" r="7"/><path d="M12 1v6m0 10v6M1 12h6m10 0h6"/>',
  bolt:'<path d="m13 2-9 12h7l-1 8L21 9h-8Z"/>',
  users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-4a6 6 0 0 1 12 0v4M17 4a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 5v3"/>',
  shield:'<path d="m12 2 8 3v6c0 5-5 9-8 11-3-2-8-6-8-11V5Z"/><path d="m8 12 3 3 5-6"/>',
  settings:'<path d="M4 6h16M4 18h16M8 3v6m8 6v6M4 12h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="18" r="2"/>',
  history:'<path d="M3 12a9 9 0 1 0 3-7L3 8m0-5v5h5m4-2v6l4 2"/>',
  trophy:'<path d="M7 3h10v6a5 5 0 0 1-10 0Zm5 11v6m-5 1h10M7 5H3v3c0 3 2 4 5 4m9-7h4v3c0 3-2 4-5 4"/>',
  weapon:'<path d="M3 9h14V6h3v3h2v4h-9l-2 6H7l1-6H3Zm1 0V6h5v3m4 4 3 4h3l-2-4"/>',
  operator:'<path d="M7 10V8a5 5 0 0 1 10 0v2m-11 0h12v5l-3 3H9l-3-3Zm-2 12v-2l5-2m11 4v-2l-5-2M9 12h6"/>',
  signal:'<path d="M5 20v-3m5 3v-7m5 7V9m5 11V4"/>',
  flag:'<path d="M5 22V3m0 1h14l-3 4 3 4H5"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  check:'<path d="m4 12 5 5L20 6"/>',
  plus:'<path d="M12 4v16M4 12h16"/>',
  grenade:'<path d="m11 3 5 2m-5-2 1-2 5 2-1 2m-7 2 4-1 5 3 2 6-3 6-6 1-6-4-1-6Zm4-1 2-3"/>',
  fullscreen:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v1"/>',
  volume:'<path d="M3 9h4l5-4v14l-5-4H3Zm13-2a7 7 0 0 1 0 10m3-13a11 11 0 0 1 0 16"/>',
  monitor:'<rect x="2" y="3" width="20" height="14" rx="1"/><path d="M8 22h8m-4-5v5"/>'
};
export function icon(name,size=20){return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${paths[name]||paths.crosshair}</svg>`;}
// Weapon previews are rendered from the supplied GLBs. Keep this helper's
// wrapper/class stable so existing selector, loadout and HUD layouts continue
// to size correctly while assets are generated asynchronously by the model
// pipeline. The old inline gun silhouettes are deliberately not retained.
export function weaponSVG(id) {
  const w=WEAPONS[id]||WEAPONS.ar4;
  const preview=w.preview||`assets/weapon-previews/${w.id}.png`;
  const src=`./${preview.replace(/^\.\//,'')}`;
  return `<span class="weapon-art weapon-preview" data-weapon-preview="${w.id}"><img src="${src}" alt="${w.name} preview" loading="lazy" onerror="this.parentElement.classList.add('is-missing')"><span class="weapon-preview-pending" role="img" aria-label="${w.name} preview pending">${w.name}</span></span>`;
}
export function operatorSVG(operator) {
  return `<svg class="operator-art" viewBox="0 0 300 330" aria-label="${operator.name} original operator portrait" role="img"><g fill="none" stroke="currentColor" stroke-opacity=".13"><path d="M15 40h270M15 120h270M15 200h270M15 280h270M70 10v310M150 10v310M230 10v310"/><circle cx="150" cy="140" r="106"/></g><g stroke="var(--color-base-content)" stroke-opacity=".35" stroke-width="1.5" fill="var(--color-base-300)"><path d="m61 320 9-102 48-29h64l49 29 9 102Z"/><path d="m116 189 10-39h48l11 39-16 26h-39Z"/><path d="m96 93 10-40 27-17h37l30 21 5 37-10 63-29 25h-32l-31-25Z"/><path d="m103 70 24-15h46l26 21m-96 37 8 37 30 20h16l31-19 7-37"/><path d="m94 87 4 38 108-2 2-35Z"/><path d="M113 221h74v68h-74Zm-13 14H78l-5 51h30m94-51h23l5 51h-26"/></g><path d="m108 101 39 5 47-5-1 10-46 5-38-5Z" fill="${operator.color}"/><path d="M120 238h60M84 248v17m129-17v17" stroke="${operator.color}" stroke-width="5"/><path d="m134 43 15-10 19 10" stroke="${operator.color}" stroke-width="4" fill="none"/><path d="M124 291h52v18h-52Z" fill="var(--color-base-content)" fill-opacity=".18"/></svg>`;
}
