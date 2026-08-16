var SYNC_SECRET = 'ВСТАВТЕ_ВАШ_ПОТОЧНИЙ_СЕКРЕТ_СЮДИ';

var TICKET_HEADERS = ['id','date','time','content','sum','tags','нотатки_майстра','повніДаніJSON'];
var SHIFT_HEADERS  = ['id','date','hours','coworker'];


/* ---------- Входные точки ---------- */

function doPost(e) {
  var data = JSON.parse(e.postData.contents);

  if (!checkSecret(data.secret)) return forbiddenResponse();

  var action = data.action;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var result = {status: 'ok'};

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return jsonResponse({status: 'error', message: 'Busy, try again'});
  }

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

  return jsonResponse(result);
}

function doGet(e) {
  var secret = (e && e.parameter && e.parameter.secret) || '';
  if (!checkSecret(secret)) return forbiddenResponse();

  if (e && e.parameter && e.parameter.action === 'checkTicketExists') {
    var checkSheet = getOrCreateSheet(
      SpreadsheetApp.getActiveSpreadsheet(),
      'Заявки',
      TICKET_HEADERS
    );
    var checkLast = checkSheet.getLastRow();
    var exists = false;

    if (checkLast > 1) {
      var checkIds = checkSheet
        .getRange(2, 1, checkLast - 1, 1)
        .getValues()
        .flat();
      var targetId = String(e.parameter.id);
      exists = checkIds.some(function (v) {
        return String(v) === targetId;
      });
    }

    return jsonResponse({status: 'ok', exists: exists});
  }

  // Read-only verification after a no-cors POST. Returns the actual row by
  // stable id, or ticket:null when it is absent. No data is written here.
  if (e && e.parameter && e.parameter.action === 'getTicketById') {
    var stateSheet = getOrCreateSheet(
      SpreadsheetApp.getActiveSpreadsheet(),
      'Заявки',
      TICKET_HEADERS
    );
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
          tags: row[5]
            ? String(row[5]).split(',').map(function (s) {
                return s.trim();
              }).filter(Boolean)
            : [],
          backupNote: safeString(row[6]),
          fullDataJson: safeString(row[7])
        };
        break;
      }
    }

    return jsonResponse({status: 'ok', ticket: stateTicket});
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var tSheet = ss.getSheetByName('Заявки');
  var sSheet = ss.getSheetByName('Зміни');
  var tickets = [];
  var shifts = [];

  if (tSheet && tSheet.getLastRow() > 1) {
    tSheet
      .getRange(2, 1, tSheet.getLastRow() - 1, 8)
      .getValues()
      .forEach(function (r) {
        if (!r[0] && !r[1]) return;

        tickets.push({
          id: safeString(r[0]),
          date: cellToDateString(r[1], tz),
          time: cellToTimeString(r[2], tz),
          content: r[3] === null || r[3] === undefined ? '' : String(r[3]),
          sum: safeNumber(r[4]),
          tags: r[5]
            ? String(r[5]).split(',').map(function (s) {
                return s.trim();
              }).filter(Boolean)
            : [],
          backupNote: safeString(r[6]),
          fullDataJson: safeString(r[7]),
          photo: null
        });
      });
  }

  if (sSheet && sSheet.getLastRow() > 1) {
    sSheet
      .getRange(2, 1, sSheet.getLastRow() - 1, 4)
      .getValues()
      .forEach(function (r) {
        if (!r[0] && !r[1]) return;

        shifts.push({
          id: safeString(r[0]),
          date: cellToDateString(r[1], tz),
          hours: safeNumber(r[2]),
          coworker: safeString(r[3])
        });
      });
  }

  return jsonResponse({tickets: tickets, shifts: shifts});
}


/* ---------- Авторизация / ответы ---------- */

function checkSecret(value) {
  return String(value || '') === SYNC_SECRET;
}

function forbiddenResponse() {
  return jsonResponse({status: 'error', message: 'forbidden'});
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ---------- Листы и заголовки ---------- */

function getOrCreateSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }

  sheet.getRange(1, 1, 1000, 3).setNumberFormat('@');

  if (name === 'Заявки') {
    sheet.getRange(1, 6, 1000, 3).setNumberFormat('@');
    sheet
      .getRange(1, 4, Math.max(sheet.getMaxRows(), 1000), 1)
      .setWrap(true);
  }

  return sheet;
}


/* ---------- Заявки ---------- */

