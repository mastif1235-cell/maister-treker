'use strict';
// Generated artifacts only; never changes project/legacy Code.gs or config.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
function bundle(){
  const core=fs.readFileSync(path.join(root,'js/dispatcher-report-core.js'),'utf8');
  let backend=fs.readFileSync(path.join(root,'gas/dispatcher-report/DispatcherReport.gs'),'utf8');
  const bridge=fs.readFileSync(path.join(root,'gas/dispatcher-report/Bridge.html'),'utf8');
  const original="var template=HtmlService.createTemplateFromFile('Bridge');template.bridgeConfig=JSON.stringify({origin:origin,channel:channel}).replace(/</g,'\\\\u003c');\n  return template.evaluate()";
  const normalized=backend.replace(/\r\n/g,'\n');
  if(!normalized.includes(original))throw new Error('Bundle template boundary changed');
  backend=normalized.replace(original,"var config=JSON.stringify({origin:origin,channel:channel}).replace(/</g,'\\\\u003c');\n  return HtmlService.createHtmlOutput(REPORT_BRIDGE_HTML.replace('<?!= bridgeConfig ?>',config))");
  return core+'\nvar REPORT_BRIDGE_HTML = '+JSON.stringify(bridge)+';\n'+backend;
}
module.exports={bundle};
if(require.main===module){
  const code=bundle();new(require('node:vm').Script)(code);
  const out=process.argv[2];if(!out)throw new Error('Pass an external artifact directory');
  const target=path.resolve(out);if(target.startsWith(root+path.sep))throw new Error('Artifact directory must be outside repository');
  fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'DispatcherReport.bundle.gs'),code);fs.copyFileSync(path.join(root,'gas/dispatcher-report/appsscript.json'),path.join(target,'appsscript.json'));
  console.log(JSON.stringify({artifact:target,sha256:crypto.createHash('sha256').update(code).digest('hex'),bytes:Buffer.byteLength(code)}));
}
