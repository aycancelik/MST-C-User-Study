/**
 * MST-C pilot data receiver -- Google Apps Script web app.
 *
 * Receives the POST requests mstc_pilot_ui's app.js sends when CFG.upload.url
 * is set (see upload() in app.js): one POST per file, body =
 *   { participant_id, filename, data }
 * Each participant produces 3 calls: <base>.json, <base>_trials.csv,
 * <base>_participant.csv -- saves each as a file in a Drive folder.
 *
 * Setup:
 *   1. script.google.com/home -> New project, paste this file in as Code.gs.
 *   2. Deploy -> New deployment -> type "Web app".
 *        Execute as: Me
 *        Who has access: Anyone  (must allow anonymous -- participants' browsers
 *          are not signed into this Google account, so "Anyone with Google
 *          account" will reject the request)
 *   3. Copy the resulting /exec URL into config.js's upload.url.
 *   4. A "MSTC Pilot Data" folder appears in your Drive the first time a
 *      submission comes in; files are named <participant_id>__<filename>.
 */

var FOLDER_NAME = "MSTC Pilot Data";

function getOrCreateFolder_() {
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var pid = String(body.participant_id || "unknown").replace(/[^\w-]/g, "_");
    var filename = String(body.filename || "upload.txt");
    var data = body.data == null ? "" : String(body.data);

    var mime = filename.endsWith(".json") ? "application/json"
      : filename.endsWith(".csv") ? "text/csv" : "text/plain";

    getOrCreateFolder_().createFile(Utilities.newBlob(data, mime, pid + "__" + filename));

    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    // Still return 200 with ok:false -- app.js only throws on a non-2xx HTTP
    // status, so an unhandled exception here (which Apps Script turns into an
    // HTML error page) would look like a network failure instead of a clear
    // "something was wrong with this submission" signal.
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService.createTextOutput("MST-C pilot data receiver is running. POST only.");
}
