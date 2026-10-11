'use strict';
// Exercise the real GAS journal against isolated sheet storage, not a mocked
// receipt API. Ticket writes remain controlled by each test's reportWrite_.
module.exports=function install(c){
  const sheets=new Map();
  function sheet(){
    const cells=[];
    return {cells,hideSheet(){},getMaxRows:()=>100002,insertRowsAfter(){},getLastRow:()=>cells.length,
      getRange(row,col,height=1,width=1){const api={setNumberFormat:()=>api,
        getValues:()=>Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>cells[row+i-1]?.[col+j-1]??'')),
        setValues(values){values.forEach((v,i)=>{cells[row+i-1]??=[];v.forEach((x,j)=>cells[row+i-1][col+j-1]=x);});return api;},
        setValue(value){return api.setValues([[value]]);}};return api;}};
  }
  const ss={getSheetByName:name=>sheets.get(name)||null,insertSheet:name=>{if(sheets.has(name))throw Error('exists');const s=sheet();sheets.set(name,s);return s;}};
  const read=c.reportStore_;c.reportStore_=(...args)=>({...read(...args),ss});
  c.SpreadsheetApp={flush(){}};
  return {ss,sheets,clear:()=>sheets.clear()};
};
