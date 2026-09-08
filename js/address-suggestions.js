(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MTAddressSuggestions=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=value=>String(value??'').trim(),key=value=>text(value).toLocaleLowerCase('uk');
  const unique=values=>{const found=new Map();values.forEach(value=>{const id=key(value);if(id&&!found.has(id))found.set(id,text(value));});return[...found.values()];};
  const matches=(values,query)=>{const needle=key(query),list=unique(values);if(!needle)return list.slice(0,40);return list.filter(value=>key(value).startsWith(needle)).concat(list.filter(value=>!key(value).startsWith(needle)&&key(value).includes(needle))).slice(0,40);};
  function cities(settings={},tickets=[],query=''){return matches([...(Array.isArray(settings.cities)?settings.cities:[]),...(Array.isArray(tickets)?tickets.map(ticket=>ticket?.city):[])],query);}
  function streets(settings={},tickets=[],city='',query=''){const cityKey=key(city);if(!cityKey)return[];const configured=Object.entries(settings.streets||{}).filter(([name])=>key(name)===cityKey).flatMap(([,values])=>Array.isArray(values)?values:[]),used=(Array.isArray(tickets)?tickets:[]).filter(ticket=>key(ticket?.city)===cityKey).map(ticket=>ticket?.street);return matches([...configured,...used],query);}
  function streetAfterCitySelection(settings={},tickets=[],city='',currentStreet=''){const current=text(currentStreet);if(!current)return'';return streets(settings,tickets,city,'').some(value=>key(value)===key(current))?current:'';}
  function menuPlacement(inputRect,viewport={},options={}){
    const gap=Number(options.gap)||8,maxHeight=Number(options.maxHeight)||360,minBelow=Number(options.minBelow)||160;
    const visibleTop=Number(viewport.offsetTop)||0,visibleBottom=visibleTop+(Number(viewport.height)||0);
    const below=Math.max(0,visibleBottom-Number(inputRect.bottom)-gap),above=Math.max(0,Number(inputRect.top)-visibleTop-gap);
    const side=below>=Math.min(minBelow,maxHeight)||below>=above?'below':'above',available=side==='below'?below:above;
    const height=Math.min(maxHeight,available),top=side==='below'?Number(inputRect.bottom)+gap:Math.max(visibleTop,Number(inputRect.top)-gap-height);
    return{side,top,maxHeight:height,visibleTop,visibleBottom};
  }
  return{cities,streets,matches,streetAfterCitySelection,menuPlacement};
});
