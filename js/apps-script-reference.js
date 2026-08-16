const APPS_SCRIPT_CODE = `var SYNC_SECRET = 'ЗАМІНІТЬ_НА_СВІЙ_ДОВГИЙ_ВИПАДКОВИЙ_РЯДОК'; // ⚠️ встановіть тут той самий рядок, що й у полі "Секретний ключ" у Налаштуваннях застосунку — інакше синхронізація не працюватиме
\x20
var TICKET_HEADERS = ['id','date','time','content','sum','tags','нотатки_майстра','повніДаніJSON']; // NEW: 8-й стовпець — окремо від нотаток майстра
var SHIFT_HEADERS  = ['id','date','hours','coworker'];
\x20
\x20
/* ---------- Вхідні точки ---------- */
\x20
function doPost(e) {
  var data = JSON.parse(e.postData.contents);
\x20
  if (!checkSecret(data.secret)) return forbiddenResponse();
\x20
  var action = data.action;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var result = {status: 'ok'};
\x20
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return jsonResponse({status: 'error', message: 'Busy, try again'});
  }
\x20
  try {
    if (action === 'addTicket') {
      addTicketRow(ss, data);
    } else if (action === 'updateTicket') {
      updateTicketRow(ss, data);
    } else if (action === 'deleteTicket') {
      deleteRowById(getOrCreateSheet(ss, 'Заявки', TICKET_HEADERS), data.id);
    } else if (action === 'addShift') {
      addShiftRow(ss, data);
    } else if (action === 'deleteShift') {
      deleteRowById(getOrCreateSheet(ss, 'Зміни', SHIFT_HEADERS), data.id);
    } else if (action === 'syncAll') {
      syncAllData(ss, data.tickets, data.shifts);
    } else if (action === 'syncAllTickets') {
      writeAllTickets(ss, data.tickets || []);
    } else if (action === 'syncAllShifts') {
      writeAllShifts(ss, data.shifts || []);
    } else if (action === 'clearAll') {
      syncAllData(ss, [], []);
    } else {
      throw new Error('Unknown action: ' + action);
    }
  } catch (err) {
    result = {status: 'error', message: String(err)};
  } finally {
    lock.releaseLock();
  }
\x20
  return jsonResponse(result);
}
\x20
function doGet(e) {
  // e може бути відсутній при ручному запуску з редактора Apps Script,
  // тому звертаємось до e.parameter обережно.
  var secret = (e && e.parameter && e.parameter.secret) || '';
  if (!checkSecret(secret)) return forbiddenResponse();
\x20
  // NEW: read-only перевірка "чи є вже такий id в аркуші Заявки" —
  // застосунок викликає це одразу після додавання нової заявки (окремим
  // запитом, ПІСЛЯ основного no-cors POST), щоб підтвердити, що вона
  // реально потрапила в таблицю, а не просто повірити, що запит кудись
  // дійшов. Нічого не пише — тому не має жодного побічного ефекту.
  if (e && e.parameter && e.parameter.action === 'checkTicketExists') {
    var checkSheet = getOrCreateSheet(SpreadsheetApp.getActiveSpreadsheet(), 'Заявки', TICKET_HEADERS);
    var checkLast = checkSheet.getLastRow();
    var exists = false;
    if (checkLast > 1) {
      var checkIds = checkSheet.getRange(2, 1, checkLast - 1, 1).getValues().flat();
      var targetId = String(e.parameter.id);
      exists = checkIds.some(function (v) { return String(v) === targetId; });
    }
    return jsonResponse({status: 'ok', exists: exists});
  }

  // Read-only підтвердження стану після no-cors POST. Повертає рівно один
  // рядок за stable id або ticket:null, тому клієнт може перевірити add,
  // update і delete без передачі великого fullDataJson у query-параметрах.
  if (e && e.parameter && e.parameter.action === 'getTicketById') {
    var stateSheet = getOrCreateSheet(SpreadsheetApp.getActiveSpreadsheet(), 'Заявки', TICKET_HEADERS);
    var stateLast = stateSheet.getLastRow();
    var stateTicket = null;
    var stateTz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    var requestedId = String(e.parameter.id);
    if (stateLast > 1) {
      var rows = stateSheet.getRange(2, 1, stateLast - 1, 8).getValues();
      for (var ri = 0; ri < rows.length; ri++) {
        var row = rows[ri];
        if (String(row[0]) !== requestedId) continue;
        stateTicket = {
          id: safeString(row[0]),
          date: cellToDateString(row[1], stateTz),
          time: cellToTimeString(row[2], stateTz),
          content: row[3] === null || row[3] === undefined ? '' : String(row[3]),
          sum: safeNumber(row[4]),
          tags: row[5] ? String(row[5]).split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [],
          backupNote: safeString(row[6]),
          fullDataJson: safeString(row[7])
        };
        break;
      }
    }
    return jsonResponse({status: 'ok', ticket: stateTicket});
  }
\x20
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var tSheet = ss.getSheetByName('Заявки');
  var sSheet = ss.getSheetByName('Зміни');
  var tickets = [];
  var shifts = [];
\x20
  if (tSheet && tSheet.getLastRow() > 1) {
    // NEW: 8 колонок замість 7 — додався повніДаніJSON
    tSheet.getRange(2, 1, tSheet.getLastRow() - 1, 8).getValues().forEach(function (r) {
      if (!r[0] && !r[1]) return;
      tickets.push({
        id: safeString(r[0]),
        date: cellToDateString(r[1], tz),
        time: cellToTimeString(r[2], tz),
        content: r[3] === null || r[3] === undefined ? '' : String(r[3]),
        sum: safeNumber(r[4]),
        tags: r[5] ? String(r[5]).split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [],
        backupNote: safeString(r[6]),
        fullDataJson: safeString(r[7]), // NEW
        photo: null
      });
    });
  }
\x20
  if (sSheet && sSheet.getLastRow() > 1) {
    sSheet.getRange(2, 1, sSheet.getLastRow() - 1, 4).getValues().forEach(function (r) {
      if (!r[0] && !r[1]) return;
      shifts.push({
        id: safeString(r[0]),
        date: cellToDateString(r[1], tz),
        hours: safeNumber(r[2]),
        coworker: safeString(r[3])
      });
    });
  }
\x20
  return jsonResponse({tickets: tickets, shifts: shifts});
}
\x20
\x20
/* ---------- Авторизація / відповіді ---------- */
\x20
function checkSecret(value) {
  return String(value || '') === SYNC_SECRET;
}
\x20
function forbiddenResponse() {
  return jsonResponse({status: 'error', message: 'forbidden'});
}
\x20
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
\x20
\x20
/* ---------- Лист і заголовки ---------- */
\x20
function getOrCreateSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  // NEW: форматуємо колонки в "Звичайний текст" щоразу (а не лише при
  // створенні листа) — інакше на вже існуючих таблицях старі клітинки з
  // датою могли лишитись типом Date, а не текстом, через що сортування
  // за датою ламалось (див. parseDdMmYyyy нижче — тепер він розуміє й
  // Date, і текст, але формат все одно варто тримати єдиним).
  sheet.getRange(1, 1, 1000, 3).setNumberFormat('@');
  if (name === 'Заявки') {
    sheet.getRange(1, 6, 1000, 3).setNumberFormat('@'); // NEW: tags + нотатки_майстра + повніДаніJSON (було 2 колонки, стало 3)
    // Перенос тексту в колонці "content" (D) — довгий опис буде повністю
    // видно в клітинці, а не обрізатись. Виконується щоразу (не лише при
    // створенні листа), щоб застосуватись і до вже існуючої таблиці.
    sheet.getRange(1, 4, Math.max(sheet.getMaxRows(), 1000), 1).setWrap(true);
    // NEW: за бажанням — сховати технічний стовпець H (повніДаніJSON), щоб
    // він не муляв око при перегляді таблиці. � озкоментуйте рядок нижче,
    // якщо хочете, щоб він ховався автоматично щоразу:
    // sheet.hideColumns(8);
  }
  return sheet;
}
\x20
\x20
/* ---------- Заявки ---------- */
\x20
function addTicketRow(ss, t) {
  var sheet = getOrCreateSheet(ss, 'Заявки', TICKET_HEADERS);
\x20
  var last = sheet.getLastRow();
  if (last > 1) {
    var ids = sheet.getRange(2, 1, last - 1, 1).getValues().flat();
    if (ids.some(function (v) { return String(v) === String(t.id); })) {
      return; // дублікат за id — нічого не робимо
    }
  }
\x20
  // NEW: замість "вставити в row 2, а потім пересортувати ВЕСЬ лист" (це
  // могло тихо падати з помилкою на якомусь із існуючих рядків і лишати
  // нову заявку назавжди зверху) — одразу шукаємо правильну позицію за
  // датою/часом, так само як це вже давно і надійно працює для "Зміни".
  var newKey = ticketDateKey(t);
  var insertRow = last + 1; // за замовчуванням — у кінець (найстаріша)
  if (last > 1) {
    var dateTimeCols = sheet.getRange(2, 2, last - 1, 2).getValues(); // B (дата), C (час)
    insertRow = last + 1;
    for (var i = 0; i < dateTimeCols.length; i++) {
      var existingKey = rowDateKey([null, dateTimeCols[i][0], dateTimeCols[i][1]]);
      if (existingKey < newKey) { insertRow = i + 2; break; } // нова заявка новіша за цю — стає перед нею
    }
  }
  if (insertRow <= last) sheet.insertRowBefore(insertRow);
  writeTicketRow(sheet, insertRow, t);
}

function updateTicketRow(ss, t) {
  var sheet = getOrCreateSheet(ss, 'Заявки', TICKET_HEADERS);
  var last = sheet.getLastRow();
  if (last < 2) { addTicketRow(ss, t); return; }
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues().flat();
  var idx = ids.findIndex(function (v) { return String(v) === String(t.id); });
  if (idx === -1) { addTicketRow(ss, t); return; }
  writeTicketRow(sheet, idx + 2, t);
  sortTicketsSheet(sheet);
}

function writeTicketRow(sheet, rowIndex, t) {
  var row = [t.id, t.date, t.time, t.content, t.sum, (t.tags || []).join(', '), t.backupNote || '', t.fullDataJson || '']; // NEW: 8-й елемент
  var range = sheet.getRange(rowIndex, 1, 1, row.length);
  sheet.getRange(rowIndex, 1, 1, 1).setNumberFormat('@'); // id
  sheet.getRange(rowIndex, 2, 1, 1).setNumberFormat('@'); // date
  sheet.getRange(rowIndex, 3, 1, 1).setNumberFormat('@'); // time
  sheet.getRange(rowIndex, 6, 1, 1).setNumberFormat('@'); // tags
  sheet.getRange(rowIndex, 7, 1, 1).setNumberFormat('@'); // нотатки_майстра
  sheet.getRange(rowIndex, 8, 1, 1).setNumberFormat('@'); // NEW: повніДаніJSON
  sheet.getRange(rowIndex, 5, 1, 1).setNumberFormat('0.##'); // sum
  range.setValues([row]);
  // Перенос тексту + автопідбір висоти рядка під довгий опис
  sheet.getRange(rowIndex, 4, 1, 1).setWrap(true);
  sheet.setRowHeightsAuto(rowIndex, 1);
}
\x20
// NEW: раніше тут було sheet.clear(), а потім цикл з сотень окремих
// writeTicketRow() (кожен — кілька власних getRange()/setValues()
// викликів). Якщо скрипт падав по таймауту Apps Script чи обривався
// інтернет ПОСЕ� ЕД цього циклу — лист лишався вже очищеним, але заповненим
// лише частково (або взагалі порожнім). Тепер: спочатку повністю збираємо
// нові дані в пам'яті й пишемо їх у ОК� ЕМ�Й тимчасовий лист, і лише коли
// він вже повністю готовий — міняємо його місцями зі старим "Заявки".
// Стару таблицю ніхто не чіпає, доки заміна не готова на 100%: якщо щось
// впаде вище (до заміни) — "Заявки" так і лишиться, якою була, а не
// порожньою.
function writeAllTickets(ss, tickets) {
  var sorted = sortTicketsByDateDesc(tickets); // щоб і повний синк тримав порядок за датою
  var tempSheet = ss.insertSheet('_Заявки_tmp_' + Date.now());
  try {
    tempSheet.appendRow(TICKET_HEADERS);
    if (sorted.length) {
      var rows = sorted.map(function (t) {
        return [t.id, t.date, t.time, t.content, t.sum, (t.tags || []).join(', '), t.backupNote || '', t.fullDataJson || ''];
      });
      tempSheet.getRange(2, 1, rows.length, 1).setNumberFormat('@'); // id
      tempSheet.getRange(2, 2, rows.length, 1).setNumberFormat('@'); // date
      tempSheet.getRange(2, 3, rows.length, 1).setNumberFormat('@'); // time
      tempSheet.getRange(2, 5, rows.length, 1).setNumberFormat('0.##'); // sum
      tempSheet.getRange(2, 6, rows.length, 3).setNumberFormat('@'); // tags + нотатки_майстра + повніДаніJSON
      tempSheet.getRange(2, 1, rows.length, 8).setValues(rows); // ОД�Н запис одразу для всіх рядків
      tempSheet.getRange(2, 4, rows.length, 1).setWrap(true);
    }
    swapInPlace(ss, tempSheet, 'Заявки');
    getOrCreateSheet(ss, 'Заявки', TICKET_HEADERS); // застосовує форматування шапки/переносу тексту й нових порожніх рядків
  } catch (err) {
    ss.deleteSheet(tempSheet); // невдала спроба — прибираємо чернетку, стара "Заявки" й не торкалась
    throw err;
  }
}
\x20
// Атомарна (наскільки це можливо в Apps Script) заміна листа: старий
// перейменовується в резервний, новий стає під потрібною назвою, і лише
// ПІСЛЯ цього видаляється резервний. Навіть якщо скрипт впаде рівно між
// цими кроками — в таблиці лишаться ОБ�ДВА листи (з новими й старими
// даними), а не жоден.
function swapInPlace(ss, newSheet, finalName) {
  var oldSheet = ss.getSheetByName(finalName);
  var backupName = null;
  if (oldSheet) {
    backupName = '_' + finalName + '_old_' + Date.now();
    oldSheet.setName(backupName);
  }
  newSheet.setName(finalName);
  if (oldSheet) ss.deleteSheet(oldSheet);
}
\x20
// Пересортовує всі рядки листа "Заявки" за датою і часом — від
// найновішої зверху до найстарішої знизу, незалежно від того, у якому
// порядку вони туди потрапили раніше.
function sortTicketsSheet(sheet) {
  var last = sheet.getLastRow();
  if (last <= 2) return; // 0 або 1 заявка — сортувати нічого
\x20
  var range = sheet.getRange(2, 1, last - 1, TICKET_HEADERS.length);
  var rows = range.getValues();
\x20
  rows.sort(function (a, b) {
    return rowDateKey(b) - rowDateKey(a);
  });
\x20
  range.setValues(rows);
}
\x20
// Сортує масив заявок від найновішої (за датою і часом) до найстарішої
function sortTicketsByDateDesc(list) {
  return (list || []).slice().sort(function (a, b) {
    return ticketDateKey(b) - ticketDateKey(a);
  });
}
\x20
function rowDateKey(row) {
  var d = parseDdMmYyyy(row[1]); // колонка B — дата
  if (!d) return 0;
  return d.getTime() + timeToMs(row[2]); // колонка C — час
}
\x20
function ticketDateKey(t) {
  var d = parseDdMmYyyy(t.date);
  if (!d) return 0;
  return d.getTime() + timeToMs(t.time);
}
\x20
// Одноразова ручна функція — запустіть її один раз з редактора Apps
// Script (кнопка ▶ Запустити, обравши "sortExistingTicketsNow" у списку
// функцій зверху), щоб одразу впорядкувати вже наявні заявки за датою.
// Далі порядок буде підтримуватись автоматично при кожному новому додаванні.
function sortExistingTicketsNow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateSheet(ss, 'Заявки', TICKET_HEADERS);
  sortTicketsSheet(sheet);
}
\x20
\x20
/* ---------- Зміни ---------- */
\x20
function addShiftRow(ss, s) {
  var sheet = getOrCreateSheet(ss, 'Зміни', SHIFT_HEADERS);
  var newDate = parseDdMmYyyy(s.date);
  var last = sheet.getLastRow();
  var insertRow = last + 1; // за замовчуванням — в кінець, якщо дату не розпізнали
  if (newDate && last > 1) {
    var dates = sheet.getRange(2, 2, last - 1, 1).getValues();
    insertRow = last + 1;
    for (var i = 0; i < dates.length; i++) {
      var existing = parseDdMmYyyy(dates[i][0]);
      if (existing && existing > newDate) { insertRow = i + 2; break; }
    }
  }
  if (insertRow <= last) sheet.insertRowBefore(insertRow);
  writeShiftRow(sheet, insertRow, s);
}
\x20
function writeShiftRow(sheet, rowIndex, s) {
  var row = [s.id, s.date, s.hours, s.coworker];
  var range = sheet.getRange(rowIndex, 1, 1, row.length);
  sheet.getRange(rowIndex, 1, 1, 1).setNumberFormat('@'); // id
  sheet.getRange(rowIndex, 2, 1, 1).setNumberFormat('@'); // date
  sheet.getRange(rowIndex, 3, 1, 1).setNumberFormat('0.##'); // hours
  sheet.getRange(rowIndex, 4, 1, 1).setNumberFormat('@'); // coworker
  range.setValues([row]);
}
\x20
// NEW: та сама проблема й те саме рішення, що й у writeAllTickets вище —
// тимчасовий лист + атомарна заміна замість clear()+цикл.
function writeAllShifts(ss, shifts) {
  var list = shifts || [];
  var tempSheet = ss.insertSheet('_Зміни_tmp_' + Date.now());
  try {
    tempSheet.appendRow(SHIFT_HEADERS);
    if (list.length) {
      var rows = list.map(function (s) { return [s.id, s.date, s.hours, s.coworker]; });
      tempSheet.getRange(2, 1, rows.length, 1).setNumberFormat('@'); // id
      tempSheet.getRange(2, 2, rows.length, 1).setNumberFormat('@'); // date
      tempSheet.getRange(2, 3, rows.length, 1).setNumberFormat('0.##'); // hours
      tempSheet.getRange(2, 4, rows.length, 1).setNumberFormat('@'); // coworker
      tempSheet.getRange(2, 1, rows.length, 4).setValues(rows); // ОД�Н запис одразу для всіх рядків
    }
    swapInPlace(ss, tempSheet, 'Зміни');
    getOrCreateSheet(ss, 'Зміни', SHIFT_HEADERS);
  } catch (err) {
    ss.deleteSheet(tempSheet);
    throw err;
  }
}
\x20
\x20
/* ---------- Спільне ---------- */
\x20
function deleteRowById(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 2) return;
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues().flat();
  var idx = ids.findIndex(function (v) { return String(v) === String(id); });
  if (idx > -1) sheet.deleteRow(idx + 2);
}
\x20
function syncAllData(ss, tickets, shifts) {
  writeAllTickets(ss, tickets || []);
  writeAllShifts(ss, shifts || []);
}
\x20
\x20
/* ---------- Утиліти форматування/парсингу ---------- */
\x20
function parseDdMmYyyy(s) {
  // NEW: клітинка може зберігатись і як текст "dd.MM.yyyy", і як справжня
  // дата Google Sheets (Date) — якщо колонку відформатували в текст не
  // одразу, старі значення могли лишитись типом Date. � аніше в такому
  // випадку парсер повертав null, і рядок отримував "вагу" 0 при
  // сортуванні — через це нові заявки завжди вилазили нагору, бо їхня
  // вага (справжня дата) завжди більша за 0.
  if (s instanceof Date) return isNaN(s.getTime()) ? null : s;
  var parts = String(s || '').split('.');
  if (parts.length !== 3) return null;
  var d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
  return isNaN(d.getTime()) ? null : d;
}
\x20
// Переводить "ГГ:ХХ" у мілісекунди для порівняння в межах однієї доби
function timeToMs(t) {
  if (t instanceof Date) return (t.getHours() * 60 + t.getMinutes()) * 60000; // те саме застереження, що й у parseDdMmYyyy
  var m = String(t || '').match(/^(\\d{1,2}):(\\d{2})/);
  if (!m) return 0;
  return (Number(m[1]) * 60 + Number(m[2])) * 60000;
}
\x20
function cellToDateString(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'dd.MM.yyyy');
  return v === null || v === undefined ? '' : String(v).trim();
}
\x20
function cellToTimeString(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'HH:mm');
  return v === null || v === undefined ? '' : String(v).trim();
}
\x20
function safeString(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}
\x20
function safeNumber(v) {
  if (v instanceof Date) return 0;
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}`;
