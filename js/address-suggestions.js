(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MTAddressSuggestions=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=value=>String(value??'').trim(),key=value=>text(value).toLocaleLowerCase('uk');
  const unique=values=>{const found=new Map();values.forEach(value=>{const id=key(value);if(id&&!found.has(id))found.set(id,text(value));});return[...found.values()];};
  const matches=(values,query)=>{const needle=key(query),list=unique(values);if(!needle)return list.slice(0,40);return list.filter(value=>key(value).startsWith(needle)).concat(list.filter(value=>!key(value).startsWith(needle)&&key(value).includes(needle))).slice(0,40);};
  function cities(settings={},tickets=[],query=''){return matches([...(Array.isArray(settings.cities)?settings.cities:[]),...(Array.isArray(tickets)?tickets.map(ticket=>ticket?.city):[])],query);}
  function streets(settings={},tickets=[],city='',query=''){const cityKey=key(city);if(!cityKey)return[];const configured=Object.entries(settings.streets||{}).filter(([name])=>key(name)===cityKey).flatMap(([,values])=>Array.isArray(values)?values:[]),used=(Array.isArray(tickets)?tickets:[]).filter(ticket=>key(ticket?.city)===cityKey).map(ticket=>ticket?.street);return matches([...configured,...used],query);}
  return{cities,streets,matches};
});
