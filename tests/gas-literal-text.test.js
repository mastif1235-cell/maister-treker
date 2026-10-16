'use strict';
const assert=require('node:assert/strict');
const {createServer}=require('./helpers/sync-gas-harness');
const server=createServer();
for(const text of ['=1+1',' +SUM(A1:A2)','@SUM(A1)','-1+2',"'=original",'ordinary']){
  let stored,formula=false;
  const sheet={getRange:(_r,_c,_n,width)=>({setNumberFormat(){return this;},setWrap(){return this;},
    setValues(rows){stored=rows[0].map(v=>{if(typeof v==='string'&&v.startsWith("'"))return v.slice(1);if(typeof v==='string'&&/^\s*[=+@-]/.test(v))formula=true;return v;});}}),autoResizeRows(){}};
  server.context.writeTicketRow(sheet,2,{id:'synthetic',date:'01.02.2026',time:'10:00',content:text,sum:100,tags:[text],backupNote:text});
  assert.equal(formula,false,'user text must be escaped before setValues: '+text);
  assert.equal(stored[3],text);assert.equal(stored[5],text);assert.equal(stored[6],text);assert.equal(stored[4],100);
}
console.log('PASS A07 literal-text writes preserve source strings and numeric money in Sheets emulation');
