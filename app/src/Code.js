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
  Judgements:['timestamp', 'student', 'strand', 'tier', 'teacher', 'note'],
  Changes:   ['timestamp', 'type', 'student', 'name', 'fromSection', 'toSection', 'by', 'status', 'decidedBy', 'decidedAt', 'note'],
  Confirmations: ['timestamp', 'section', 'teacher', 'students', 'note']
};
/* Every AI Literacy section, e.g. Boys 6 … Girls 12. */
var SECTIONS = (function () { var a = []; for (var g = 6; g <= 12; g++) a.push('Boys ' + g, 'Girls ' + g); return a; })();
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
  // Staff land on today's teaching calendar; students on the grade selector.
  var p = String((e && e.parameter && e.parameter.p) || (me.role === 'student' ? 'index' : 'calendar'));
  if (p === 'dashboard') return dashboardPage_(me);
  if (!/^(index|calendar|grade-(6|7|8|9|10|11|12)\/(main|bridging)-w\d+-[a-z0-9-]+)$/.test(p)) p = 'index';
  // Students only get Main course lessons their class has reached (see releasedWeeks_).
  var rel = me.role === 'student' ? releasedWeeks_(me.email) : null, lm = /^grade-(\d+)\/main-w(\d+)-/.exec(p);
  if (rel && lm && +lm[2] > rel[lm[1]]) return lockedPage_(+lm[1], +lm[2], me.email);
  var html;
  try { html = HtmlService.createHtmlOutputFromFile('site/' + p).getContent(); }
  catch (err) { html = HtmlService.createHtmlOutputFromFile('site/index').getContent(); p = 'index'; }
  var bridge = HtmlService.createTemplateFromFile('bridge');
  bridge.cfg = JSON.stringify({ email: me.email, name: me.name, role: me.role, page: p, base: ScriptApp.getService().getUrl(),
    sections: me.role === 'teacher' ? visibleSections_(me) : [], locked: rel ? lockedLinks_(rel, me.email) : {} });
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

/* ===================== which lessons a student may open ===================== */
/* A student may open every Main course lesson their section has been taught, plus this
   week's lesson from the Monday of its teaching week (AICAL.releasedFor, school-calendar.js).
   Staff see every lesson. Bridging lessons are not on the timetable, so they stay open. */

/** {grade: highest open week} for grades 6–12. Their own grade follows their section;
    other grades (and students not yet on a class list) follow the school timetable. */
