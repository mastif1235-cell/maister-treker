'use strict';
const crypto=require('node:crypto');
function varint(n){const bytes=[];while(n>127){bytes.push((n%128)|128);n=Math.floor(n/128);}bytes.push(n);return Buffer.from(bytes);}
const field=(n,bytes)=>Buffer.concat([varint(n*8+2),varint(bytes.length),bytes]);
function fixture(options={}){
  // A real tiny MVT archive (roads/buildings/places metadata), with one z0
  // tile containing a road line. Padding slows the mock stream for stop/resume;
  // no real regional archive is committed or downloaded in CI.
  const geometry=Buffer.from([9,0,0,10,128,32,128,32]);
  const feature=Buffer.concat([Buffer.from([8,1,24,2]),field(4,geometry)]);
  const layer=Buffer.concat([field(1,Buffer.from('roads')),field(2,feature),Buffer.from([40,128,32,120,2])]);
  const tile=field(3,layer);
  const metadata=Buffer.from(JSON.stringify({name:'Fixture',attribution:'© OpenStreetMap contributors',vector_layers:(options.layers||['roads','buildings','places']).map(id=>({id,fields:{}}))}));
  const directory=Buffer.concat([varint(1),varint(0),varint(1),varint(tile.length),varint(1)]);
  const size=options.size||2*1024*1024,header=Buffer.alloc(127),root=127,json=root+directory.length,leaf=json+metadata.length;
  header.write('PMTiles',0);header[7]=3;
  for(const [at,value] of [[8,root],[16,directory.length],[24,json],[32,metadata.length],[40,leaf],[48,0],[56,leaf],[64,size-leaf],[72,1],[80,1],[88,1]])header.writeBigUInt64LE(BigInt(value),at);
  header[96]=1;header[97]=1;header[98]=1;header[99]=1;header[100]=0;header[101]=0;
  for(const [at,value] of [[102,32],[106,47],[110,37],[114,50],[119,34.5],[123,48.5]])header.writeInt32LE(Math.round(value*1e7),at);header[118]=0;
  const bytes=Buffer.concat([header,directory,metadata,tile,Buffer.alloc(size-leaf-tile.length)]);
  const manifest={id:'dnipro-oblast',title:'Дніпропетровська область',version:'2026-09-30',source:'Protomaps / OpenStreetMap',license:'ODbL',attribution:'© OpenStreetMap contributors',downloadId:'dnipro-oblast-2026-09-30',size:bytes.length,minZoom:0,maxZoom:0,displayMaxZoom:18,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),updatedAt:'2026-09-30T00:00:00Z'};
  return {bytes,manifest};
}
module.exports={fixture};
