const fs=require('fs');
const assert=require('assert');

const index=fs.readFileSync('index.html','utf8');
const sw=fs.readFileSync('sw.js','utf8');
const main=fs.readFileSync('js/tools-domain.js','utf8');
const diagnostics=fs.readFileSync('js/tools-diagnostics-network.js','utf8');

assert(index.indexOf('js/tools-domain.js')<index.indexOf('js/tools-diagnostics-network.js'),'diagnostics extension must load after shared tools state');
assert(sw.includes("'./js/tools-diagnostics-network.js'"),'diagnostics extension must remain in offline app shell');
for(const name of ['runToolsDiagnostics','toolsRunSpeedTest','toolsCancelSpeedTest']){
  assert(diagnostics.includes(`function ${name}`),`${name} must live in diagnostics extension`);
  assert(!main.includes(`function ${name}`),`${name} must not be duplicated in tools-domain`);
}
for(const name of ['toolsConnectionStatsHtml','toolsConnectionCheckTick','toolsStartConnectionCheck','toolsStopConnectionCheck']){
  assert(!diagnostics.includes(`function ${name}`),`${name} (continuous availability check) is retired`);
  assert(!main.includes(`function ${name}`),`${name} is retired from tools-domain as well`);
}
assert(main.includes("function toolsClearDiagnosticAddress"),'diagnostic session lifecycle remains in tools-domain');
console.log('safe domain split regression: PASS');
