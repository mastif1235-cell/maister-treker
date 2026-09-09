const fs=require('fs');
const assert=require('assert');

const docs=fs.readFileSync('docs/ARCHITECTURE.md','utf8');
const audit=fs.readFileSync('AUDIT.md','utf8');
for(const statement of [
  'MapLibre is the default map engine',
  'Leaflet remains an explicit compatibility fallback',
  'Offline maps are PMTiles v3 archives stored in OPFS',
  'atomic envelope/payload validation',
  'Revision conflicts are entity-scoped',
  'Ambiguous delivery may leave an extra remote message',
  'Unknown legacy keys are preserved',
  'does not clear IndexedDB, localStorage, OPFS',
  'UUIDs must not be interpreted as timestamps'
])assert(docs.includes(statement),`current architecture must document: ${statement}`);
assert(audit.includes('historical implementation audit'));
assert(audit.includes('docs/ARCHITECTURE.md'));
console.log('current architecture docs regression: PASS');
