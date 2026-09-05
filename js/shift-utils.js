/*
 * Чисті розрахунки та агрегації змін.
 *
 * Це класичний script, а не ES-модуль: глобальні імена збережені для
 * зворотної сумісності з app.js. Тут немає DOM, storage, мережі або
 * змінюваного стану застосунку.
 */

function roundWorkedHours(hours){
  const value = Number(hours);
  if(!Number.isFinite(value) || value <= 0) return 0;
  const wholeHours = Math.floor(value);
  const minutes = Math.round((value - wholeHours) * 60);
  if(minutes <= 14) return wholeHours;
  if(minutes <= 45) return wholeHours + 0.5;
  return wholeHours + 1;
}

function calculateShiftEarnings(hours, hourlyRate){
  return (Number(hours)||0) * (Number(hourlyRate)||0);
}

function getShiftsForMonth(shifts, refDate){
  return (shifts||[]).filter(s=>isSameMonth(s.date, refDate));
}

function calculateShiftMonthStats(shifts, refDate, hourlyRate){
  const monthShifts = getShiftsForMonth(shifts, refDate);
  const totalHours = monthShifts.reduce((s,x)=>s+(Number(x.hours)||0),0);
  const count = monthShifts.length;
  const averageHours = count ? (totalHours/count) : 0;
  const salary = totalHours * (Number(hourlyRate)||0);
  return {count, totalHours, averageHours, salary};
}

function calculateYearlyShiftHours(shifts, year){
  const hoursByMonth = Array(12).fill(0);
  (shifts||[]).forEach(s=>{
    const d = parseDate(s.date);
    if(d.getFullYear()===year) hoursByMonth[d.getMonth()] += Number(s.hours)||0;
  });
  return hoursByMonth;
}

function sortShiftsByDateDesc(shifts){
  return (shifts||[]).slice().sort((a,b)=> parseDate(b.date) - parseDate(a.date) || String(b.id??'').localeCompare(String(a.id??''),'uk',{numeric:true,sensitivity:'base'}));
}
