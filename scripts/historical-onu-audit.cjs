'use strict';
// Offline CSV reader/planner. Never contacts Google, GAS, the PWA or GitHub.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const core=require('../js/dispatcher-report-core.js');

function parseCSV(input){
  const text=String(input).replace(/^\uFEFF/u,''),rows=[];let row=[],value='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=c;continue;}
    if(c==='"'){if(value||closed)throw new Error('INVALID_CSV');quoted=true;continue;}
    if(c===','||c==='\n'||c==='\r'){
      row.push(value);value='';closed=false;
      if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(cell=>cell!==''))rows.push(row);row=[];}continue;
    }
    if(closed)throw new Error('INVALID_CSV');value+=c;
  }
  if(quoted)throw new Error('INVALID_CSV');
  if(value||row.length||closed){row.push(value);if(row.some(cell=>cell!==''))rows.push(row);}
  if(!rows.length)throw new Error('EMPTY_CSV');
  const headers=rows.shift();
  if(headers.some(key=>!key)||new Set(headers).size!==headers.length)throw new Error('INVALID_CSV_HEADERS');
  return rows.map(cells=>{if(cells.length!==headers.length)throw new Error('INVALID_CSV_COLUMNS');return Object.fromEntries(headers.map((key,index)=>[key,cells[index]]));});
}
const numeric=value=>{if(typeof value!=='string'||!/^\d+(?:\.\d+)?$/u.test(value.trim()))throw new Error('INVALID_CSV_NUMBER');const n=Number(value);if(!Number.isFinite(n))throw new Error('INVALID_CSV_NUMBER');return n;};
async function canonicalTickets(rows){
  const {ticketFromGasRow}=await import('../mcp/src/gas/mappers.js');
  const tickets=[],incompleteCanonicalIds=[];
  for(const row of rows){
    if(!row.id||!row.date||!row.time||row.content===undefined||row.sum===undefined)throw new Error('SOURCE_COLUMNS_REQUIRED');
    numeric(row.sum);
    const mapped=ticketFromGasRow(row);
    if(mapped.fullDataError)throw new Error('CANONICAL_JSON_INVALID');
    if(mapped.fullData.sum!==undefined&&Number(mapped.fullData.sum)!==mapped.sum)throw new Error('SOURCE_FINANCIAL_MISMATCH');
    const complete=Object.keys(mapped.fullData).length>0;
    if(!complete)incompleteCanonicalIds.push(mapped.id);
    tickets.push({...mapped.fullData,id:mapped.id,date:mapped.date,time:mapped.time,content:mapped.content,sum:mapped.sum,tags:mapped.tags,cloudImported:complete?mapped.fullData.cloudImported===true:true});
  }
  return {tickets,incompleteCanonicalIds};
}
function reportRows(rows){
  const numericFields=new Set('amount total onu_used onu_replacement router_used payment_cash payment_cashless payment_free_amount payment_free_count source_version service_fee tariff_amount'.split(' '));
  return rows.map(row=>{
    if(!row.ticket_id||row.source_version===undefined||row.deleted_at===undefined||row.sync_status===undefined)throw new Error('REPORT_COLUMNS_REQUIRED');
    const out={};for(const field of [...core.ALL_FIELDS,'deleted_at','sync_status']){
      if(row[field]===undefined)continue;
      if(row.deleted_at&&row[field]===''&&field!=='source_version')continue;
      if(!core.FIELDS.includes(field)&&!['deleted_at','sync_status'].includes(field)&&row[field]==='')continue;
      out[field]=numericFields.has(field)?numeric(row[field]):row[field];
    }return out;
  });
}
async function main(args){
  const flags={};for(let i=0;i<args.length;i+=2){if(!['--current','--archive','--report','--output'].includes(args[i])||!args[i+1]||flags[args[i]])throw new Error('INVALID_AUDIT_ARGUMENTS');flags[args[i]]=args[i+1];}
  if(!flags['--current']||!flags['--archive']||!flags['--report'])throw new Error('THREE_CSV_FILES_REQUIRED');
  const inputs={};for(const key of ['--current','--archive','--report']){
    const filename=path.resolve(flags[key]);if(fs.statSync(filename).size>32*1024*1024)throw new Error('AUDIT_INPUT_TOO_LARGE');
    inputs[key]={text:fs.readFileSync(filename,'utf8')};inputs[key].sha256=crypto.createHash('sha256').update(inputs[key].text).digest('hex');
  }
  const current=await canonicalTickets(parseCSV(inputs['--current'].text)),archive=await canonicalTickets(parseCSV(inputs['--archive'].text));
  const withinPeriod=ticket=>{const date=core.dateKey(ticket.date);return date>='2026-02-01'&&date<='2026-10-31';};
  globalThis.crypto??=crypto.webcrypto;
  const {dryRunHistoricalCorrection}=await import('../js/dispatcher-historical-plan.mjs');
  const plan=await dryRunHistoricalCorrection({current:current.tickets.filter(withinPeriod),archive:archive.tickets.filter(withinPeriod),reportRows:reportRows(parseCSV(inputs['--report'].text)),incompleteCanonicalIds:[...current.incompleteCanonicalIds,...archive.incompleteCanonicalIds]},core);
  const proof=JSON.parse(fs.readFileSync(path.join(__dirname,'..','runtime-proof.json'),'utf8'));
  for(const asset of ['js/dispatcher-report-core.js','js/dispatcher-report-projection.mjs']){
    if(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',asset))).digest('hex')!==proof.assets['./'+asset])throw new Error('AUDIT_CANDIDATE_RUNTIME_PROOF_MISMATCH');
  }
  const output=JSON.stringify({candidate_cache:proof.cacheName,period:'2026-02..2026-10',ready_for_production:false,source_file_sha256:Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key.slice(2),input.sha256])),...plan},null,2)+'\n';
  if(flags['--output']){
    if(path.extname(flags['--output']).toLowerCase()!=='.json')throw new Error('OUTPUT_JSON_REQUIRED');
    fs.writeFileSync(path.resolve(flags['--output']),output,{flag:'wx'});process.stdout.write('READ_ONLY_AUDIT_SAVED\n');
  }else process.stdout.write(output);
}
module.exports={parseCSV,canonicalTickets,reportRows,main};
if(require.main===module)main(process.argv.slice(2)).catch(error=>{process.stderr.write(/^[A-Z_]+$/u.test(error.message)?error.message+'\n':'AUDIT_FAILED\n');process.exitCode=1;});
