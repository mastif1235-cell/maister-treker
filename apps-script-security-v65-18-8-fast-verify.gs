/* Майстер-Трекер — security.18.8 true read-only verification

   ДІАГНОЗ:
   старі checkTicketExists/getTicketById викликали getOrCreateSheet().
   getOrCreateSheet() на КОЖНОМУ GET робить setNumberFormat()/setWrap() для
   сотень/тисяч комірок. Тобто "read-only verify" насправді був WRITE у
   Spreadsheet. Через це після no-cors POST перевірка могла чекати/конкурувати
   з попереднім записом і клієнт довго показував заявку несинхронізованою.

   ВСТАВИТИ ЦЕЙ БЛОК У САМИЙ КІНЕЦЬ поточного Code.gs ПІСЛЯ security.18.7,
   Ctrl+S -> Deploy -> Manage deployments -> Edit -> New version -> Deploy.

   Передумова: security.18 HMAC wrapper уже встановлений. Патч перевизначає
   doGet(), але НЕ послаблює HMAC: спочатку викликає secureAuthVerifyGet_.
   Для list лишає стару legacy-логіку. Для двох verify action читає існуючий
   лист напряму й НІЧОГО в таблиці не форматує та не записує.
*/

function security188TicketSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Заявки');
}

function security188CheckTicketExists_(id) {
  var sheet = security188TicketSheet_();
  if (!sheet) return jsonResponse({status:'ok', exists:false});

  var last = sheet.getLastRow();
  if (last <= 1) return jsonResponse({status:'ok', exists:false});

  var target = String(id == null ? '' : id);
  var ids = sheet.getRange(2, 1, last - 1, 1).getDisplayValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === target) {
      return jsonResponse({status:'ok', exists:true});
    }
  }
  return jsonResponse({status:'ok', exists:false});
}

function security188GetTicketById_(id) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Заявки');
  if (!sheet) return jsonResponse({status:'ok', ticket:null});

  var last = sheet.getLastRow();
  if (last <= 1) return jsonResponse({status:'ok', ticket:null});

  var target = String(id == null ? '' : id);
  var ids = sheet.getRange(2, 1, last - 1, 1).getDisplayValues();
  var rowIndex = -1;
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === target) { rowIndex = i + 2; break; }
  }
  if (rowIndex < 0) return jsonResponse({status:'ok', ticket:null});

  // Читаємо тільки один знайдений рядок. Жодного setNumberFormat/setWrap.
  var row = sheet.getRange(rowIndex, 1, 1, 8).getValues()[0];
  var tz = ss.getSpreadsheetTimeZone();
  var ticket = {
    id: safeString(row[0]),
    date: cellToDateString(row[1], tz),
    time: cellToTimeString(row[2], tz),
    content: row[3] == null ? '' : String(row[3]),
    sum: safeNumber(row[4]),
    tags: row[5] ? String(row[5]).split(',').map(function(s){ return s.trim(); }).filter(Boolean) : [],
    backupNote: safeString(row[6]),
    fullDataJson: safeString(row[7])
  };
  return jsonResponse({status:'ok', ticket:ticket});
}

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};

    // Strict HMAC path: legacy ?secret= тут НЕ приймається.
    if (!secureAuthVerifyGet_(p)) {
      return jsonResponse({status:'error', message:'forbidden'});
    }

    var action = String(p.action || 'list');
    if (action === 'checkTicketExists') {
      return security188CheckTicketExists_(p.id);
    }
    if (action === 'getTicketById') {
      return security188GetTicketById_(p.id);
    }

    // Повний list поки залишаємо перевіреній legacy-функції.
    var cloned = {};
    Object.keys(p).forEach(function(k){ cloned[k] = p[k]; });
    cloned.secret = SYNC_SECRET;
    return legacyDoGetV65({parameter:cloned});
  } catch (err) {
    return jsonResponse({status:'error', message:'forbidden'});
  }
}
