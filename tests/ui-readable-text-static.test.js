'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),css=fs.readFileSync(path.join(root,'styles.css'),'utf8'),naryad=fs.readFileSync(path.join(root,'js/naryad-render.js'),'utf8'),trash=fs.readFileSync(path.join(root,'js/tickets-domain.js'),'utf8');
assert.match(css,/\.tab-btn\{[\s\S]*font-size:12px/,'primary mobile navigation has a readable default');
assert.match(css,/@media \(max-width:430px\)\{\.tab-btn\{font-size:10\.5px\}/,'narrow phones do not shrink navigation to 9.5px');
for(const selector of ['tools-map-filter','tools-map-layer-switcher button','meter .m-label','datenav .date-sub','ticket-card .tc-sync-badge','ticket-network-choice-copy small','dg-label']){
  const start=css.indexOf('.'+selector);assert.ok(start>=0,'selector exists: '+selector);assert.doesNotMatch(css.slice(start,start+260),/font(?:-size)?:[^;}]*\b(?:9|10|11|11\.5)px/,'user-visible '+selector+' is not microtext');
}
assert.match(naryad,/font-size:12px; color:var\(--text-dim\).*додано/,'dispatcher queue timestamp is readable');
assert.match(trash,/font-size:12px; color:var\(--text-faint\).*Видалено:/,'trash retention timestamp is readable');
console.log('PASS critical mobile UI text avoids previously tiny 9.5–11.5px sizes');