function releasedWeeks_(email) {
  var now = new Date(), out = {}, secs = studentRows_(email).map(function (r) { return String(r.section || ''); });
  for (var g = 6; g <= 12; g++) {
    var mine = secs.filter(function (s) { return gradeOf_(s) === g; });
    out[g] = mine.length ? Math.max.apply(null, mine.map(function (s) { return AICAL.releasedFor(s, now); })) : AICAL.releasedForGrade(g, now);
  }
  return out;
}
function opensFor_(grade, week, email) {
  var secs = studentRows_(email).map(function (r) { return String(r.section || ''); }).filter(function (s) { return gradeOf_(s) === grade; });
  var ds = secs.map(function (s) { return AICAL.opensOn(s, week); }).filter(Boolean);
  var d = ds.length ? new Date(Math.min.apply(null, ds)) : AICAL.opensOnGrade(grade, week);
  return d ? ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()] + ' ' + d.getDate() + ' ' +
    ['January','February','March','April','May','June','July','August','September','October','November','December'][d.getMonth()] + ' ' + d.getFullYear() : '';
}
/** Links a student's pages should show as locked: {"grade-8/main-w5-l1": "Monday 2 November 2026"}. */
function lockedLinks_(rel, email) {
  var out = {};
  CATALOG.forEach(function (c) { if (c.course === 'main' && c.week > rel[c.grade]) out[c.id] = opensFor_(c.grade, c.week, email); });
  return out;
}
function lockedPage_(grade, week, email) {
  var when = opensFor_(grade, week, email), home = ScriptApp.getService().getUrl();
  return page_('<h1>🔒 Not open yet</h1><p>Grade ' + grade + ' Main course <b>Week ' + week + '</b> opens for your class' +
    (when ? ' on <b>' + when + '</b>' : ' when your class reaches it') + '.</p>' +
    '<p dir="rtl" lang="ar">🔒 هذا الدرس غير متاح بعد. سيُفتح لصفّك عندما يصل إليه.</p>' +
    '<p><a href="' + home + '?p=dashboard" target="_top">My progress</a> · <a href="' + home + '" target="_top">All lessons</a></p>', 'Not open yet');
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

/* ===================== class lists: transfer, add, request, confirm ===================== */
/* Teachers keep their own class lists right. Every change is logged in the Changes tab
   (who, when, from, to). Teachers can only act on their own sections; owners and SLT on any.
   importRoster re-applies these changes, so a fresh export from IT does not undo them. */

function canManage_(me, section) { var vis = visibleSections_(me); return me.role !== 'student' && (vis === null || vis.indexOf(section) >= 0); }
function checkSection_(s) { if (SECTIONS.indexOf(s) < 0) throw new Error('Unknown class: ' + cleanText_(s, 30)); return s; }
function gradeOf_(section) { return Number((/(\d+)$/.exec(section) || [])[1]) || ''; }
function checkEmail_(e) {
  e = lc_(e);
  if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+$/.test(e) || e.slice(-(DOMAIN.length + 1)) !== '@' + DOMAIN) throw new Error('Use the student\'s @' + DOMAIN + ' email address.');
  return e;
}
function studentRows_(email) { return rows_('Roster').filter(function (r) { return r.role === 'student' && lc_(r.email) === email; }); }
function logChange_(type, email, name, from, to, by, status, note) {
  append_('Changes', [[new Date(), type, email, cleanText_(name, 80), from || '', to || '', by, status, '', '', cleanText_(note, 200)]]);
  return sheet_('Changes').getLastRow();
}
/** Moves every Roster row of a student to another section (adds a row if they had none). */
function moveStudent_(email, to, name) {
  var sh = sheet_('Roster'), v = sh.getDataRange().getValues(), h = v[0] || TABS.Roster, moved = 0;
  var ie = h.indexOf('email'), ir = h.indexOf('role'), is = h.indexOf('section'), ig = h.indexOf('grade');
  for (var i = 1; i < v.length; i++) if (lc_(v[i][ie]) === email && v[i][ir] === 'student') {
    v[i][is] = to; v[i][ig] = gradeOf_(to); moved++;
    sh.getRange(i + 1, 1, 1, v[i].length).setValues([v[i].map(safe_)]);
  }
  if (!moved) append_('Roster', [[email, cleanText_(name, 80) || email.split('@')[0], 'student', to, gradeOf_(to), '', 'Added from the dashboard', new Date()]]);
}
function withLock_(fn) { var l = LockService.getScriptLock(); l.waitLock(20000); try { return fn(); } finally { l.releaseLock(); } }

/** Moves a student from one of your classes to the class they should be in. */
function transferStudent(studentEmail, toSection, note) {
  var me = requireUser_(), email = checkEmail_(studentEmail); checkSection_(toSection);
  return withLock_(function () {
    var rows = studentRows_(email);
    if (!rows.length) throw new Error('That student is not on the class lists.');
    var from = rows[0].section;
    if (!canManage_(me, from)) throw new Error('You can only move students out of your own classes.');
    if (from === toSection) throw new Error('The student is already in ' + toSection + '.');
    moveStudent_(email, toSection);
    logChange_('transfer', email, rows[0].name, from, toSection, me.email, 'done', note);
    return { moved: true, from: from, to: toSection };
  });
}

/** Adds a missing student to one of your classes. If they are already in another class,
    it becomes a request for that class's teacher (or an owner / SLT) to approve. */
function addStudent(studentEmail, name, section, note) {
  var me = requireUser_(), email = checkEmail_(studentEmail); checkSection_(section);
  if (!canManage_(me, section)) throw new Error('You can only add students to your own classes.');
  return withLock_(function () {
    var rows = studentRows_(email);
    if (rows.length && rows[0].section === section) throw new Error('That student is already in ' + section + '.');
    if (rows.length) {
      var open = rows_('Changes').some(function (c) { return c.type === 'join' && c.status === 'pending' && lc_(c.student) === email && c.toSection === section; });
      if (open) throw new Error('There is already a request for this student to join ' + section + '.');
      logChange_('join', email, rows[0].name, rows[0].section, section, me.email, 'pending', note);
      return { requested: true, from: rows[0].section, to: section };
    }
    var nm = cleanText_(name, 80);
    if (nm.length < 2) throw new Error('Type the student\'s name.');
    append_('Roster', [[email, nm, 'student', section, gradeOf_(section), '', 'Added by ' + me.email, new Date()]]);
    logChange_('add', email, nm, '', section, me.email, 'done', note);
    return { added: true, to: section };
  });
}

