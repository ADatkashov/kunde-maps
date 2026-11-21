const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    // Mock only external library downloads: this smoke tests our own HTML/JS
    // and server behavior without depending on public CDN availability.
    await page.route('https://unpkg.com/**', async route => {
      const url = route.request().url();
      if (url.endsWith('.css')) {
        await route.fulfill({status: 200, contentType: 'text/css', body: ''});
      } else if (url.includes('maplibre-gl.js')) {
        await route.fulfill({status: 200, contentType: 'application/javascript', body: `
          window.maplibregl = {
            addProtocol: () => {},
            Map: class {constructor(){throw Error('Map should not be initialized without tiles')}},
            NavigationControl: class {}
          };
        `});
      } else if (url.includes('pmtiles.js')) {
        await route.fulfill({status: 200, contentType: 'application/javascript',
          body: 'window.pmtiles = {Protocol: class {constructor(){this.tile=()=>{}}}};'});
      } else {
        await route.abort();
      }
    });
    await page.goto('http://127.0.0.1:18080/', {waitUntil: 'domcontentloaded'});
    await page.locator('#status').filter({hasText: 'PMTiles недоступен'}).waitFor({timeout: 15000});
    assert.match(await page.locator('#status').innerText(), /404/);
    assert.deepEqual(errors, []);
    console.log('Chromium browser smoke: missing tile archive is reported visibly');
  } finally {
    await browser.close();
  }
})().catch(err => {console.error(err); process.exitCode = 1;});
