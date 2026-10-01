/**
 * AISA AI Curriculum – signed-in web app (Google Apps Script).
 *
 * Serves the lesson site to signed-in @aisa.sch.ae users only, records
 * first-try scores and active time, and shows a role-based dashboard.
 * All data lives in one Google Sheet in the school's Shared Drive; nobody
 * but the Shared Drive managers can open it. No data is stored in GitHub.
 */

var DOMAIN = 'aisa.sch.ae';
var MAX_TIME_PER_CALL = 300;           // seconds; the page flushes every ~60 s
var TABS = {
  Roles:     ['email', 'role', 'name', 'notes'],
  Roster:    ['email', 'name', 'role', 'section', 'grade', 'courseId', 'courseName', 'syncedAt'],
  CourseMap: ['courseId', 'courseName', 'section', 'include', 'notes'],
  Lessons:   ['lessonId', 'grade', 'course', 'week', 'title', 'activities', 'maxPoints', 'updatedAt'],
  Scores:    ['timestamp', 'email', 'lessonId', 'activityId', 'activityTitle', 'part', 'firstScore', 'max'],
  Time:      ['timestamp', 'email', 'lessonId', 'seconds'],
  Retries:   ['timestamp', 'email', 'lessonId', 'activityId', 'score', 'max'],
  Judgements:['timestamp', 'student', 'strand', 'tier', 'teacher', 'note']
};
var STRAND_CODES = ['CU', 'SD', 'CE', 'GE'];
/* AI Literacy is delivered through these Classroom courses (see the timetable).
   Only courses matching this are included automatically, so teachers of other
   subjects in the same section never get access to its AI data. */
var AI_COURSE_PATTERN = /arabic|islamic|\bai\b|ai literacy/i;
var TIER_CODES = ['', 'W', 'E', 'P', 'A'];   // '' = clear (use the automatic tier); W = working towards Emerging
var TERM_START = '2026-09-28';           // Monday of curriculum Week 1 (two-week timetable cycle)

/* ===================== entry point ===================== */