/** Approves or declines a request for a student to join another class. The student's
    current teacher, an owner or SLT can decide. */
function decideRequest(id, approve, note) {
  var me = requireUser_(), row = Number(id);
  return withLock_(function () {
    var sh = sheet_('Changes'), v = sh.getDataRange().getValues(), h = v[0];
    if (!(row >= 2 && row <= v.length)) throw new Error('Request not found.');
    var r = {}; h.forEach(function (k, i) { r[k] = v[row - 1][i]; });
    if (r.type !== 'join' || r.status !== 'pending') throw new Error('This request has already been decided.');
    var email = lc_(r.student), cur = (studentRows_(email)[0] || {}).section || r.fromSection;
    if (me.role !== 'owner' && me.role !== 'slt' && !canManage_(me, cur)) throw new Error('Only ' + cur + '\'s teacher, an owner or SLT can decide this request.');
    if (approve) moveStudent_(email, r.toSection, r.name);
    r.status = approve ? 'approved' : 'declined'; r.decidedBy = me.email; r.decidedAt = new Date();
    if (note) r.note = cleanText_((r.note ? r.note + ' · ' : '') + note, 200);
    sh.getRange(row, 1, 1, h.length).setValues([h.map(function (k) { return safe_(r[k]); })]);
    return { decided: r.status };
  });
}

/** Records that a teacher has checked a class list and it is correct. */
function confirmRoster(section, note) {
  var me = requireUser_(); checkSection_(section);
  if (!canManage_(me, section)) throw new Error('You can only confirm your own classes.');
  var n = rows_('Roster').filter(function (r) { return r.role === 'student' && r.section === section; })
    .reduce(function (o, r) { o[lc_(r.email)] = 1; return o; }, {});
  append_('Confirmations', [[new Date(), section, me.email, Object.keys(n).length, cleanText_(note, 200)]]);
  return { confirmed: true, students: Object.keys(n).length };
}

/** Class-list information for the dashboard: requests, recent changes and confirmations. */
function rosterInfo_(me, vis) {
  if (me.role === 'student') return null;
  var all = vis === null, mine = function (s) { return all || vis.indexOf(s) >= 0; };
  var current = {}; rows_('Roster').forEach(function (r) { if (r.role === 'student' && !current[lc_(r.email)]) current[lc_(r.email)] = r.section; });
  var ch = sheet_('Changes').getDataRange().getValues(), h = ch[0], requests = [], recent = [], lastChange = {};
  ch.slice(1).forEach(function (row, i) {
    var c = {}; h.forEach(function (k, j) { c[k] = row[j]; });
    if (!c.type) return;
    var t = new Date(c.timestamp).getTime(), email = lc_(c.student), from = current[email] || c.fromSection;
    if (c.status === 'pending') {
      if (mine(c.toSection) || mine(from) || me.role === 'slt')
        requests.push({ id: i + 2, student: email, name: c.name, from: from, to: c.toSection, by: c.by, at: new Date(c.timestamp).toISOString(), note: c.note,
                        canDecide: me.role === 'owner' || me.role === 'slt' || canManage_(me, from) });
      return;
    }
    if (c.status === 'done' || c.status === 'approved') {
      [c.fromSection, c.toSection].forEach(function (s) { if (s) lastChange[s] = Math.max(lastChange[s] || 0, t); });
      if (mine(c.fromSection) || mine(c.toSection))
        recent.push({ type: c.type, student: email, name: c.name, from: c.fromSection, to: c.toSection, by: c.by, at: new Date(c.timestamp).toISOString(), status: c.status });
    }
  });
  var conf = {};
  rows_('Confirmations').forEach(function (c) { if (mine(c.section)) conf[c.section] = { by: c.teacher, at: new Date(c.timestamp).toISOString(), students: c.students }; });
  Object.keys(conf).forEach(function (s) { conf[s].changedSince = (lastChange[s] || 0) > new Date(conf[s].at).getTime(); });
  var lead = me.role === 'owner' || me.role === 'slt';   // they also get the full log, to send to IT
  return { sections: SECTIONS, mySections: all ? SECTIONS : vis, requests: requests, recent: (lead ? recent : recent.slice(-30)).reverse(), confirmations: conf, canExport: lead };
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
    roster: rosterInfo_(me, vis),
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
 * Roster rows with a blank courseId (added by hand) or 'sis' (from importRoster) are kept.
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
  // Rows with no courseId were added by hand (e.g. teachers from the AI timetable), and rows marked
  // 'sis' came from importRoster – keep both.
  var manual = rows_('Roster').filter(function (r) { var c = String(r.courseId || '').trim(); return !c || c === SIS_ID; })
    .map(function (r) { return TABS.Roster.map(function (k) { return r[k] === undefined ? '' : r[k]; }); });
  out = manual.concat(out);
  var rs = sheet_('Roster');
  if (rs.getLastRow() > 1) rs.getRange(2, 1, rs.getLastRow() - 1, TABS.Roster.length).clearContent();
  if (out.length) rs.getRange(2, 1, out.length, TABS.Roster.length).setValues(out.map(function (r) { return r.map(safe_); }));
  return { courses: courses.length, rosterRows: out.length - manual.length, keptManualRows: manual.length };
}

