const fs=require('fs');
const assert=require('assert');

const checklist=fs.readFileSync('docs/FINAL-REGRESSION.md','utf8');
const rows=[...checklist.matchAll(/^\| (\d+) \| ([^|]+) \| (.+) \|$/gm)];
assert.equal(rows.length,32,'all 32 practical scenarios must be classified');
assert.deepEqual(rows.map(row=>Number(row[1])),Array.from({length:32},(_,index)=>index+1));
for(const [,number,scenario,verification] of rows){
  assert(/Automated:|Manual:/.test(verification),`scenario ${number} ${scenario.trim()} needs an explicit verification owner`);
  if(verification.includes('Automated:')){
    for(const file of verification.match(/[\w-]+\.test\.js/g)||[])assert(fs.existsSync(`tests/${file}`),`listed automated test must exist: ${file}`);
  }
}
assert(checklist.includes('without clearing site data'));
assert(checklist.includes('No smoke-test step requires deleting real user data'));
console.log('final practical regression matrix: PASS (32/32 classified)');