function doGet(e) {
  var me = currentUser_();
  if (!me) return page_('<h1>Sign in with your AISA account</h1><p>This site is only available to <b>@' + DOMAIN +
    '</b> Google accounts. Sign out of any personal account and open the link again with your school account.</p>', 'Access denied');
  var p = String((e && e.parameter && e.parameter.p) || 'index');
  if (p === 'dashboard') return dashboardPage_(me);
  if (!/^(index|calendar|grade-(6|7|8|9|10|11|12)\/(main|bridging)-w\d+-[a-z0-9-]+)$/.test(p)) p = 'index';
  var html;
  try { html = HtmlService.createHtmlOutputFromFile('site/' + p).getContent(); }
  catch (err) { html = HtmlService.createHtmlOutputFromFile('site/index').getContent(); p = 'index'; }
  var bridge = HtmlService.createTemplateFromFile('bridge');
  bridge.cfg = JSON.stringify({ email: me.email, name: me.name, role: me.role, page: p, base: ScriptApp.getService().getUrl() });
  html = html.replace(/<head>/i, '<head>' + bridge.evaluate().getContent());
  return HtmlService.createHtmlOutput(html)
    .setTitle(titleOf_(html))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function dashboardPage_(me) {
  var t = HtmlService.createTemplateFromFile('dashboard');
  t.cfg = JSON.stringify({ email: me.email, name: me.name, role: me.role, base: ScriptApp.getService().getUrl() });
  return t.evaluate().setTitle('AI Curriculum Dashboard').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function page_(body, title) {
  return HtmlService.createHtmlOutput('<div style="font-family:system-ui,sans-serif;max-width:560px;margin:60px auto;padding:0 16px">' + body + '</div>').setTitle(title);
}

function titleOf_(html) { var m = /<title>([^<]*)<\/title>/i.exec(html); return m ? m[1] : 'AI Lessons'; }

/* ===================== identity and roles ===================== */

/** Returns {email,name,role} for a signed-in @aisa.sch.ae user, otherwise null. */
function currentUser_() {
  var email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!email || email.slice(-(DOMAIN.length + 1)) !== '@' + DOMAIN) return null;
  var role = 'student', name = '';
  rows_('Roles').forEach(function (r) {
    if (lc_(r.email) === email) { role = r.role === 'owner' ? 'owner' : (r.role === 'slt' ? 'slt' : role); name = r.name || name; }
  });
  if (role === 'student') {
    rows_('Roster').forEach(function (r) {
      if (lc_(r.email) !== email) return;
      if (r.role === 'teacher') role = 'teacher';
      name = name || r.name;
    });
  }
  return { email: email, name: name || email.split('@')[0], role: role };
}

function requireUser_() {
  var me = currentUser_();
  if (!me) throw new Error('Only @' + DOMAIN + ' accounts can use this site.');
  return me;
}

function requireOwner_() {
  var me = requireUser_();
  if (me.role !== 'owner') throw new Error('Only the system owners can do this.');
  return me;
}

/** Sections this user may see: null = everything (owner/SLT); [] = only their own work. */
function visibleSections_(me) {
  if (me.role === 'owner' || me.role === 'slt') return null;
  if (me.role !== 'teacher') return [];
  var s = {};
  rows_('Roster').forEach(function (r) { if (lc_(r.email) === me.email && r.role === 'teacher' && r.section) s[r.section] = 1; });
  return Object.keys(s);
}

/* ===================== called from lesson pages ===================== */

/** Activity ids this student already has a first-try score for in a lesson. */
function getLessonState(lessonId) {
  var me = requireUser_();
  lessonId = cleanId_(lessonId);
  var done = {}, latest = {};
  rows_('Scores').forEach(function (r) { if (lc_(r.email) === me.email && r.lessonId === lessonId) done[r.activityId] = Number(r.firstScore); });
  rows_('Retries').forEach(function (r) { if (lc_(r.email) === me.email && r.lessonId === lessonId) latest[r.activityId] = Number(r.score); });
  return { done: done, latest: latest };
}

/**
 * Records first-try scores. items: [{id,title,part,score,max}]. Only the first
 * score per student/activity is kept, so a retry can never overwrite it.
 */
function recordScores(lessonId, meta, items) {
  var me = requireUser_();
  lessonId = cleanId_(lessonId);
  if (!Array.isArray(items) || !items.length || items.length > 60) return { saved: 0 };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var have = {};
    rows_('Scores').forEach(function (r) { if (lc_(r.email) === me.email && r.lessonId === lessonId) have[r.activityId] = 1; });
    var now = new Date(), out = [];
    items.forEach(function (it) {
      var id = cleanText_(it.id, 40), max = num_(it.max, 0, 200), score = num_(it.score, 0, max);
      if (!id || have[id] || max <= 0) return;
      have[id] = 1;
      out.push([now, me.email, lessonId, id, cleanText_(it.title, 120), cleanText_(it.part, 60), score, max]);
    });
    if (out.length) append_('Scores', out);
    registerLesson_(lessonId, meta);
    return { saved: out.length };
  } finally { lock.releaseLock(); }
}

/** Adds active seconds spent on a lesson page. */
function recordTime(lessonId, seconds) {
  var me = requireUser_();
  var s = Math.round(num_(seconds, 0, MAX_TIME_PER_CALL));
  if (s < 1) return { saved: 0 };
  append_('Time', [[new Date(), me.email, cleanId_(lessonId), s]]);
  return { saved: s };
}

/**
 * Records a student's latest score on activities they have re-checked, so the
 * dashboard can show growth ("answers fixed"). First-try scores are untouched.
 */
function recordLatest(lessonId, items) {
  var me = requireUser_();
  lessonId = cleanId_(lessonId);
  if (!Array.isArray(items) || !items.length || items.length > 60) return { saved: 0 };
  var now = new Date(), out = [];
  items.forEach(function (it) {
    var id = cleanText_(it.id, 40), max = num_(it.max, 0, 200);
    if (id && max > 0) out.push([now, me.email, lessonId, id, num_(it.score, 0, max), max]);
  });
  if (out.length) append_('Retries', out);
  return { saved: out.length };
}

