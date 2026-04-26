/**
 * Google Apps Script — Web App يردّي JSON للجدول الأول في المستند
 * يدعم ?callback=اسم للطلبات JSONP (تتجاوز قيود CORS في المتصفح).
 *
 * إن كان فتح رابط /exec يظهر نصاً مثل «Hello from API» بدل JSON:
 *   احذف أي doGet تجريبي من المشروع، وانسخ هذا الملف كاملاً إلى المحرر،
 *   ثم Deploy → إصدار جديد → نشر.
 *
 * الإعداد: Execute as: **Me** | Who has access: **Anyone**
 */
var SPREADSHEET_ID = "1Oj8-nSyDUPvBJmezqh9YBoOJE1_7HVy8FP0R897JN30";

/**
 * @param {any[]} row
 * @returns {boolean}
 */
function isRowEmpty_(row) {
  for (var i = 0; i < row.length; i++) {
    if (String(row[i]).trim() !== "") {
      return false;
    }
  }
  return true;
}

/**
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getSpreadsheet_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

/**
 * @param {Object} e
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function doGet(e) {
  e = e || { parameter: {} };
  var callback = e.parameter.callback;

  var payload;
  try {
    var sheet = getSpreadsheet_().getSheets()[0];
    var values = sheet.getDataRange().getDisplayValues();
    if (!values || values.length === 0) {
      payload = { success: true, headers: [], rows: [] };
    } else {
      var headers = values[0].map(function (h) {
        return String(h).trim();
      });
      var rows = [];
      for (var r = 1; r < values.length; r++) {
        if (!isRowEmpty_(values[r])) {
          rows.push(values[r]);
        }
      }
      payload = { success: true, headers: headers, rows: rows };
    }
  } catch (err) {
    payload = {
      success: false,
      error: err && err.message ? String(err.message) : String(err),
    };
  }
  return respond_(payload, callback);
}

/**
 * @param {Object} obj
 * @param {string|undefined} callback
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function respond_(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(String(callback))) {
    return ContentService.createTextOutput(
      String(callback) + "(" + json + ");"
    ).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(
    ContentService.MimeType.JSON
  );
}
