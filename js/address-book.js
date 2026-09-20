/* Stage 2A: local directory identity. No ticket mutations, transliteration or fuzzy merges. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MTAddressBook=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  const key=s=>typeof s==='string'?s.normalize('NFC').trim().replace(/\s+/g,' ').toLowerCase():'';
  function name(value){
    if(typeof value!=='string'||!value.trim()||value.length>300||/[\x00-\x1f\x7f]/.test(value))throw new Error('Некоректна назва адреси');
    return value.trim();
  }
  function uuid(){
    if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
    if(!globalThis.crypto?.getRandomValues)throw new Error('Безпечний генератор UUID недоступний');
    const bytes=globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const h=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }
  function aliases(values){
    if(!Array.isArray(values)||values.length>100)throw new Error('Некоректні aliases');
    return [...new Map(values.map(v=>{const n=name(v);return [key(n),n];})).values()];
  }
  function validate(book){
    if(!book||book.version!==1||!Array.isArray(book.cities)||!Array.isArray(book.streets)||book.cities.length+book.streets.length>50000)throw new Error('Непідтримуваний або пошкоджений AddressBook');
    const ids=new Set(),cities=new Set();
    for(const [kind,items] of [['cities',book.cities],['streets',book.streets]])for(const item of items){
      if(!item||typeof item.id!=='string'||!UUID.test(item.id)||ids.has(item.id)||typeof item.active!=='boolean')throw new Error('Некоректний або повторний UUID адреси');
      name(item.name);aliases(item.aliases);
      if(typeof item.createdAt!=='string'||typeof item.updatedAt!=='string'||!Number.isFinite(Date.parse(item.createdAt))||!Number.isFinite(Date.parse(item.updatedAt)))throw new Error('Некоректна дата адреси');
      if(kind==='streets'&&!cities.has(item.cityId))throw new Error('Вулиця без міста');
      ids.add(item.id);if(kind==='cities')cities.add(item.id);
    }
    return book;
  }
  function empty(){return {version:1,cities:[],streets:[]};}
  function copy(book){return JSON.parse(JSON.stringify(validate(book)));}
  function add(book,kind,value,cityId,options={}){
    validate(book);
    if(!['cities','streets'].includes(kind))throw new Error('Некоректний тип адреси');
    if(kind==='streets'&&!book.cities.some(c=>c.id===cityId&&c.active))throw new Error('Спершу оберіть активне місто');
    return insert(book,kind,value,cityId,options,new Set([...book.cities,...book.streets].map(i=>i.id)));
  }
  function insert(book,kind,value,cityId,options,ids){
    if(ids.size>=50000)throw new Error('Довідник завеликий');
    const id=(options.uuid||uuid)();
    if(typeof id!=='string'||!UUID.test(id)||ids.has(id))throw new Error('UUID collision');
    const now=options.now||new Date().toISOString();
    const item={id,name:name(value),aliases:[],active:true,createdAt:now,updatedAt:now};
    if(kind==='streets')item.cityId=cityId;
    book[kind].push(item);ids.add(id);return item;
  }
  function update(book,kind,id,patch,now=new Date().toISOString()){
    validate(book);
    const item=book[kind]?.find(i=>i.id===id);if(!item)throw new Error('Адресу не знайдено');
    // Only editable fields. Neither identity nor parent city can be overwritten.
    const next={...item,updatedAt:now};
    if(own(patch,'name'))next.name=name(patch.name);
    if(own(patch,'aliases'))next.aliases=aliases(patch.aliases);
    if(own(patch,'active')){if(typeof patch.active!=='boolean')throw new Error('Некоректний стан');next.active=patch.active;}
    Object.assign(item,next);return item;
  }
  function matches(items,value){const k=key(value);return k?items.filter(i=>key(i.name)===k||i.aliases.some(a=>key(a)===k)):[];}
  function resolve(book,city,street){
    validate(book);
    if(typeof city!=='string'||typeof street!=='string'||!key(city)||!key(street)||city.length>300||street.length>300||/[\x00-\x1f\x7f]/.test(city+street))return {status:'MALFORMED'};
    const cities=matches(book.cities.filter(c=>c.active),city);
    if(cities.length>1)return {status:'AMBIGUOUS'};
    if(!cities.length)return {status:'NO_MATCH'};
    const streets=matches(book.streets.filter(s=>s.active&&s.cityId===cities[0].id),street);
    if(streets.length>1)return {status:'AMBIGUOUS'};
    if(!streets.length)return {status:'NO_MATCH'};
    return {status:key(cities[0].name)===key(city)&&key(streets[0].name)===key(street)?'EXACT':'ALIAS_EXACT',cityId:cities[0].id,streetId:streets[0].id};
  }
  function remember(book,city,street,options){
    // Explicit legacy directory input only; archived/ambiguous matches are not resurrected.
    const n=name(city),found=matches(book.cities,n);
    if(found.length>1)return false;
    const c=found[0]||add(book,'cities',n,null,options);
    if(!c.active||!street)return false;
    name(street);
    if(!matches(book.streets.filter(s=>s.cityId===c.id),street).length)add(book,'streets',street,c.id,options);
    return true;
  }
  function fromLegacy(settings,options){
    const book=empty();return appendLegacy(book,settings,options);
  }
  function appendLegacy(book,settings,options={}){
    validate(book);
    const ids=new Set([...book.cities,...book.streets].map(i=>i.id));
    const byName=new Map();
    for(const city of book.cities){if(!byName.has(city.name))byName.set(city.name,[]);byName.get(city.name).push(city);}
    const streetNames=new Set(book.streets.map(s=>JSON.stringify([s.cityId,s.name])));
    const cities=Array.isArray(settings?.cities)?settings.cities:[];
    const streets=settings?.streets&&typeof settings.streets==='object'&&!Array.isArray(settings.streets)?settings.streets:{};
    // Preserve distinct legacy names, including case variants, as separate candidates.
    for(const value of [...cities,...Object.keys(streets)]){
      if(typeof value!=='string'||!value.trim())continue;
      const candidates=byName.get(value.trim())||[];
      if(candidates.length>1){
        // Fail import rather than lose incoming streets or assign them to the first UUID.
        if(own(streets,value)&&Array.isArray(streets[value])&&streets[value].length)throw new Error('Неоднозначне місто у legacy backup');
        continue;
      }
      let city=candidates[0];
      if(!city){city=insert(book,'cities',value,null,options,ids);byName.set(city.name,[city]);}
      if(!city.active||!own(streets,value)||!Array.isArray(streets[value]))continue;
      for(const street of streets[value])if(typeof street==='string'&&street.trim()){
        const k=JSON.stringify([city.id,street.trim()]);
        if(!streetNames.has(k)){insert(book,'streets',street,city.id,options,ids);streetNames.add(k);}
      }
    }
    return validate(book);
  }
  function projection(book){
    validate(book);const cities=[],streets=Object.create(null);
    const activeCities=new Map(book.cities.filter(c=>c.active).map(c=>[c.id,c.name]));
    const names=new Map();
    for(const city of book.cities.filter(c=>c.active)){
      if(!names.has(city.name)){cities.push(city.name);names.set(city.name,new Set());}
    }
    for(const street of book.streets)if(street.active&&activeCities.has(street.cityId))names.get(activeCities.get(street.cityId)).add(street.name);
    for(const [n,values] of names)streets[n]=[...values];
    return {cities,streets};
  }
  function importSettings(incoming,current){
    const book=current?.addressBook?copy(current.addressBook):fromLegacy(current||{});
    if(incoming?.addressBook!=null){
      const imported=copy(incoming.addressBook);
      // Explicit backup restore owns shared UUID metadata. Retain local-only identities.
      for(const kind of ['cities','streets']){
        const byId=new Map(book[kind].map(i=>[i.id,i]));
        for(const item of imported[kind]){
          const old=byId.get(item.id);
          if(old&&kind==='streets'&&old.cityId!==item.cityId)throw new Error('UUID вулиці має інше місто');
          byId.set(item.id,item);
        }
        book[kind]=[...byId.values()];
      }
    }else appendLegacy(book,incoming||{});
    validate(book);return {addressBook:book,...projection(book)};
  }
  function duplicateCandidates(book){
    validate(book);const groups=new Map();
    for(const [kind,items] of [['cities',book.cities],['streets',book.streets]])for(const item of items.filter(i=>i.active))for(const n of new Set([item.name,...item.aliases].map(key))){
      const k=JSON.stringify([kind,item.cityId||'',n]);
      if(!groups.has(k))groups.set(k,new Set());groups.get(k).add(item.id);
    }
    return [...groups.values()].filter(g=>g.size>1).map(g=>[...g]);
  }
  return {empty,validate,copy,add,update,resolve,remember,fromLegacy,projection,importSettings,duplicateCandidates};
});
