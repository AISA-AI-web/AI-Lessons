/* Minimal in-memory stand-ins for the Google services Code.js uses, so the
   server logic can be tested locally. Not deployed. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const BUILD = path.join(__dirname, '..', 'build');

function makeEnv() {
  const sheets = {}, props = {};
  let activeEmail = '';
  const sheetObj = name => {
    const rows = sheets[name] || (sheets[name] = []);
    return {
      getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
      getLastRow: () => rows.length,
      getRange: (r, c, nr, nc) => ({
        setValues: v => { v.forEach((row, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; row.forEach((x, j) => rows[r - 1 + i][c - 1 + j] = x); }); return { setFontWeight() {} }; },
        clearContent: () => { for (let i = 0; i < nr; i++) rows[r - 1 + i] = new Array(nc).fill(''); }
      }),
      setFrozenRows() {}
    };
  };
  const ss = { getId: () => 'SHEET1', getUrl: () => 'https://docs.google.com/x', getSheetByName: n => sheets[n] ? sheetObj(n) : null,
    insertSheet: n => { sheets[n] = []; return sheetObj(n); }, getSheets: () => Object.keys(sheets), deleteSheet() {} };
  const ctx = {
    console, Date, JSON, Math, Number, String, Array, Object, RegExp, Error, isFinite,
    Session: { getActiveUser: () => ({ getEmail: () => activeEmail }), getEffectiveUser: () => ({ getEmail: () => 'bbaki@aisa.sch.ae' }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    SpreadsheetApp: { create: () => ss, openById: () => ss },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/a/macros/aisa.sch.ae/s/APP/exec' }) },
    HtmlService: {
      createHtmlOutputFromFile: n => { const f = path.join(BUILD, n + '.html'); if (!fs.existsSync(f)) throw new Error('no file ' + n); const c = fs.readFileSync(f, 'utf8'); return { getContent: () => c }; },
      createTemplateFromFile: n => { const t = { evaluate: () => { const c = fs.readFileSync(path.join(BUILD, n + '.html'), 'utf8').replace('<?!= cfg ?>', t.cfg); const o = { getContent: () => c, setTitle: () => o, addMetaTag: () => o }; return o; } }; return t; },
      createHtmlOutput: c => { const o = { content: c, setTitle: t => { o.title = t; return o; }, addMetaTag: () => o, getContent: () => c }; return o; }
    },
    Classroom: null
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(BUILD, 'Catalog.js'), 'utf8').replace('var CATALOG', 'CATALOG'), ctx);
  vm.runInContext(fs.readFileSync(path.join(BUILD, 'Framework.js'), 'utf8').replace('var FRAMEWORK', 'FRAMEWORK'), ctx);
  vm.runInContext(fs.readFileSync(path.join(BUILD, 'SchoolCalendar.js'), 'utf8').replace('var AICAL', 'AICAL'), ctx);
  vm.runInContext(fs.readFileSync(path.join(BUILD, 'Code.js'), 'utf8'), ctx);
  return { ctx, sheets, as: e => { activeEmail = e; }, call: (fn, ...a) => ctx[fn](...a) };
}
module.exports = { makeEnv };
