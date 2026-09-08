'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),suggest=require('../js/address-suggestions.js');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const settings={cities:['Таромське','Дніпро'],streets:{Таромське:['Центральна','Шевченка']}},tickets=[{city:'таромське',street:'Польова'},{city:'Кам’янське',street:'Нова'}],snapshot=JSON.stringify({settings,tickets});
assert.deepEqual(suggest.cities(settings,tickets,'Та'),['Таромське']);assert.deepEqual(suggest.cities(settings,tickets,'дНі'),['Дніпро']);
assert.deepEqual(suggest.streets(settings,tickets,'ТАРОМСЬКЕ',''),['Центральна','Шевченка','Польова']);assert.deepEqual(suggest.streets(settings,tickets,'Таромське','пол'),['Польова']);
assert.deepEqual(suggest.streets(settings,tickets,'Unknown',''),[]);assert.deepEqual(suggest.streets(settings,tickets,'Кам’янське','x'),[]);assert.equal(JSON.stringify({settings,tickets}),snapshot,'source address data is not mutated');
const html=read('index.html'),bindings=read('js/tickets-bindings.js'),sw=read('sw.js');assert.match(html,/autocomplete="one-time-code"[^>]*role="combobox"/,'anti-browser-address-autofill semantics remain');assert.match(html,/citySuggestions[\s\S]*streetSuggestions/);assert.match(bindings,/renderAddressSuggestionMenu\('city'\)/);assert.match(sw,/address-suggestions\.js/,'offline app shell includes custom autocomplete');
console.log('PASS offline custom city/street autocomplete, selection wiring and anti-browser-autofill semantics');