function addTicketRow(ss, t) {
  var sheet = getOrCreateSheet(ss, 'Заявки', TICKET_HEADERS);
  var last = sheet.getLastRow();

  if (last > 1) {
    var ids = sheet
      .getRange(2, 1, last - 1, 1)
      .getValues()
      .flat();

    if (ids.some(function (v) {
      return String(v) === String(t.id);
    })) {
      return;
    }
  }

  var newKey = ticketDateKey(t);
  var insertRow = last + 1;

  if (last > 1) {
    var dateTimeCols = sheet.getRange(2, 2, last - 1, 2).getValues();

    for (var i = 0; i < dateTimeCols.length; i++) {
      var existingKey = rowDateKey([
        null,
        dateTimeCols[i][0],
        dateTimeCols[i][1]
      ]);

      if (existingKey < newKey) {
        insertRow = i + 2;
        break;
      }
    }
  }

  if (insertRow <= last) sheet.insertRowBefore(insertRow);
  writeTicketRow(sheet, insertRow, t);
}

/*
  Безопасное обновление по стабильному ID.
  Нет опасного промежутка delete → add.
*/
function updateTicketRow(ss, t) {
  var sheet = getOrCreateSheet(ss, 'Заявки', TICKET_HEADERS);
  var last = sheet.getLastRow();

  if (last < 2) {
    addTicketRow(ss, t);
    return;
  }

  var ids = sheet
    .getRange(2, 1, last - 1, 1)
    .getValues()
    .flat();

  var idx = ids.findIndex(function (v) {
    return String(v) === String(t.id);
  });

  /*
    Если строки нет, например прошлое создание не дошло до сервера,
    создаём её безопасно обычным путём.
  */
  if (idx === -1) {
    addTicketRow(ss, t);
    return;
  }

  writeTicketRow(sheet, idx + 2, t);
  sortTicketsSheet(sheet);
}

function writeTicketRow(sheet, rowIndex, t) {
  var row = [
    t.id,
    t.date,
    t.time,
    t.content,
    t.sum,
    (t.tags || []).join(', '),
    t.backupNote || '',
    t.fullDataJson || ''
  ];

  var range = sheet.getRange(rowIndex, 1, 1, row.length);

  sheet.getRange(rowIndex, 1, 1, 1).setNumberFormat('@');
  sheet.getRange(rowIndex, 2, 1, 1).setNumberFormat('@');
  sheet.getRange(rowIndex, 3, 1, 1).setNumberFormat('@');
  sheet.getRange(rowIndex, 5, 1, 1).setNumberFormat('0.##');
  sheet.getRange(rowIndex, 6, 1, 1).setNumberFormat('@');
  sheet.getRange(rowIndex, 7, 1, 1).setNumberFormat('@');
  sheet.getRange(rowIndex, 8, 1, 1).setNumberFormat('@');

  range.setValues([row]);
  sheet.getRange(rowIndex, 4, 1, 1).setWrap(true);
  sheet.setRowHeightsAuto(rowIndex, 1);
}

function writeAllTickets(ss, tickets) {
  var sorted = sortTicketsByDateDesc(tickets);
  var tempSheet = ss.insertSheet('_Заявки_tmp_' + Date.now());

  try {
    tempSheet.appendRow(TICKET_HEADERS);

    if (sorted.length) {
      var rows = sorted.map(function (t) {
        return [
          t.id,
          t.date,
          t.time,
          t.content,
          t.sum,
          (t.tags || []).join(', '),
          t.backupNote || '',
          t.fullDataJson || ''
        ];
      });

      tempSheet.getRange(2, 1, rows.length, 1).setNumberFormat('@');
      tempSheet.getRange(2, 2, rows.length, 1).setNumberFormat('@');
      tempSheet.getRange(2, 3, rows.length, 1).setNumberFormat('@');
      tempSheet.getRange(2, 5, rows.length, 1).setNumberFormat('0.##');
      tempSheet.getRange(2, 6, rows.length, 3).setNumberFormat('@');
      tempSheet.getRange(2, 1, rows.length, 8).setValues(rows);
      tempSheet.getRange(2, 4, rows.length, 1).setWrap(true);
    }

    swapInPlace(ss, tempSheet, 'Заявки');
    getOrCreateSheet(ss, 'Заявки', TICKET_HEADERS);
  } catch (err) {
    ss.deleteSheet(tempSheet);
    throw err;
  }
}

function swapInPlace(ss, newSheet, finalName) {
  var oldSheet = ss.getSheetByName(finalName);

  if (oldSheet) {
    oldSheet.setName('_' + finalName + '_old_' + Date.now());
  }

  newSheet.setName(finalName);

  if (oldSheet) {
    ss.deleteSheet(oldSheet);
  }
}

function sortTicketsSheet(sheet) {
  var last = sheet.getLastRow();
  if (last <= 2) return;

  var range = sheet.getRange(
    2,
    1,
    last - 1,
    TICKET_HEADERS.length
  );

  var rows = range.getValues();

  rows.sort(function (a, b) {
    return rowDateKey(b) - rowDateKey(a);
  });

  range.setValues(rows);
}

