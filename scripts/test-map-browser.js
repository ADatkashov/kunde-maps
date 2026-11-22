// Dependency-free browser API contract tests for the KUNDE Maps boot flow.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const script = fs.readFileSync('apps/web/map.js', 'utf8');
const coreScript = fs.readFileSync('apps/web/core.js', 'utf8');
const style = JSON.parse(fs.readFileSync('apps/web/style.json', 'utf8'));

async function scenario(tileStatus, contentRange) {
  const status = {textContent: 'Загрузка карты…'};
  let mapCreated = false;
  let resolvedTileUrl = '';
  const requests = [];
  const context = {
    URL, URLSearchParams, console, setTimeout, clearTimeout,
    window: {
      location: {href: 'https://maps.example.test/', origin: 'https://maps.example.test'},
      pmtiles: {Protocol: class {constructor() {this.tile = () => {};}}},
      maplibregl: {
        addProtocol: () => {},
        Map: class {
          constructor(opts) {
            mapCreated = true;
            resolvedTileUrl = opts.style.sources.kunde.url;
          }
          addControl() {}
          on() {}
        },
        NavigationControl: class {}
      }
    },
    document: {getElementById: () => status},
    fetch: async (url, options = {}) => {
      requests.push({url: String(url), options});
      if (String(url) === './config.json') {
        return {ok: true, json: async () => ({styleUrl: '/style.json'})};
      }
      if (String(url) === 'https://maps.example.test/style.json') {
        return {ok: true, json: async () => JSON.parse(JSON.stringify(style))};
      }
      if (String(url).endsWith('/tiles/kazakhstan.pmtiles')) {
        return {status: tileStatus, headers: {get: () => contentRange}};
      }
      throw Error('Unexpected fetch: ' + url);
    }
  };
  context.pmtiles = context.window.pmtiles;
  context.maplibregl = context.window.maplibregl;
  vm.createContext(context);
  vm.runInContext(coreScript, context); // core.js (UMD) attaches KundeCore to the sandbox global
  context.window.KundeCore = context.KundeCore;
  vm.runInContext(script, context);
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
  return {status: status.textContent, mapCreated, resolvedTileUrl, requests};
}

(async () => {
  const missing = await scenario(404, '');
  assert.equal(missing.mapCreated, false);
  assert.match(missing.status, /PMTiles недоступен.*404/);
  const ok = await scenario(206, 'bytes 0-15/1024');
  assert.equal(ok.mapCreated, true);
  assert.equal(ok.resolvedTileUrl, 'pmtiles://https://maps.example.test/tiles/kazakhstan.pmtiles');
  assert.equal(ok.requests.at(-1).options.headers.Range, 'bytes=0-15');
  const broken = await scenario(200, '');
  assert.equal(broken.mapCreated, false);
  assert.match(broken.status, /PMTiles недоступен/);
  const malformed = await scenario(206, 'bytes 0-10/1024');
  assert.equal(malformed.mapCreated, false);
  assert.match(malformed.status, /Range-запросы/);
  console.log('Map browser API contract: 4 scenarios passed');
})().catch(err => {console.error(err); process.exitCode = 1;});
