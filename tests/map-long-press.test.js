'use strict';

// Довге натискання на карту має запускати той самий сценарій додавання обʼєкта,
// що й «＋» → клік по карті. Тест перевіряє сам жест (без браузера) і те, що
// обидва рушії карти викликають саме наявний обробник onAddHere.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file=>fs.readFileSync(path.join(ROOT, file), 'utf8');

/* ---------- фейковий контейнер карти ---------- */

function createContainer(rect){
  const listeners = new Map();
  const key = (type, capture)=>type + (capture ? ':capture' : '');
  return {
    rect:rect || {left:100, top:50},
    getBoundingClientRect(){ return this.rect; },
    addEventListener(type, listener, capture){
      const bucket = listeners.get(key(type, capture)) || [];
      bucket.push(listener);
      listeners.set(key(type, capture), bucket);
    },
    removeEventListener(type, listener, capture){
      const bucket = listeners.get(key(type, capture)) || [];
      listeners.set(key(type, capture), bucket.filter(item=>item !== listener));
    },
    fire(type, event, capture){
      const bucket = listeners.get(key(type, capture)) || [];
      for(const listener of bucket) listener(event);
      return event;
    }
  };
}

function pointerEvent(overrides){
  const event = Object.assign({pointerId:1, pointerType:'touch', button:0, clientX:0, clientY:0}, overrides || {});
  event.preventDefault = ()=>{ event.defaultPrevented = true; };
  event.stopPropagation = ()=>{ event.stopped = true; };
  event.stopImmediatePropagation = ()=>{ event.immediateStopped = true; };
  return event;
}

/* ---------- tools-map.js у VM з керованими таймерами ---------- */

function loadMapFacade(){
  const timers = new Map();
  let nextTimerId = 1;
  const context = {
    console, Math, Number, Date, JSON, Object, Array, Set, Map, String, Boolean,
    setTimeout:(callback, delay)=>{ const id = nextTimerId++; timers.set(id, {callback, delay}); return id; },
    clearTimeout:id=>{ timers.delete(id); },
    document:{getElementById:()=>null, createElement:()=>({style:{}, classList:{add(){}, remove(){}}}), querySelectorAll:()=>[]}
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read('js/tools-map.js'), context, {filename:'js/tools-map.js'});
  return {
    bind:context.MTToolsMap.bindMapLongPress,
    runPendingTimers(){
      const pending = [...timers.values()];
      timers.clear();
      for(const timer of pending) timer.callback();
      return pending.length;
    }
  };
}

const facade = loadMapFacade();
assert.equal(typeof facade.bind, 'function', 'спільний обробник long-press експортовано з MTToolsMap');

function scenario(options){
  const container = createContainer();
  const points = [];
  const unbind = facade.bind(container, (x, y)=>points.push({x, y}), options);
  return {container, points, unbind};
}

/* ---------- 1. довге натискання: одна подія з координатами місця утримання ---------- */

const longPress = scenario({});
longPress.container.fire('pointerdown', pointerEvent({clientX:220, clientY:370}));
assert.equal(longPress.points.length, 0, 'до завершення утримання нічого не створюється');
facade.runPendingTimers();
assert.deepEqual(longPress.points, [{x:220, y:370}], 'long-press віддає координати місця утримання');

/* ---------- 2. після long-press наступний click не проходить ---------- */

const clickAfter = pointerEvent();
longPress.container.fire('click', clickAfter, true);
assert.equal(clickAfter.defaultPrevented, true, 'click після long-press скасовано — немає другої дії');
assert.equal(clickAfter.immediateStopped, true, 'click не доходить до обробників карти');
const laterClick = pointerEvent();
longPress.container.fire('click', laterClick, true);
assert.equal(laterClick.defaultPrevented, undefined, 'звичайний клік після цього не блокується');

/* ---------- 3. короткий тап без режиму додавання нічого не створює ---------- */

const tap = scenario({});
tap.container.fire('pointerdown', pointerEvent({clientX:200, clientY:300}));
tap.container.fire('pointerup', pointerEvent({clientX:200, clientY:300}));
assert.equal(facade.runPendingTimers(), 0, 'після відпускання таймер long-press скасовано');
assert.deepEqual(tap.points, [], 'короткий тап не створює точку');
const tapClick = pointerEvent();
tap.container.fire('click', tapClick, true);
assert.equal(tapClick.defaultPrevented, undefined, 'короткий тап не блокує звичайний клік');

/* ---------- 4. pan/drag скасовує long-press ---------- */

const drag = scenario({});
drag.container.fire('pointerdown', pointerEvent({clientX:200, clientY:300}));
drag.container.fire('pointermove', pointerEvent({clientX:240, clientY:300}));
assert.equal(facade.runPendingTimers(), 0, 'рух пальцем скасовує утримання');
assert.deepEqual(drag.points, [], 'перетягування карти не створює точку');