/**
 * A teacher's judgement of a student's tier in one strand (e.g. from the Week 10
 * showcase rubric). It overrides the automatic tier; '' clears it. Only the
 * student's own teachers, SLT and owners may record one.
 */
function setJudgement(studentEmail, strand, tier, note) {
  var me = requireUser_();
  var student = lc_(studentEmail);
  if (STRAND_CODES.indexOf(strand) < 0) throw new Error('Unknown strand.');
  if (TIER_CODES.indexOf(tier) < 0) throw new Error('Unknown tier.');
  if (me.role === 'student') throw new Error('Only teachers can record a judgement.');
  var vis = visibleSections_(me);
  if (vis !== null) {
    var sec = rows_('Roster').filter(function (r) { return lc_(r.email) === student && r.role === 'student'; }).map(function (r) { return r.section; });
    if (!sec.some(function (x) { return vis.indexOf(x) >= 0; })) throw new Error('You can only record judgements for students you teach.');
  }
  append_('Judgements', [[new Date(), student, strand, tier, me.email, cleanText_(note, 200)]]);
  return { saved: true };
}

function registerLesson_(lessonId, meta) {
  meta = meta || {};
  var m = /^grade-(\d+)\/(main|bridging)-w(\d+)/.exec(lessonId) || [];
  var row = [lessonId, Number(m[1]) || '', m[2] || '', Number(m[3]) || '', cleanText_(meta.title, 160),
             num_(meta.activities, 0, 200), num_(meta.maxPoints, 0, 2000), new Date()];
  var sh = sheet_('Lessons'), data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) if (data[i][0] === lessonId) {
    if (data[i][6] !== row[6] || data[i][4] !== row[4]) sh.getRange(i + 1, 1, 1, row.length).setValues([row]);
    return;
  }
  append_('Lessons', [row]);
}

/* ===================== dashboard data ===================== */

/** Role-filtered progress data for the dashboard. */
function getDashboard() {
  var me = requireUser_();
  var vis = visibleSections_(me);
  var roster = rows_('Roster').filter(function (r) { return r.role === 'student'; });
  var students = {};
  roster.forEach(function (r) {
    var e = lc_(r.email);
    if (!students[e]) students[e] = { email: e, name: r.name || e.split('@')[0], section: r.section || 'Unassigned', grade: Number(r.grade) || '' };
  });
  var lessons = {};
  rows_('Lessons').forEach(function (l) { lessons[l.lessonId] = { id: l.lessonId, grade: Number(l.grade), course: l.course, week: Number(l.week), title: l.title, activities: Number(l.activities), maxPoints: Number(l.maxPoints) }; });

  var per = {};   // email|lesson -> {score, done, firstAt, lastAt, seconds, acts:{id:[score,max]}}
  function cell(e, l) { var k = e + '|' + l; return per[k] || (per[k] = { email: e, lessonId: l, score: 0, done: 0, seconds: 0, firstAt: null, lastAt: null, acts: {} }); }
  rows_('Scores').forEach(function (r) {
    var e = lc_(r.email), c = cell(e, r.lessonId);
    if (c.acts[r.activityId]) return;                // keep the earliest first try only
    c.acts[r.activityId] = [Number(r.firstScore), Number(r.max), r.activityTitle, r.part];
    c.score += Number(r.firstScore); c.done += 1;
    var t = new Date(r.timestamp).getTime();
    c.firstAt = c.firstAt === null ? t : Math.min(c.firstAt, t); c.lastAt = Math.max(c.lastAt || 0, t);
  });
  rows_('Time').forEach(function (r) { cell(lc_(r.email), r.lessonId).seconds += Number(r.seconds) || 0; });
  rows_('Retries').forEach(function (r) {           // rows are in time order, so the last one wins
    var a = cell(lc_(r.email), r.lessonId).acts[r.activityId];
    if (a) a[4] = Number(r.score);
  });

  Object.keys(per).forEach(function (k) {             // people who worked but are not on the roster
    var e = per[k].email;
    if (!students[e]) students[e] = { email: e, name: e.split('@')[0], section: 'Unassigned', grade: '' };
  });

  var allowed = function (s) {
    if (vis === null) return true;
    if (!vis.length) return s.email === me.email;
    return vis.indexOf(s.section) >= 0;
  };
  var outStudents = Object.keys(students).map(function (e) { return students[e]; }).filter(allowed);
  var keep = {}; outStudents.forEach(function (s) { keep[s.email] = 1; });
  var results = Object.keys(per).map(function (k) { return per[k]; }).filter(function (c) { return keep[c.email]; });
  return {
    me: me,
    scope: vis === null ? 'school' : (vis.length ? 'sections' : 'self'),
    sections: vis === null ? unique_(outStudents.map(function (s) { return s.section; })) : vis,
    lessons: Object.keys(lessons).map(function (k) { return lessons[k]; }),
    students: outStudents,
    results: results,
    judgements: judgementsFor_(keep),
    framework: typeof FRAMEWORK === 'undefined' ? null : FRAMEWORK,
    canJudge: me.role !== 'student',
    catalog: typeof CATALOG === 'undefined' ? [] : CATALOG,
    termStart: TERM_START,
    generatedAt: new Date().toISOString()
  };
}

