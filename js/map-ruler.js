/* Temporary distance measurement, shared by Leaflet and MapLibre. No storage. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MTMapRuler=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const point=value=>{const lat=value?.lat,lng=value?.lng;if(typeof lat!=='number'||typeof lng!=='number'||![lat,lng].every(Number.isFinite)||Math.abs(lat)>90||Math.abs(lng)>180)return null;return{lat,lng};};
  function distance(a,b){
    const p=point(a),q=point(b);if(!p||!q)return 0;
    const radians=value=>value*Math.PI/180,dlat=radians(q.lat-p.lat),dlng=radians(q.lng-p.lng);
    const h=Math.sin(dlat/2)**2+Math.cos(radians(p.lat))*Math.cos(radians(q.lat))*Math.sin(dlng/2)**2;
    return 6371008.8*2*Math.atan2(Math.sqrt(Math.min(1,h)),Math.sqrt(Math.max(0,1-h)));
  }
  const total=points=>points.slice(1).reduce((sum,p,i)=>sum+distance(points[i],p),0);
  const format=value=>value>=1000?`${(value/1000).toFixed(2)} км`:`${Math.round(value)} м`;
  function createState(onChange=()=>{},canActivate=()=>true){
    let active=false,points=[];
    const snapshot=()=>({active,points:points.map(p=>({...p})),distance:total(points)});
    const notify=()=>{onChange(snapshot());return snapshot();};
    return{snapshot,isActive:()=>active,
      activate(){if(!canActivate())return false;active=true;notify();return true;},
      add(value){const p=point(value);if(!active||!p)return false;points.push(p);notify();return true;},
      undo(){points.pop();return notify();},clear(){points=[];return notify();},
      exit(){active=false;points=[];return notify();}
    };
  }
  function attach(map,engine,root,options={}){
    const L=root.L,doc=root.document;let control,leafletLayer=null,dirty=false,destroyed=false;
    const wrap=doc.createElement('div');wrap.className='tools-map-ruler-control'+(engine==='maplibre'?' maplibregl-ctrl':'');
    wrap.innerHTML='<button type="button" data-ruler="toggle" aria-pressed="false" title="Виміряти відстань">📏 Лінійка</button><div data-ruler="panel" hidden><output data-ruler="distance" aria-live="polite">0 м</output><button type="button" data-ruler="undo" title="Скасувати останню точку" aria-label="Скасувати останню точку">↶</button><button type="button" data-ruler="clear">Очистити</button><button type="button" data-ruler="exit" aria-label="Вийти з лінійки">✕</button></div>';
    const node=key=>wrap.querySelector(`[data-ruler="${key}"]`);
    const removeGl=()=>{for(const id of ['mt-ruler-points','mt-ruler-line'])if(map.getLayer?.(id))map.removeLayer(id);if(map.getSource?.('mt-ruler'))map.removeSource('mt-ruler');};
    const redraw=()=>{
      if(destroyed||!dirty)return;
      const s=state.snapshot();
      if(engine==='leaflet'){
        if(leafletLayer){leafletLayer.remove();leafletLayer=null;}
        if(s.active&&s.points.length){leafletLayer=L.layerGroup().addTo(map);if(s.points.length>1)L.polyline(s.points.map(p=>[p.lat,p.lng]),{color:'#e66c16',weight:3,interactive:false}).addTo(leafletLayer);s.points.forEach(p=>L.circleMarker([p.lat,p.lng],{radius:5,color:'#fff',weight:2,fillColor:'#e66c16',fillOpacity:1,interactive:false}).addTo(leafletLayer));}
      }else{
        if(!s.active){removeGl();dirty=false;return;}
        if(map.isStyleLoaded?.()===false)return;
        const features=s.points.map(p=>({type:'Feature',properties:{},geometry:{type:'Point',coordinates:[p.lng,p.lat]}}));
        if(s.points.length>1)features.unshift({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:s.points.map(p=>[p.lng,p.lat])}});
        const data={type:'FeatureCollection',features},source=map.getSource?.('mt-ruler');
        if(source)source.setData(data);else map.addSource('mt-ruler',{type:'geojson',data});
        if(!map.getLayer?.('mt-ruler-line'))map.addLayer({id:'mt-ruler-line',source:'mt-ruler',type:'line',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#e66c16','line-width':3}});
        if(!map.getLayer?.('mt-ruler-points'))map.addLayer({id:'mt-ruler-points',source:'mt-ruler',type:'circle',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':5,'circle-color':'#e66c16','circle-stroke-color':'#fff','circle-stroke-width':2}});
      }
      dirty=false;
    };
    const state=createState(s=>{node('toggle').setAttribute('aria-pressed',String(s.active));node('panel').hidden=!s.active;node('distance').textContent=format(s.distance);node('undo').disabled=node('clear').disabled=!s.points.length;dirty=true;redraw();},()=>options.canActivate?.()!==false);
    const click=event=>{if(state.isActive())state.add(engine==='leaflet'?event.latlng:event.lngLat);};
    const style=()=>{if(state.isActive()){dirty=true;redraw();}};
    const escape=event=>{if(event.key==='Escape'&&state.isActive())state.exit();};
    wrap.addEventListener('click',event=>{const action=event.target.closest('[data-ruler]')?.dataset.ruler;if(action==='toggle'){if(state.isActive())state.exit();else state.activate();}else if(['undo','clear','exit'].includes(action))state[action]();});
    for(const name of ['click','dblclick','pointerdown','pointerup','contextmenu','wheel'])wrap.addEventListener(name,event=>event.stopPropagation());
    if(engine==='leaflet'){control=L.control({position:'bottomleft'});control.onAdd=()=>{L.DomEvent.disableClickPropagation(wrap);L.DomEvent.disableScrollPropagation(wrap);return wrap;};control.addTo(map);}
    else{control={onAdd:()=>wrap,onRemove:()=>wrap.remove()};map.addControl(control,'bottom-left');map.on('style.load',style);map.on('idle',redraw);}
    map.on('click',click);map.getContainer?.().addEventListener('keydown',escape);
    return{...state,destroy(){state.exit();destroyed=true;map.off('click',click);map.getContainer?.().removeEventListener('keydown',escape);if(engine==='leaflet')control.remove();else{map.off('style.load',style);map.off('idle',redraw);map.removeControl(control);}}};
  }
  return{distance,total,format,createState,attach};
});
