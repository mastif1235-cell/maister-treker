'use strict';
const assert=require('node:assert/strict');
(async()=>{
  const module=await import(`../js/tools-map-maplibre.js?marker=${Date.now()}`),categories=['private','apartment','FOB','Муфта','Вузол','Інше'];
  assert.deepEqual(module.OBJECT_ICON_SCALE,{min:.78,max:1.35});
  for(const category of categories){
    const image=module.objectMarkerImage(category),pixel=(x,y)=>Array.from(image.data.slice((y*image.width+x)*4,(y*image.width+x)*4+4));
    assert.deepEqual(pixel(3,21),[255,255,255,255],`${category}: white contour is visible`);
    assert.equal(pixel(24,5)[3],255,`${category}: colored pin body is present`);
  }
  assert.ok(48/2*module.OBJECT_ICON_SCALE.max<36,'working marker remains smaller than the GPS marker');
  console.log('PASS all MapLibre object categories keep semantic pin images, gain a white contour and remain smaller than GPS');
})().catch(error=>{console.error(error);process.exitCode=1;});
