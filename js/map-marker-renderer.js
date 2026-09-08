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
  function baseImageData(categoryValue,shape='drop',scale=4){
    const width=48*scale,height=58*scale,data=new Uint8ClampedArray(width*height*4),color=CATEGORIES[category(categoryValue)].color;
    const rgb=[1,3,5].map(offset=>parseInt(color.slice(offset,offset+2),16));
    const paint=(x,y,value=[255,255,255])=>{if(x<0||x>=width||y<0||y>=height)return;const at=(y*width+x)*4;data[at]=value[0];data[at+1]=value[1];data[at+2]=value[2];data[at+3]=255;};
    const mask=(pixelX,pixelY,inner=false)=>{const x=pixelX/scale,y=pixelY/scale,inset=inner?5.3:0,radius=inner?(shape==='contrast'?13.4:15.5):21.4;if(shape==='badge')return(x-24)**2+(y-24)**2<=radius**2;if(shape==='contrast'){const diamond=Math.abs(x-24)+Math.abs(y-21)<=radius+5,tail=y>=25+inset/2&&y<=53-inset&&Math.abs(x-24)<=(53-y)*(inner?.28:.48);return diamond||tail;}const circle=(x-24)**2+(y-21.5)**2<=radius**2,tailEnd=shape==='pin'?55:56,tailStart=shape==='pin'?25:27,ratio=shape==='pin'?(inner?.28:.48):(inner?.43:.58);return circle||(y>=tailStart+inset/3&&y<=tailEnd-inset&&Math.abs(x-24)<=(tailEnd-y)*ratio);};
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(mask(x+.5,y+.5,false))paint(x,y);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(mask(x+.5,y+.5,true))paint(x,y,rgb);
    const line=(x1,y1,x2,y2,thickness=1.35)=>{x1*=scale;y1*=scale;x2*=scale;y2*=scale;const steps=Math.max(Math.abs(x2-x1),Math.abs(y2-y1));for(let step=0;step<=steps;step++){const x=Math.round(x1+(x2-x1)*step/steps),y=Math.round(y1+(y2-y1)*step/steps),radius=Math.max(1,Math.round(thickness*scale));for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++)if(dx*dx+dy*dy<=radius*radius)paint(x+dx,y+dy);}};
    const dot=(x,y)=>{for(let sy=0;sy<scale;sy++)for(let sx=0;sx<scale;sx++)paint(x*scale+sx,y*scale+sy);};
    const key=category(categoryValue);
    if(key==='private'){line(14,23,24,14);line(24,14,34,23);line(17,22,17,32);line(31,22,31,32);line(17,32,31,32);}
    else if(key==='apartment'){line(17,14,31,14);line(17,14,17,32);line(31,14,31,32);line(17,32,31,32);for(const y of [19,24,29])for(const x of [21,27]){line(x,y,x+1,y,.7);}}
    else if(key==='FOB'){line(15,17,33,17);line(15,17,15,31);line(33,17,33,31);line(15,31,33,31);line(15,23,33,23,1);}
    else if(key==='Муфта'){line(15,24,33,24,1);for(let y=17;y<=31;y++)for(let x=12;x<=36;x++){const left=(x-17)**2+(y-24)**2,right=(x-31)**2+(y-24)**2;if((left>=25&&left<=43)||(right>=25&&right<=43))dot(x,y);}}
    else if(key==='Вузол'){for(let y=20;y<=28;y++)for(let x=20;x<=28;x++)if((x-24)**2+(y-24)**2<=12)dot(x,y);line(24,24,14,14,1);line(24,24,34,14,1);line(24,24,14,34,1);line(24,24,34,34,1);}
    else{line(24,14,24,27,1.5);for(let y=31;y<=34;y++)for(let x=22;x<=26;x++)dot(x,y);}
    return{width,height,data};
  }
  function imageData(categoryValue,value={},legacyPreset='classic'){
    const d=descriptor(categoryValue,value,legacyPreset),base=baseImageData(d.category,d.shape),sampleX=base.width/d.width,sampleY=base.height/d.height;
    const data=new Uint8ClampedArray(d.width*d.height*4);
    for(let y=0;y<d.height;y++)for(let x=0;x<d.width;x++){const x0=Math.floor(x*sampleX),x1=Math.min(base.width,Math.ceil((x+1)*sampleX)),y0=Math.floor(y*sampleY),y1=Math.min(base.height,Math.ceil((y+1)*sampleY));let alpha=0,red=0,green=0,blue=0,count=0;for(let sy=y0;sy<y1;sy++)for(let sx=x0;sx<x1;sx++){const at=(sy*base.width+sx)*4,a=base.data[at+3];alpha+=a;red+=base.data[at]*a;green+=base.data[at+1]*a;blue+=base.data[at+2]*a;count++;}const target=(y*d.width+x)*4;if(alpha){data[target]=Math.round(red/alpha);data[target+1]=Math.round(green/alpha);data[target+2]=Math.round(blue/alpha);}data[target+3]=Math.round(alpha/count);}
    return{width:d.width,height:d.height,data,descriptor:d};
  }
  function dataUrl(categoryValue,value={},legacyPreset='classic',doc=globalThis.document){
    if(!doc?.createElement)return'';const image=imageData(categoryValue,value,legacyPreset),canvas=doc.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');if(!context)return'';const pixels=context.createImageData(image.width,image.height);pixels.data.set(image.data);context.putImageData(pixels,0,0);return canvas.toDataURL('image/png');
  }
  return{CATEGORIES,SHAPES,SIZES,preference,descriptor,imageData,dataUrl};
});