function sortTicketsByDateDesc(list) {
  return (list || []).slice().sort(function (a, b) {
    return ticketDateKey(b) - ticketDateKey(a);
  });
}

function rowDateKey(row) {
  var d = parseDdMmYyyy(row[1]);
  if (!d) return 0;
  return d.getTime() + timeToMs(row[2]);
}

function ticketDateKey(t) {
  var d = parseDdMmYyyy(t.date);
  if (!d) return 0;
  return d.getTime() + timeToMs(t.time);
}

function sortExistingTicketsNow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateSheet(ss, 'Заявки', TICKET_HEADERS);
  sortTicketsSheet(sheet);
}


/* ---------- Смены ---------- */

function addShiftRow(ss, s) {
  var sheet = getOrCreateSheet(ss, 'Зміни', SHIFT_HEADERS);
  var newDate = parseDdMmYyyy(s.date);
  var last = sheet.getLastRow();
  var insertRow = last + 1;

  if (newDate && last > 1) {
    var dates = sheet.getRange(2, 2, last - 1, 1).getValues();

    for (var i = 0; i < dates.length; i++) {
      var existing = parseDdMmYyyy(dates[i][0]);

      if (existing && existing > newDate) {
        insertRow = i + 2;
        break;
      }
    }
  }

  if (insertRow <= last) sheet.insertRowBefore(insertRow);
  writeShiftRow(sheet, insertRow, s);
}

function writeShiftRow(sheet, rowIndex, s) {
  var row = [s.id, s.date, s.hours, s.coworker];
  var range = sheet.getRange(rowIndex, 1, 1, row.length);

  sheet.getRange(rowIndex, 1, 1, 1).setNumberFormat('@');
  sheet.getRange(rowIndex, 2, 1, 1).setNumberFormat('@');
  sheet.getRange(rowIndex, 3, 1, 1).setNumberFormat('0.##');
  sheet.getRange(rowIndex, 4, 1, 1).setNumberFormat('@');

  range.setValues([row]);
}

function writeAllShifts(ss, shifts) {
  var list = shifts || [];
  var tempSheet = ss.insertSheet('_Зміни_tmp_' + Date.now());

  try {
    tempSheet.appendRow(SHIFT_HEADERS);

    if (list.length) {
      var rows = list.map(function (s) {
        return [s.id, s.date, s.hours, s.coworker];
      });

      tempSheet.getRange(2, 1, rows.length, 1).setNumberFormat('@');
      tempSheet.getRange(2, 2, rows.length, 1).setNumberFormat('@');
      tempSheet.getRange(2, 3, rows.length, 1).setNumberFormat('0.##');
      tempSheet.getRange(2, 4, rows.length, 1).setNumberFormat('@');
      tempSheet.getRange(2, 1, rows.length, 4).setValues(rows);
    }

    swapInPlace(ss, tempSheet, 'Зміни');
    getOrCreateSheet(ss, 'Зміни', SHIFT_HEADERS);
  } catch (err) {
    ss.deleteSheet(tempSheet);
    throw err;
  }
}


/* ---------- Общие функции ---------- */

function deleteRowById(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 2) return;

  var ids = sheet
    .getRange(2, 1, last - 1, 1)
    .getValues()
    .flat();

  var idx = ids.findIndex(function (v) {
    return String(v) === String(id);
  });

  if (idx > -1) {
    sheet.deleteRow(idx + 2);
  }
}

function syncAllData(ss, tickets, shifts) {
  writeAllTickets(ss, tickets || []);
  writeAllShifts(ss, shifts || []);
}


/* ---------- Форматирование ---------- */

function parseDdMmYyyy(s) {
  if (s instanceof Date) {
    return isNaN(s.getTime()) ? null : s;
  }

  var parts = String(s || '').split('.');
  if (parts.length !== 3) return null;

  var d = new Date(
    Number(parts[2]),
    Number(parts[1]) - 1,
    Number(parts[0])
  );

  return isNaN(d.getTime()) ? null : d;
}

function timeToMs(t) {
  if (t instanceof Date) {
    return (t.getHours() * 60 + t.getMinutes()) * 60000;
  }

  var m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;

  return (Number(m[1]) * 60 + Number(m[2])) * 60000;
}

function cellToDateString(v, tz) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, tz, 'dd.MM.yyyy');
  }

  return v === null || v === undefined ? '' : String(v).trim();
}

function cellToTimeString(v, tz) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, tz, 'HH:mm');
  }

  return v === null || v === undefined ? '' : String(v).trim();
}

function safeString(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

function safeNumber(v) {
  if (v instanceof Date) return 0;

  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

