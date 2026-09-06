const assert=require('assert');
const fs=require('fs');

const tools=fs.readFileSync('js/tools-domain.js','utf8');
const ui=fs.readFileSync('js/ui-orchestration.js','utf8');

assert.match(tools,/function toolsClearDiagnosticAddress\(\)\{toolsDiagnosticContext=null;toolsDiagnosticSaved=false;\}/);
assert.match(tools,/function toolsLeaveDiagnostics\(\)\{if\(toolsView!==['"]diagnostics['"]\)return;[^}]*toolsClearDiagnosticAddress\(\);toolsView=['"]home['"]/);
assert.match(ui,/if\(tab!==['"]tools['"]&&typeof toolsLeaveDiagnostics===['"]function['"]\)toolsLeaveDiagnostics\(\)/);
assert.match(tools,/data-tools-action=['"]reset-diagnostic-address['"]/);
assert.match(tools,/action===['"]reset-diagnostic-address['"]\)toolsResetDiagnosticAddress\(\)/);
assert.match(tools,/function toolsReturnToTicket\(\)\{\s*toolsLeaveDiagnostics\(\)/);

const clearBody=tools.match(/function toolsClearDiagnosticAddress\(\)\{([^}]*)\}/)?.[1]||'';
assert.doesNotMatch(clearBody,/tickets|toolsDiagnostics|localStorage|saveTickets|toolsSaveDiagnostics/);

console.log('diagnostics-address-context regression: PASS');
