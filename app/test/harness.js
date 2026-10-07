/* Minimal in-memory stand-ins for the Google services Code.js uses, so the
   server logic can be tested locally. Not deployed. */
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib'), crypto = require('crypto');
const toBuf = d => Buffer.isBuffer(d) ? d : Array.isArray(d) ? Buffer.from(d.map(x => x & 255)) : Buffer.from(String(d), 'utf8');
const blob = d => { const b = toBuf(d); return { _b: b, getBytes: () => [...b].map(x => x > 127 ? x - 256 : x), getDataAsString: () => b.toString('utf8') }; };
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
    Classroom: null,
    MailApp: { sent: [], sendEmail(o) { this.sent.push(o); } },
    Utilities: { formatDate: (d) => d.toDateString(), newBlob: d => blob(d), gzip: b => blob(zlib.gzipSync(b._b)), ungzip: b => blob(zlib.gunzipSync(b._b)),
      base64Encode: x => toBuf(x).toString('base64'), base64EncodeWebSafe: x => toBuf(x).toString('base64url'), base64Decode: s => [...Buffer.from(s, 'base64')].map(x => x > 127 ? x - 256 : x),
      computeDigest: (a, s) => [...crypto.createHash('sha256').update(String(s)).digest()].map(x => x > 127 ? x - 256 : x), DigestAlgorithm: { SHA_256: 'sha256' } },
    CacheService: { getScriptCache: () => ({ get: k => ctx.__cache[k] || null, put: (k, v) => { ctx.__cache[k] = v; },
      getAll: ks => { const o = {}; ks.forEach(k => { if (k in ctx.__cache) o[k] = ctx.__cache[k]; }); return o; }, putAll: o => { Object.assign(ctx.__cache, o); } }) },
    __cache: {}
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(BUILD, 'Catalog.js'), 'utf8').replace('var CATALOG', 'CATALOG'), ctx);
  vm.runInContext(fs.readFileSync(path.join(BUILD, 'Framework.js'), 'utf8').replace('var FRAMEWORK', 'FRAMEWORK'), ctx);
  vm.runInContext(fs.readFileSync(path.join(BUILD, 'SchoolCalendar.js'), 'utf8').replace('var AICAL', 'AICAL'), ctx);
  vm.runInContext(fs.readFileSync(path.join(BUILD, 'Code.js'), 'utf8'), ctx);
  /* Tests edit the sheets directly, as a person editing the spreadsheet by hand would – which the app's data
     version cannot see – so cached results are dropped before each call unless a test checks the cache itself. */
  const env = { ctx, sheets, realCache: false, as: e => { activeEmail = e; },
    call: (fn, ...a) => { if (!env.realCache) Object.keys(ctx.__cache).forEach(k => { if (/^(r:|dv$)/.test(k)) delete ctx.__cache[k]; }); return ctx[fn](...a); } };
  return env;
}
module.exports = { makeEnv };
