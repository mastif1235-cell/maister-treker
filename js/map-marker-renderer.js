/* Canonical network/home marker geometry shared by Settings, MapLibre and Leaflet. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.MTMapMarkerRenderer=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const CATEGORIES={
    private:{label:'Приватний будинок',icon:'🏠',color:'#3aa76d',className:'private'},
    apartment:{label:'Багатоквартирний будинок',icon:'🏢',color:'#5666d8',className:'apartment'},
    FOB:{label:'FOB',icon:'📦',color:'#e1922c',className:'fob'},
    'Муфта':{label:'Муфта',icon:'🔗',color:'#a368dc',className:'splice'},
    'Вузол':{label:'Вузол',icon:'📡',color:'#d94a4a',className:'node'},
    'Інше':{label:'Інше',icon:'📍',color:'#59636d',className:'other'}
  };
  const SHAPES=['drop','pin','badge','contrast'],SIZES={small:42,medium:48,large:56};
  const category=value=>CATEGORIES[value]?value:'Інше';
  function preference(value={},legacyPreset='classic'){
    const shape=SHAPES.includes(value?.shape)?value.shape:(legacyPreset==='contrast'?'contrast':'drop');
    const legacySize=legacyPreset==='compact'?'small':legacyPreset==='large'?'large':'medium';
    return{shape,size:SIZES[value?.size]?value.size:legacySize};
  }
  function descriptor(categoryValue,value={},legacyPreset='classic'){
    const key=category(categoryValue),selected=preference(value,legacyPreset),width=SIZES[selected.size];
    return{category:key,...CATEGORIES[key],...selected,width,height:Math.round(width*58/48),pixelRatio:2,id:`mt-object-${key}-${selected.shape}-${selected.size}`};
  }
  function baseImageData(categoryValue,shape='drop'){
    const width=48,height=58,data=new Uint8ClampedArray(width*height*4),color=CATEGORIES[category(categoryValue)].color;
    const rgb=[1,3,5].map(offset=>parseInt(color.slice(offset,offset+2),16));
    const paint=(x,y,value=[255,255,255])=>{if(x<0||x>=width||y<0||y>=height)return;const at=(y*width+x)*4;data[at]=value[0];data[at+1]=value[1];data[at+2]=value[2];data[at+3]=255;};
    const mask=(x,y,inner=false)=>{const inset=inner?6:0,radius=inner?(shape==='contrast'?13:15):21;if(shape==='badge')return(x-24)**2+(y-25)**2<=radius**2;if(shape==='contrast'){const diamond=Math.abs(x-24)+Math.abs(y-21)<=radius+5,tail=y>=25+inset/2&&y<=52-inset&&Math.abs(x-24)<=(52-y)*(inner?.28:.48);return diamond||tail;}const circle=(x-24)**2+(y-21)**2<=radius**2,tailEnd=shape==='pin'?55:56,tailStart=shape==='pin'?25:27,ratio=shape==='pin'?(inner?.28:.48):(inner?.43:.58);return circle||(y>=tailStart+inset/3&&y<=tailEnd-inset&&Math.abs(x-24)<=(tailEnd-y)*ratio);};
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(mask(x,y,false))paint(x,y);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(mask(x,y,true))paint(x,y,rgb);
    const line=(x1,y1,x2,y2,thickness=2)=>{const steps=Math.max(Math.abs(x2-x1),Math.abs(y2-y1));for(let step=0;step<=steps;step++){const x=Math.round(x1+(x2-x1)*step/steps),y=Math.round(y1+(y2-y1)*step/steps);for(let dy=-thickness;dy<=thickness;dy++)for(let dx=-thickness;dx<=thickness;dx++)paint(x+dx,y+dy);}};
    const key=category(categoryValue);
    if(key==='private'){line(14,23,24,14);line(24,14,34,23);line(17,22,17,32);line(31,22,31,32);line(17,32,31,32);}
    else if(key==='apartment'){for(let y=13;y<=31;y++)for(let x=17;x<=31;x++)if(x<20||x>28||y<16||y>28||((x+y)%6<2))paint(x,y);}
    else if(key==='FOB'){line(15,17,33,17);line(15,17,15,31);line(33,17,33,31);line(15,31,33,31);line(15,23,33,23,1);}
    else if(key==='Муфта'){line(15,24,33,24);for(let y=17;y<=31;y++)for(let x=12;x<=36;x++){const left=(x-17)**2+(y-24)**2,right=(x-31)**2+(y-24)**2;if((left>=25&&left<=49)||(right>=25&&right<=49))paint(x,y);}}
    else if(key==='Вузол'){for(let y=20;y<=28;y++)for(let x=20;x<=28;x++)if((x-24)**2+(y-24)**2<=14)paint(x,y);line(24,24,14,14,1);line(24,24,34,14,1);line(24,24,14,34,1);line(24,24,34,34,1);}
    else{line(24,14,24,27);for(let y=31;y<=34;y++)for(let x=22;x<=26;x++)paint(x,y);}
    return{width,height,data};
  }
  function imageData(categoryValue,value={},legacyPreset='classic'){
    const d=descriptor(categoryValue,value,legacyPreset),base=baseImageData(d.category,d.shape);
    if(d.width===base.width)return{width:base.width,height:base.height,data:base.data,descriptor:d};
    const data=new Uint8ClampedArray(d.width*d.height*4);
    for(let y=0;y<d.height;y++)for(let x=0;x<d.width;x++){const source=(Math.min(base.height-1,Math.floor(y*base.height/d.height))*base.width+Math.min(base.width-1,Math.floor(x*base.width/d.width)))*4,target=(y*d.width+x)*4;data[target]=base.data[source];data[target+1]=base.data[source+1];data[target+2]=base.data[source+2];data[target+3]=base.data[source+3];}
    return{width:d.width,height:d.height,data,descriptor:d};
  }
  function dataUrl(categoryValue,value={},legacyPreset='classic',doc=globalThis.document){
    if(!doc?.createElement)return'';const image=imageData(categoryValue,value,legacyPreset),canvas=doc.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');if(!context)return'';const pixels=context.createImageData(image.width,image.height);pixels.data.set(image.data);context.putImageData(pixels,0,0);return canvas.toDataURL('image/png');
  }
  return{CATEGORIES,SHAPES,SIZES,preference,descriptor,imageData,dataUrl};
});
