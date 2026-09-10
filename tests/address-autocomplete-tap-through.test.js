'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','js','tickets-bindings.js'),'utf8');
const block=source.slice(source.indexOf("const cityAddressInput=document.getElementById('f_city')"),source.indexOf('  // NEW: як тільки майстер'));
class Target{
  constructor(){this.dataset={};this.value='';this.disabled=false;this.listeners={};this.focusCount=0;}
  addEventListener(type,fn){(this.listeners[type]||(this.listeners[type]=[])).push(fn);}
  emit(type,target){const event={type,target,defaultPrevented:false,stopped:false,immediate:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.immediate=true;this.stopped=true;}};for(const fn of this.listeners[type]||[]){fn(event);if(event.immediate)break;}return event;}
  focus(){this.focusCount++;}
}
const form=new Target(),city=new Target(),street=new Target(),house=new Target(),documentTarget=new Target();
const elements={calcForm:form,f_city:city,f_street:street,f_house:house};let closeCount=0,renderCount=0,geoClickCount=0;
const context={settings:{},tickets:[],MTAddressSuggestions:{streetAfterCitySelection:(_s,_t,_city,current)=>current==='Вірна'?'Вірна':''},closeAddressSuggestionMenus:()=>{closeCount++;},renderAddressSuggestionMenu:()=>{renderCount++;},repositionAddressSuggestionMenus(){},document:{getElementById:id=>elements[id],addEventListener:(...args)=>documentTarget.addEventListener(...args)},window:{visualViewport:{addEventListener(){}},addEventListener(){}}};
vm.createContext(context);vm.runInContext(block,context);
const option=(kind,value)=>{const item={dataset:{addressSuggestion:kind,value}};item.closest=selector=>selector==='[data-address-suggestion]'?item:null;return item;};
const streetOption=option('street','Центральна');
for(const type of ['pointerdown','pointerup','touchstart','touchend']){
  const event=form.emit(type,streetOption);assert.equal(event.stopped,true,`${type} belongs to suggestion`);assert.equal(closeCount,0,'tray remains until click completes');
}
const streetClick=form.emit('click',streetOption);
if(!streetClick.stopped)geoClickCount++;
assert.equal(street.value,'Центральна');assert.equal(closeCount,1);assert.equal(house.focusCount,1,'house receives focus and keyboard flow continues');assert.equal(geoClickCount,0,'underlying geolocation action receives no click');assert.equal(streetClick.defaultPrevented,true);assert.equal(streetClick.immediate,true);
street.value='Вірна';const cityClick=form.emit('click',option('city','Миколаївка 2'));
assert.equal(city.value,'Миколаївка 2');assert.equal(street.value,'Вірна','valid existing street is preserved');assert.equal(closeCount,2);assert.equal(renderCount,0,'city selection neither opens street suggestions nor forces focus');assert.equal(house.focusCount,1,'city selection does not jump to house');assert.equal(cityClick.immediate,true);
assert.doesNotMatch(block,/geo|geolocation/i,'autocomplete selection cannot invoke geolocation');
console.log('PASS mobile suggestion owns pointer/touch/click, blocks tap-through and focuses house after street');
