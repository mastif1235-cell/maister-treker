'use strict';

function parseHours(value){
  const parsed = Number(String(value == null ? '' : value).trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function dateKey(value){
  const match = String(value || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if(!match) return 0;
  return Number(match[3]) * 10000 + Number(match[2]) * 100 + Number(match[1]);
}

function parseLegacyShifts(rows){
  const records = [];
  const monthHeaders = [];
  const columnHeaders = [];
  const totals = [];
  const blankRows = [];
  const unknownRows = [];
  let currentMonth = '';

  (rows || []).forEach((rawRow, index)=>{
    const row = Array.isArray(rawRow) ? rawRow : [];
    const first = String(row[0] == null ? '' : row[0]).trim();
    const rowNumber = index + 1;

    if(/^📅 МІСЯЦЬ:\s*\d{4}-\d{2}$/.test(first)){
      currentMonth = first.replace(/^.*:\s*/, '');
      monthHeaders.push({row:rowNumber, month:currentMonth});
      return;
    }
    if(first === 'Дата' && String(row[1] || '').trim() === 'День'){
      columnHeaders.push({row:rowNumber, month:currentMonth});
      return;
    }
    if(first.indexOf('📊 РАЗОМ ЗА МІСЯЦЬ:') === 0){
      totals.push({
        row:rowNumber,
        month:currentMonth,
        hours:parseHours(row[2]),
        countText:String(row[3] || '').trim()
      });
      return;
    }
    if(!row.some(value=>String(value == null ? '' : value).trim())){
      blankRows.push(rowNumber);
      return;
    }
    if(/^\d{2}\.\d{2}\.\d{4}$/.test(first)){
      const hours = parseHours(row[2]);
      const id = String(row[4] == null ? '' : row[4]).trim();
      if(!currentMonth || !Number.isFinite(hours) || hours < 0 || hours > 48 || !id){
        unknownRows.push({row:rowNumber, values:row.slice(0, 5)});
        return;
      }
      records.push({
        id,
        date:first,
        hours,
        coworker:String(row[3] == null ? '' : row[3]).trim(),
        sourceRow:rowNumber,
        sourceMonth:currentMonth
      });
      return;
    }
    unknownRows.push({row:rowNumber, values:row.slice(0, 5)});
  });

  const idCounts = new Map();
  records.forEach(record=>idCounts.set(record.id, (idCounts.get(record.id) || 0) + 1));
  const duplicateIds = Array.from(idCounts).filter(([, count])=>count > 1).map(([id])=>id);
  const perMonth = {};
  records.forEach(record=>{
    const bucket = perMonth[record.sourceMonth] || (perMonth[record.sourceMonth] = {count:0, hours:0});
    bucket.count += 1;
    bucket.hours += record.hours;
  });
  Object.keys(perMonth).forEach(month=>{ perMonth[month].hours = Number(perMonth[month].hours.toFixed(6)); });

  const totalParity = totals.map(total=>{
    const computed = perMonth[total.month] || {count:0, hours:0};
    const storedCount = Number((total.countText.match(/\d+/) || [])[0]);
    return {
      month:total.month,
      storedHours:total.hours,
      computedHours:computed.hours,
      storedCount:Number.isFinite(storedCount) ? storedCount : null,
      computedCount:computed.count,
      hoursMatch:Number.isFinite(total.hours) && Math.abs(total.hours - computed.hours) < 1e-9,
      countMatch:Number.isFinite(storedCount) && storedCount === computed.count
    };
  });

  const canonicalRecords = records.slice().sort((a, b)=>dateKey(a.date) - dateKey(b.date) || a.sourceRow - b.sourceRow)
    .map(record=>({id:record.id, date:record.date, hours:record.hours, coworker:record.coworker}));

  return {
    canonicalHeaders:['id','date','hours','coworker'],
    canonicalRecords,
    diagnostics:{monthHeaders,columnHeaders,totals,blankRows,unknownRows,duplicateIds,perMonth,totalParity}
  };
}

module.exports = {parseLegacyShifts};