function judgementsFor_(keep) {
  var out = {};                                     // rows are in time order, so the latest wins
  rows_('Judgements').forEach(function (r) {
    var e = lc_(r.student); if (!keep[e]) return;
    var k = e + '|' + r.strand;
    if (r.tier === '') delete out[k];
    else out[k] = { tier: r.tier, by: r.teacher, at: new Date(r.timestamp).toISOString(), note: r.note };
  });
  return out;
}

/* ===================== Google Classroom roster sync ===================== */

/**
 * Reads active Classroom courses, guesses the section for each from its name
 * (e.g. "Girls 6 Arabic"), and rebuilds the Roster from the courses marked
 * include = Y in the CourseMap tab. Only Arabic / Islamic Studies (AI Literacy)
 * courses for Grades 6–12 are included automatically. Edit CourseMap to fix any
 * wrong guesses, then run again. Owners only.
 *
 * Google only lists the courses the running account belongs to – unless that
 * account is a Workspace admin with Classroom privileges, which sees every
 * course. Run it as such an account (see README) to read the whole school.
 */
function syncClassroom() {
  if (currentUser_()) requireOwner_();  // from the editor there is no web user; from the web app, owners only
  var map = {}, sh = sheet_('CourseMap');
  rows_('CourseMap').forEach(function (r) { map[String(r.courseId)] = r; });
  var courses = [], token;
  do {
    var res = Classroom.Courses.list({ courseStates: ['ACTIVE'], pageSize: 100, pageToken: token });
    courses = courses.concat(res.courses || []); token = res.nextPageToken;
  } while (token);
  courses.forEach(function (c) {
    if (map[c.id]) return;
    var g = /(boys|girls)\s*(?:grade\s*)?(\d{1,2})\b/i.exec(c.name + ' ' + (c.section || ''));
    var section = g ? cap_(g[1]) + ' ' + g[2] : '';
    var full = c.name + (c.section ? ' · ' + c.section : '');
    var gradeOk = section && Number(g[2]) >= 6 && Number(g[2]) <= 12, aiCourse = AI_COURSE_PATTERN.test(full);
    var row = { courseId: c.id, courseName: full, section: section,
                include: gradeOk && aiCourse ? 'Y' : 'N',
                notes: !section ? 'check: no section found in name' : (!gradeOk ? 'not Grades 6–12' : (aiCourse ? 'auto: AI Literacy course' : 'auto: other subject – excluded')) };
    map[c.id] = row;
    append_('CourseMap', [[row.courseId, row.courseName, row.section, row.include, row.notes]]);
  });
  var out = [], now = new Date();
  Object.keys(map).forEach(function (id) {
    var m = map[id];
    if (String(m.include).toUpperCase() !== 'Y' || !m.section) return;
    var grade = Number((/(\d{1,2})$/.exec(m.section) || [])[1]) || '';
    listAll_(function (t) { return Classroom.Courses.Students.list(id, { pageSize: 100, pageToken: t }); }, 'students')
      .forEach(function (s) { if (s.profile && s.profile.emailAddress) out.push([lc_(s.profile.emailAddress), s.profile.name.fullName, 'student', m.section, grade, id, m.courseName, now]); });
    listAll_(function (t) { return Classroom.Courses.Teachers.list(id, { pageSize: 100, pageToken: t }); }, 'teachers')
      .forEach(function (s) { if (s.profile && s.profile.emailAddress) out.push([lc_(s.profile.emailAddress), s.profile.name.fullName, 'teacher', m.section, grade, id, m.courseName, now]); });
  });
  var rs = sheet_('Roster');
  if (rs.getLastRow() > 1) rs.getRange(2, 1, rs.getLastRow() - 1, TABS.Roster.length).clearContent();
  if (out.length) rs.getRange(2, 1, out.length, TABS.Roster.length).setValues(out.map(function (r) { return r.map(safe_); }));
  return { courses: courses.length, rosterRows: out.length };
}

