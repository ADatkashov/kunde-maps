// WCAG 2.1 AA contrast of the design-system token pairs used by the navigation HUD (light and dark).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = ['ui.css', 'nav.css'].map(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
function tokens(selectorRe) {
  const out = {};
  for (const match of css.matchAll(selectorRe)) for (const [, name, value] of match[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[name] = value;
  return out;
}
const light = tokens(/(?:^|\n):root\s*\{([^}]*)\}/g);
const dark = {...light, ...tokens(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/g)};
const lum = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const PAIRS = [  // [foreground token, background token, what it is, minimum ratio]
  ['on-primary', 'primary', 'maneuver banner text', 4.5], ['text', 'surface', 'bottom bar numbers', 4.5], ['text-2', 'surface', 'bottom bar labels, safety line', 4.5],
  ['text', 'surface-2', 'highlighted current step', 4.5], ['text-2', 'surface-2', 'step street / distance on highlight', 4.5], ['primary', 'surface', 'recenter button label and step icons', 4.5],
  ['on-danger-solid', 'danger-solid', 'End button', 4.5], ['warn', 'warn-bg', 'GPS warning strip', 4.5], ['danger', 'danger-bg', 'reroute error strip', 4.5],
  ['on-primary', 'primary-hover', 'primary button hover', 4.5],
];
for (const [theme, t] of [['light', light], ['dark', dark]]) {
  test(`WCAG AA contrast, ${theme} theme`, () => {
    for (const [fg, bg, what, min] of PAIRS) {
      assert.ok(t[fg] && t[bg], `${fg}/${bg} are defined`);
      const r = ratio(t[fg], t[bg]);
      assert.ok(r >= min, `${theme}: ${what} (${fg} ${t[fg]} on ${bg} ${t[bg]}) = ${r.toFixed(2)}:1, needs ${min}:1`);
    }
  });
}
