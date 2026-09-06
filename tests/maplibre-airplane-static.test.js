'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('index.html'),sw=read('sw.js'),adapter=read('js/tools-map-maplibre.js'),storage=read('js/offline-map-storage.js');

for(const asset of ['vendor/maplibre/maplibre-gl.css','vendor/maplibre/maplibre-gl.mjs','vendor/maplibre/maplibre-gl-shared.mjs','vendor/maplibre/maplibre-gl-worker.mjs','vendor/pmtiles/pmtiles.js','js/offline-map-storage.js','js/tools-map-maplibre.js']){
  assert.ok(sw.includes(`./${asset}`),`airplane shell cache is missing ${asset}`);
}
assert.match(html,/vendor\/pmtiles\/pmtiles\.js/);
assert.match(html,/js\/tools-map-maplibre\.js/);
assert.match(adapter,/new pm\.FileSource\(stored\.file\)/,'installed PMTiles is range-read from its OPFS File');
assert.match(adapter,/pmtiles:\/\//,'offline MapLibre source uses the local PMTiles protocol');
assert.doesNotMatch(adapter,/glyphs\s*:|sprite\s*:/,'offline vector style has no network glyph or sprite dependency');
assert.doesNotMatch(adapter,/stored\.file\.arrayBuffer|FileReader/,'offline archive is not loaded wholly into RAM');
assert.match(storage,/file\.stream\(\)\.pipeTo\(writable\)/,'PMTiles install streams into OPFS');
console.log('PASS MapLibre airplane-mode asset wiring and range-based OPFS PMTiles path');