/* ---------- 5. невеликий зсув пальця не скасовує жест ---------- */

const jitter = scenario({});
jitter.container.fire('pointerdown', pointerEvent({clientX:200, clientY:300}));
jitter.container.fire('pointermove', pointerEvent({clientX:206, clientY:304}));
facade.runPendingTimers();
assert.deepEqual(jitter.points, [{x:200, y:300}], 'невеликий зсув лишає жест робочим, координати — з місця утримання');

/* ---------- 6. права кнопка миші та другий палець не запускають додавання ---------- */

const rightClick = scenario({});
rightClick.container.fire('pointerdown', pointerEvent({pointerType:'mouse', button:2}));
assert.equal(facade.runPendingTimers(), 0, 'права кнопка миші не запускає додавання');
assert.deepEqual(rightClick.points, []);

const pinch = scenario({});
pinch.container.fire('pointerdown', pointerEvent({pointerId:1, clientX:200, clientY:300}));
pinch.container.fire('pointerdown', pointerEvent({pointerId:2, clientX:260, clientY:300}));
assert.equal(facade.runPendingTimers(), 0, 'другий палець (масштабування) скасовує утримання');
assert.deepEqual(pinch.points, []);

/* ---------- 7. у режимі розміщення точки жест не втручається ---------- */

const placing = scenario({ignore:()=>true});
placing.container.fire('pointerdown', pointerEvent({clientX:200, clientY:300}));
assert.equal(facade.runPendingTimers(), 0, 'під час розміщення точки long-press не запускається');
const placingClick = pointerEvent();
placing.container.fire('click', placingClick, true);
assert.equal(placingClick.defaultPrevented, undefined, 'звичайний клік у режимі розміщення не блокується');

/* ---------- 8. контекстне меню браузера не заважає ---------- */

const menu = scenario({});
menu.container.fire('pointerdown', pointerEvent({clientX:200, clientY:300}));
const pressedMenu = menu.container.fire('contextmenu', pointerEvent(), true);
assert.equal(pressedMenu.defaultPrevented, true, 'поки палець утримують, системне меню не відкривається');
facade.runPendingTimers();
const afterMenu = menu.container.fire('contextmenu', pointerEvent(), true);
assert.equal(afterMenu.defaultPrevented, true, 'меню не відкривається і одразу після long-press');
const idleMenu = menu.container.fire('contextmenu', pointerEvent(), true);
assert.equal(idleMenu.defaultPrevented, undefined, 'права кнопка миші поза утриманням працює як раніше');

/* ---------- 9. відвʼязка слухачів ---------- */

const detached = scenario({});
detached.unbind();
detached.container.fire('pointerdown', pointerEvent({clientX:200, clientY:300}));
assert.equal(facade.runPendingTimers(), 0, 'після знищення карти слухачі знято');
assert.deepEqual(detached.points, []);

/* ---------- 10. обидва рушії викликають наявний обробник, без другої реалізації ---------- */

const leaflet = read('js/tools-map.js');
const maplibre = read('js/tools-map-maplibre.js');
const domain = read('js/tools-domain.js');

assert.match(leaflet, /unbindLongPress=bindMapLongPress\(container/, 'Leaflet підключає спільний long-press');
assert.match(leaflet, /options\.onAddHere\(\{lat:point\.lat,lng:point\.lng\}\)/, 'Leaflet віддає координати в наявний onAddHere');
assert.match(maplibre, /root\.MTToolsMap\.bindMapLongPress\(container/, 'MapLibre використовує той самий обробник жесту');
assert.match(maplibre, /options\.onAddHere\(\{lat:point\.lat,lng:point\.lng\}\)/, 'MapLibre віддає координати в наявний onAddHere');
for(const source of [leaflet, maplibre]){
  assert.doesNotMatch(source, /toolsStartMapAddMode|toolsOpenPointEditorFromMap|toolsOpenNetworkPointEditor/,
    'рушії карти не містять другої реалізації додавання точки');
}
assert.match(domain, /onAddHere:point=>toolsStartMapAddMode\(point\)/, 'карта отримує той самий сценарій додавання, що й кнопка «＋»');
assert.match(domain, /action==='map-add-object'\)toolsStartMapAddMode\(\)/, 'кнопка «＋» і далі відкриває режим додавання');
assert.match(leaflet, /map\.on\('click',clickHandler\)/, 'у режимі додавання точка ставиться звичайним кліком');
assert.match(maplibre, /map\.on\('click',clickHandler\)/, 'те саме для MapLibre');

console.log('PASS map long-press reuses the existing add-point flow: one marker, exact coordinates, tap/drag safe, no duplicate click');
