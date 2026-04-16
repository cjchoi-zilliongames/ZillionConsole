function shouldExclude(name) {
  if (!name || typeof name !== "string") return true;
  if (name.startsWith("NOEX_")) return true;
  if (/[가-힣]/.test(name)) return true;
  return false;
}

function doGet() {
  return ContentService.createTextOutput("질리언 콘솔 Sheets API — POST 전용")
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;

    if (action === "list-spreadsheets") {
      var files = DriveApp.getFilesByType(MimeType.GOOGLE_SHEETS);
      var result = [];
      while (files.hasNext() && result.length < 100) {
        var file = files.next();
        result.push({
          id: file.getId(),
          name: file.getName(),
          url: file.getUrl(),
          modifiedTime: file.getLastUpdated().toISOString(),
        });
      }
      result.sort(function (a, b) { return b.modifiedTime.localeCompare(a.modifiedTime); });
      return ok({ files: result });
    }

    if (action === "list-sheets") {
      var ss = SpreadsheetApp.openById(body.spreadsheetId);
      var tabs = ss.getSheets()
        .filter(function (s) { return !shouldExclude(s.getName()); })
        .map(function (s) { return { sheetId: s.getSheetId(), title: s.getName() }; });
      return ok({ title: ss.getName(), sheets: tabs });
    }

    if (action === "export") {
      var ss = SpreadsheetApp.openById(body.spreadsheetId);
      var sheetNames = body.sheetNames;
      var csvFiles = [];

      for (var i = 0; i < sheetNames.length; i++) {
        var sheet = ss.getSheetByName(sheetNames[i]);
        if (!sheet) continue;
        var data = sheet.getDataRange().getValues();
        if (data.length === 0) continue;

        var headers = data[0];
        var includeCols = [];
        for (var c = 0; c < headers.length; c++) {
          if (!shouldExclude(String(headers[c]))) includeCols.push(c);
        }

        var csv = data.map(function (row) {
          return includeCols.map(function (ci) {
            var s = String(row[ci]);
            if (s.indexOf(",") !== -1 || s.indexOf('"') !== -1 || s.indexOf("\n") !== -1) {
              return '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
          }).join(",");
        }).join("\n");

        csvFiles.push({ name: sheetNames[i] + ".csv", content: csv });
      }

      return ok({ csvFiles: csvFiles });
    }

    return err("unknown action");
  } catch (ex) {
    return err(ex.message || String(ex));
  }
}

function ok(data) {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function err(msg) {
  return ContentService.createTextOutput(JSON.stringify({ ok: false, error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}