function listAll_(fn, key) {
  var all = [], t;
  do { var r = fn(t); all = all.concat(r[key] || []); t = r.nextPageToken; } while (t);
  return all;
}

/* ===================== one-time setup ===================== */

/**
 * Run once from the Apps Script editor. Creates the data spreadsheet (move it
 * into the Shared Drive afterwards – its id stays the same), builds the tabs
 * and makes you an owner. Add the second owner and SLT in the Roles tab.
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create('AI Curriculum – Student Data (PROTECTED)');
  props.setProperty('SHEET_ID', ss.getId());
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  var first = ss.getSheetByName('Sheet1'); if (first && ss.getSheets().length > 1) ss.deleteSheet(first);
  var owner = lc_(Session.getEffectiveUser().getEmail());
  if (!rows_('Roles').some(function (r) { return lc_(r.email) === owner; })) append_('Roles', [[owner, 'owner', '', 'added by setup']]);
  return ss.getUrl();
}

/* ===================== sheet helpers ===================== */

function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('Run setup() once from the Apps Script editor first.');
  return SpreadsheetApp.openById(id);
}
function sheet_(name) { return ss_().getSheetByName(name); }
function rows_(name) {
  var sh = sheet_(name); if (!sh) return [];
  var v = sh.getDataRange().getValues(), h = v[0] || TABS[name];
  return v.slice(1).filter(function (r) { return r.join('') !== ''; }).map(function (r) {
    var o = {}; h.forEach(function (k, i) { o[k] = r[i]; }); return o;
  });
}
function append_(name, rows) {
  var sh = sheet_(name);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows.map(function (r) { return r.map(safe_); }));
}

/* ===================== input cleaning ===================== */

function lc_(s) { return String(s || '').trim().toLowerCase(); }
function cap_(s) { s = String(s).toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); }
function unique_(a) { var o = {}; a.forEach(function (x) { o[x] = 1; }); return Object.keys(o).sort(); }
function num_(v, lo, hi) { var n = Number(v); if (!isFinite(n)) return lo; return Math.max(lo, Math.min(hi, n)); }
function cleanText_(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n); }
function cleanId_(v) {
  var s = String(v || '');
  if (!/^grade-(6|7|8|9|10|11|12)\/(main|bridging)-w\d+-[a-z0-9-]+$/.test(s)) throw new Error('Unknown lesson.');
  return s;
}
/** Stops text that starts with = + - @ being treated as a spreadsheet formula. */
function safe_(v) { return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; }

/* exported for the local test harness only */
if (typeof module !== 'undefined') module.exports = { doGet: doGet, getLessonState: getLessonState, recordScores: recordScores, recordTime: recordTime, recordLatest: recordLatest, setJudgement: setJudgement, getDashboard: getDashboard, syncClassroom: syncClassroom, setup: setup, currentUser_: currentUser_ };