/* ===================== roster import from the school information system ===================== */

var SIS_ID = 'sis';

/**
 * Builds the Roster from the school's AI Literacy class export. Paste the export
 * (with its header row) into a tab called "Import" in the data sheet, then run
 * this from the editor. Owners only.
 *
 * Needed columns (matched by name): Student ID, Student First Name, Student Last
 * Name, Student Gender (M/F), Student Grade, Email Address (the teacher's),
 * Instructor First/Last Name, Class Name. Student emails come from a column whose
 * name contains "student" and "email"; if there is none they are built from the
 * Student ID as {id}@aisa.sch.ae. Override with the script property
 * STUDENT_EMAIL_PATTERN ({id}, {first}, {last} are filled in).
 *
 * Each student's section is their gender and grade (e.g. Boys 6). Each teacher
 * gets every section they teach a student in. Replaces earlier imported rows;
 * keeps rows added by hand and rows from syncClassroom.
 */
function importRoster() {
  if (currentUser_()) requireOwner_();
  var sh = sheet_('Import');
  if (!sh) throw new Error('Add a tab called "Import" and paste the class export into it, header row first.');
  var norm = function (h) { return String(h == null ? '' : h).replace(/[\s\u00a0\u200b\ufeff]+/g, ' ').trim().toLowerCase(); };
  var all = sh.getDataRange().getValues(), hr = -1;
  for (var i = 0; i < Math.min(all.length, 20) && hr < 0; i++) if (all[i].map(norm).indexOf('student id') >= 0) hr = i;
  if (hr < 0) throw new Error('The Import tab has no header row with a "Student ID" column. Paste the export with its header row ' +
    '(AI Course, Subject, … Student ID …). First row found: ' + ((all[0] || []).map(norm).filter(String).join(' | ') || '(empty)'));
  var v = all.slice(hr), head = v[0].map(norm);
  var col = function (re, need) {
    for (var i = 0; i < head.length; i++) if (re.test(head[i])) return i;
    if (need) throw new Error('The Import tab has no "' + need + '" column. Columns found: ' + head.filter(String).join(' | '));
    return -1;
  };
  var C = { id: col(/^student id$/, 'Student ID'), first: col(/^student first name$/, 'Student First Name'), last: col(/^student last name$/, 'Student Last Name'),
            gender: col(/^student gender$/, 'Student Gender'), grade: col(/^student grade$/, 'Student Grade'), temail: col(/^email address$/, 'Email Address'),
            tfirst: col(/^instructor first name$/), tlast: col(/^instructor last name$/), cls: col(/^class name$/), semail: col(/student.*e-?mail/) };
  var pattern = PropertiesService.getScriptProperties().getProperty('STUDENT_EMAIL_PATTERN') || '{id}@' + DOMAIN;
  var slug = function (x) { return String(x || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ''); };
  var students = {}, teachers = {}, skipped = 0, now = new Date();
  v.slice(1).forEach(function (r) {
    if (r.join('') === '') return;
    var grade = Number(r[C.grade]), g = String(r[C.gender]).trim().toUpperCase();
    if (!(grade >= 6 && grade <= 12) || (g !== 'M' && g !== 'F')) { skipped++; return; }
    var section = (g === 'M' ? 'Boys ' : 'Girls ') + grade;
    var email = C.semail >= 0 ? lc_(r[C.semail]) :
      lc_(pattern.replace('{id}', String(r[C.id]).trim()).replace('{first}', slug(r[C.first])).replace('{last}', slug(r[C.last])));
    if (email.slice(-(DOMAIN.length + 1)) !== '@' + DOMAIN) { skipped++; return; }
    var cls = C.cls >= 0 ? String(r[C.cls]).trim() : '';
    var s = students[email] || (students[email] = { name: cleanText_(r[C.first], 60) + ' ' + cleanText_(r[C.last], 60), section: section, grade: grade, classes: {} });
    if (cls) s.classes[cls] = 1;
    var te = lc_(r[C.temail]);
    if (te.slice(-(DOMAIN.length + 1)) === '@' + DOMAIN) {
      var t = teachers[te] || (teachers[te] = { name: C.tfirst >= 0 ? cleanText_(r[C.tfirst], 60) + ' ' + cleanText_(r[C.tlast], 60) : '', sections: {} });
      var ts = t.sections[section] || (t.sections[section] = { grade: grade, classes: {} });
      if (cls) ts.classes[cls] = 1;
    }
  });
  // Re-apply teachers' corrections (transfers, additions, approved requests), latest last.
  var fixed = 0;
  rows_('Changes').forEach(function (c) {
    var e = lc_(c.student);
    if ((c.status === 'done' || c.status === 'approved') && c.toSection && students[e] && students[e].section !== c.toSection) {
      students[e].section = c.toSection; students[e].grade = gradeOf_(c.toSection); fixed++;
    }
  });
  var out = [];
  Object.keys(students).sort().forEach(function (e) { var s = students[e];
    out.push([e, s.name, 'student', s.section, s.grade, SIS_ID, Object.keys(s.classes).sort().join(', '), now]); });
  Object.keys(teachers).sort().forEach(function (e) { var t = teachers[e];
    Object.keys(t.sections).sort().forEach(function (sec) {
      out.push([e, t.name, 'teacher', sec, t.sections[sec].grade, SIS_ID, Object.keys(t.sections[sec].classes).sort().join(', '), now]); }); });
  var keep = rows_('Roster').filter(function (r) { return String(r.courseId || '').trim() !== SIS_ID && !(r.role === 'student' && students[lc_(r.email)]); })
    .map(function (r) { return TABS.Roster.map(function (k) { return r[k] === undefined ? '' : r[k]; }); });
  var all = keep.concat(out), rs = sheet_('Roster');
  if (rs.getLastRow() > 1) rs.getRange(2, 1, rs.getLastRow() - 1, TABS.Roster.length).clearContent();
  if (all.length) rs.getRange(2, 1, all.length, TABS.Roster.length).setValues(all.map(function (r) { return r.map(safe_); }));
  return { students: Object.keys(students).length, teachers: Object.keys(teachers).length, rows: out.length, keptOtherRows: keep.length, skipped: skipped, classListFixesKept: fixed };
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
function sheet_(name) {
  var ss = ss_(), sh = ss.getSheetByName(name);
  if (!sh && TABS[name]) {                       // tabs added after setup() was first run
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
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
if (typeof module !== 'undefined') module.exports = { doGet: doGet, getLessonState: getLessonState, recordScores: recordScores, recordTime: recordTime, recordLatest: recordLatest, setJudgement: setJudgement, getDashboard: getDashboard, syncClassroom: syncClassroom, importRoster: importRoster, transferStudent: transferStudent, addStudent: addStudent, decideRequest: decideRequest, confirmRoster: confirmRoster, setup: setup, currentUser_: currentUser_ };
