/* KUNDE Maps app shell UI (Phase 5.5): bottom sheet with three snap points and drag/keyboard control, tab bar, map tool buttons,
 * layers popover, dialog, quick categories and the local settings (profile) screen. Presentational: app state lives in map.js and is
 * reached through callbacks. All text is set with textContent; no HTML is built from data. */
(function (root) {
  'use strict';
  const Shell = root.KundeShell, Icons = root.KundeIcons;
  const $ = id => document.getElementById(id);
  const PEEK = 124;                                   // grip + quick-action row
  const isMobile = () => root.matchMedia('(max-width: 719px)').matches;
  const reduceMotion = () => root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function iconInto(el, name, cls) { const old = el.querySelector(':scope > svg.icon'); if (old) old.remove(); el.prepend(Icons.node(name, cls)); }

  function create(deps) {
    const {getLang, tr, onTab, onSnap = () => {}} = deps;
    const sheet = $('sheet'), handle = $('sheet-handle'), topbar = $('topbar'), tabbar = $('tabbar'), body = document.body;
    const st = t => Shell.shellT(getLang(), t);

    // ---- bottom sheet ----------------------------------------------------------------------------------------------
    let snap = 'collapsed', heights = null, contentKey = null, kb = 0, drag = null;
    const vv = root.visualViewport;
    function measure() {
      const viewport = kb && vv ? vv.height : root.innerHeight;
      document.documentElement.style.setProperty('--topbar-b', Math.round(topbar.getBoundingClientRect().bottom) + 'px');
      heights = Shell.snapHeights({viewport, topbar: topbar.getBoundingClientRect().bottom, tabbar: kb ? 0 : tabbar.offsetHeight, peek: PEEK});
      return heights;
    }
    function label() {
      const key = {collapsed: 'sheetCollapsed', half: 'sheetHalf', full: 'sheetFull'}[snap];
      handle.setAttribute('aria-label', st('sheetHandle') + '. ' + st(key));
    }
    function apply(next, {instant = false} = {}) {
      snap = next;
      sheet.dataset.snap = snap;
      sheet.dataset.expanded = String(snap !== 'collapsed');
      handle.setAttribute('aria-expanded', String(snap !== 'collapsed'));
      body.dataset.sheet = snap;
      label();
      if (isMobile()) {
        measure();
        sheet.classList.toggle('instant', instant || reduceMotion());
        sheet.style.height = heights[snap] + 'px';
      } else sheet.style.height = '';
      onSnap(snap);
    }
    // Content decides the snap when it changes (a card opens half way, home is collapsed); user drags stick until the content changes again.
    function setContent(key, preferred) {
      if (key === contentKey) return;
      contentKey = key;
      apply(preferred);
    }
    function relayout() { if (isMobile()) apply(snap, {instant: true}); else apply(snap); }
    root.addEventListener('resize', relayout);
    root.addEventListener('orientationchange', relayout);
    if (root.ResizeObserver) new ResizeObserver(() => { if (isMobile() && !drag) { measure(); sheet.style.height = heights[snap] + 'px'; } }).observe(topbar);

    // virtual keyboard: browsers that do not resize the layout viewport leave fixed bars under the keyboard
    function syncKeyboard() {
      const inset = Shell.keyboardInset(root.innerHeight, vv);
      if (inset === kb) return;
      kb = inset;
      body.classList.toggle('kb-open', kb > 0);
      document.documentElement.style.setProperty('--kb', kb + 'px');
      if (vv) document.documentElement.style.setProperty('--vvh', vv.height + 'px');
      relayout();
    }
    if (vv) { vv.addEventListener('resize', syncKeyboard); vv.addEventListener('scroll', syncKeyboard); }

    // drag: pointer events on the grip only, so the map and the scrolling content never compete with it
    handle.addEventListener('pointerdown', event => {
      if (!isMobile() || (event.pointerType === 'mouse' && event.button !== 0)) return;
      measure();
      drag = {id: event.pointerId, y: event.clientY, h: sheet.offsetHeight, t: event.timeStamp, lastY: event.clientY, lastT: event.timeStamp, v: 0, moved: false};
      try { handle.setPointerCapture(event.pointerId); } catch (_) { /* synthetic events */ }
    });
    handle.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      const dy = drag.y - event.clientY;
      if (!drag.moved && Math.abs(dy) < 6) return;
      if (!drag.moved) { drag.moved = true; sheet.classList.add('dragging'); }
      const dt = Math.max(1, event.timeStamp - drag.lastT);
      drag.v = 0.8 * ((drag.lastY - event.clientY) / dt) + 0.2 * drag.v;
      drag.lastY = event.clientY; drag.lastT = event.timeStamp;
      sheet.style.height = Shell.clampHeight(drag.h + dy, heights) + 'px';
    });
    const endDrag = event => {
      if (!drag || event.pointerId !== drag.id) return;
      const d = drag; drag = null;
      sheet.classList.remove('dragging');
      try { handle.releasePointerCapture(event.pointerId); } catch (_) { /* already released */ }
      if (event.type === 'pointercancel') { apply(snap); return; }
      if (!d.moved) { cycle(); return; }
      const idle = event.timeStamp - d.lastT;   // a finger that rested before lifting is not a flick
      apply(Shell.snapOnRelease(sheet.offsetHeight, heights, idle > 80 ? 0 : d.v));
    };
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
    function cycle() { apply(snap === 'collapsed' ? 'half' : snap === 'half' ? 'full' : 'collapsed'); }
    handle.addEventListener('click', event => { if (event.detail === 0) cycle(); });   // keyboard Enter / Space (pointer taps are handled above)
    handle.addEventListener('keydown', event => {
      const map = {ArrowUp: () => apply(Shell.stepSnap(snap, 1)), ArrowDown: () => apply(Shell.stepSnap(snap, -1)), Home: () => apply('collapsed'), End: () => apply('full')};
      if (map[event.key]) { event.preventDefault(); map[event.key](); }
    });
    sheet.addEventListener('keydown', event => {
      if (event.key === 'Escape' && isMobile() && snap === 'full' && !event.defaultPrevented) { apply('half'); handle.focus(); }
    });

    // ---- tab bar -------------------------------------------------------------------------------------------------------
    const tabs = [...tabbar.querySelectorAll('.tab')];
    const TAB_ICON = {search: 'search', route: 'route', navigator: 'navigator', favorites: 'bookmark', profile: 'user'};
    const TAB_KEY = {search: 'tabSearch', route: 'tabRoute', navigator: 'tabNavigator', favorites: 'tabFavorites', profile: 'tabProfile'};
    for (const tab of tabs) {
      tab.append(Icons.node(TAB_ICON[tab.dataset.tab])); tab.append(document.createElement('span'));
      tab.addEventListener('click', () => onTab(tab.dataset.tab));
      tab.addEventListener('keydown', event => {
        const i = tabs.indexOf(tab);
        const next = {ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1}[event.key];
        if (next == null) return;
        event.preventDefault();
        tabs[(next + tabs.length) % tabs.length].focus();
      });
    }
    function setTab(name) {
      for (const tab of tabs) { if (tab.dataset.tab === name) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current'); }
    }

    // ---- map tool buttons ----------------------------------------------------------------------------------------------
    for (const [id, icon] of [['layers-btn', 'layers'], ['zoom-in', 'plus'], ['zoom-out', 'minus'], ['compass', 'compass'], ['locate', 'locate']]) iconInto($(id), icon);
    const locate = $('locate');
    let lastAccuracy = 0;
    function setLocateState(state, accuracy) {
      locate.dataset.state = state;
      if (accuracy != null) lastAccuracy = accuracy;
      accuracy = lastAccuracy;
      const text = {idle: st('locIdle'), busy: st('locBusy'), ok: st('locOk').replace('{n}', Math.round(accuracy || 0)), denied: st('locDenied'), error: st('locFail')}[state] || '';
      locate.setAttribute('aria-label', tr('locate') + '. ' + text);
      locate.title = tr('locate') + ': ' + text;
      locate.setAttribute('aria-busy', String(state === 'busy'));
    }

    // ---- layers popover --------------------------------------------------------------------------------------------------
    const pop = $('layers-pop'), layersBtn = $('layers-btn');
    function closePop(focus) { if (pop.hidden) return; pop.hidden = true; layersBtn.setAttribute('aria-expanded', 'false'); if (focus) layersBtn.focus(); }
    layersBtn.addEventListener('click', () => {
      pop.hidden = !pop.hidden;
      layersBtn.setAttribute('aria-expanded', String(!pop.hidden));
      if (!pop.hidden) $('layer-3d').focus();
    });
    document.addEventListener('pointerdown', event => { if (!pop.hidden && !pop.contains(event.target) && !layersBtn.contains(event.target)) closePop(false); });
    pop.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); closePop(true); } });
    function setSwitch(el, on, title, note, disabled) {
      el.setAttribute('aria-checked', String(Boolean(on)));
      el.disabled = Boolean(disabled);
      el.querySelector('strong').textContent = title; el.querySelector('small').textContent = note || '';
    }

    // ---- dialog (native <dialog>: focus trap, Esc, inert background) ---------------------------------------------------
    const dlg = $('dialog');
    function dialog({title, body: text, ok, cancel, link, onOk, danger}) {
      $('dialog-title').textContent = title; $('dialog-body').textContent = text;
      const okBtn = $('dialog-ok'), cancelBtn = $('dialog-cancel'), linkEl = $('dialog-link');
      okBtn.textContent = ok; okBtn.className = 'btn ' + (danger ? 'danger' : 'primary');
      cancelBtn.hidden = !cancel; cancelBtn.textContent = cancel || '';
      linkEl.hidden = !link; if (link) { linkEl.textContent = link.label; linkEl.href = link.href; }
      okBtn.onclick = () => { dlg.close ? dlg.close() : dlg.removeAttribute('open'); if (onOk) onOk(); };
      cancelBtn.onclick = () => { dlg.close ? dlg.close() : dlg.removeAttribute('open'); };
      const opener = document.activeElement;
      dlg.addEventListener('close', () => { if (opener && opener.focus) opener.focus(); }, {once: true});
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
      (danger ? cancelBtn : okBtn).focus();
    }

    // ---- quick categories & actions ----------------------------------------------------------------------------------------
    const QUICK = [['shop', 'qcShop'], ['restaurant', 'qcFood'], ['hotel', 'qcHotel'], ['pharmacy', 'qcPharmacy'], ['fuel', 'qcFuel']];
    function buildQuick({colors, onCategory, onMore, extras = [], expanded = false}) {
      const host = $('quick-cats');
      host.replaceChildren();
      const tileFor = (id, text) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'qcat'; b.dataset.category = id; b.style.setProperty('--c', colors[id]);
        b.setAttribute('aria-pressed', 'false');
        const tile = document.createElement('span'); tile.className = 'qcat-tile'; tile.append(Icons.node(id));
        const name = document.createElement('span'); name.className = 'qcat-name'; name.textContent = text;
        b.append(tile, name);
        b.addEventListener('click', () => onCategory(id));
        return b;
      };
      for (const [id, key] of QUICK) host.append(tileFor(id, st(key)));
      for (const [id, text] of extras) host.append(tileFor(id, text));
      const more = document.createElement('button');
      more.type = 'button'; more.className = 'qcat more'; more.id = 'qcat-more'; more.setAttribute('aria-expanded', String(expanded));
      const tile = document.createElement('span'); tile.className = 'qcat-tile'; tile.append(Icons.node(expanded ? 'close' : 'more'));
      const name = document.createElement('span'); name.className = 'qcat-name'; name.textContent = st(expanded ? 'fewerCategories' : 'qcMore');
      more.append(tile, name);
      more.addEventListener('click', onMore);
      host.append(more);
    }

    // ---- labels ------------------------------------------------------------------------------------------------------------
    function labels() {
      tabbar.setAttribute('aria-label', st('tabsLabel'));
      for (const tab of tabs) tab.querySelector('span').textContent = st(TAB_KEY[tab.dataset.tab]);
      sheet.setAttribute('aria-label', st('sheet'));
      for (const [id, icon, key] of [['qa-route', 'route', 'qaRoute'], ['qa-drive', 'car', 'qaDrive'], ['qa-fav', 'bookmark', 'qaFavorites'], ['qa-add', 'addPlace', 'qaAdd']]) {
        const b = $(id); b.replaceChildren(Icons.node(icon), Object.assign(document.createElement('span'), {textContent: st(key)}));
      }
      $('near-title').textContent = st('nearYou');
      $('recent-title').textContent = st('recent'); $('recent-clear').textContent = st('clearHistory');
      $('quick-actions').setAttribute('aria-label', st('sheet'));
      $('quick-cats').setAttribute('aria-label', st('nearYou'));
      for (const [id, key] of [['layers-btn', 'layers'], ['zoom-in', 'zoomIn'], ['zoom-out', 'zoomOut'], ['compass', 'compass']]) { $(id).setAttribute('aria-label', st(key)); $(id).title = st(key); }
      $('map-tools').setAttribute('aria-label', st('layers'));
      $('layers-title').textContent = st('layersTitle');
      $('layer-traffic-t').textContent = st('layerTraffic'); $('layer-traffic-n').textContent = st('layerTrafficNote');
      $('navigator-title').textContent = st('navTitle');
      $('profile-title').textContent = st('profile'); $('profile-note').textContent = st('profileNote');
      for (const [id, key] of [['set-language-title', 'setLanguage'], ['set-theme-title', 'setTheme'], ['set-units-title', 'setUnits'], ['set-map-title', 'setEffects'],
        ['privacy-title', 'privacy'], ['about-title', 'about']]) $(id).textContent = st(key);
      $('privacy-body').textContent = st('privacyBody'); $('clear-data').textContent = st('clearData');
      $('about-body').textContent = st('aboutBody'); $('about-license').textContent = st('aboutLicense');
      $('about-version').textContent = st('aboutVersion').replace('{v}', Shell.VERSION);
      label();
      setLocateState(locate.dataset.state || 'idle');
    }

    // ---- profile (local settings) --------------------------------------------------------------------------------------------
    function segmented(id, options, current, onPick, aria) {
      const host = $(id);
      host.replaceChildren();
      host.setAttribute('aria-labelledby', id + '-title');
      for (const [value, text] of options) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'seg'; b.dataset.value = value; b.textContent = text;
        b.setAttribute('aria-pressed', String(value === current));
        b.addEventListener('click', () => onPick(value));
        host.append(b);
      }
    }
    function renderProfile({lang, themeMode, settings, handlers, langNames}) {
      segmented('set-language', Object.entries(langNames), lang, handlers.language);
      segmented('set-theme', [['system', st('themeSystem')], ['light', st('themeLight')], ['dark', st('themeDark')]], themeMode, handlers.theme);
      segmented('set-units', [['metric', st('unitsMetric')], ['imperial', st('unitsImperial')]], settings.units, handlers.units);
      setSwitch($('set-low'), settings.lowPower, st('layerLow'), st('layerLowNote'));
      setSwitch($('set-history'), settings.history, st('setHistory'), st('setHistoryNote'));
    }

    labels();
    apply('collapsed', {instant: true});
    return {apply, setContent, setTab, relayout, get snap() { return snap; }, labels, setLocateState, closePop, setSwitch, dialog, buildQuick, renderProfile, tabs, handle};
  }
  root.KundeShellUI = {create, PEEK};
})(window);
