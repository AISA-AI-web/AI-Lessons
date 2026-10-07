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
  Changes:   ['timestamp', 'type', 'student', 'name', 'fromSection', 'toSection', 'by', 'status', 'decidedBy', 'decidedAt', 'note', 'fromClass', 'toClass'],
  Confirmations: ['timestamp', 'section', 'teacher', 'students', 'note'],
  Retakes:   ['timestamp', 'student', 'lessonId', 'teacher', 'note'],
  Awards:    ['timestamp', 'month', 'type', 'email', 'name', 'by', 'note']
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
  // Staff land on today's teaching calendar; students on their home page (their own lessons and dates).
  var p = String((e && e.parameter && e.parameter.p) || (me.role === 'student' ? 'index' : 'calendar'));
  if (p === 'dashboard') return dashboardPage_(me);
  if (p === 'calendar' && me.role === 'student') p = 'index';   // the calendar is for staff; students see their own dates at home
  if (!/^(index|calendar|grade-(6|7|8|9|10|11|12)\/(main|bridging)-w\d+-[a-z0-9-]+)$/.test(p)) p = 'index';
  // Students only get Main course lessons their class has reached (see releasedWeeks_).
  var rel = me.role === 'student' ? releasedWeeks_(me.email) : null, lm = /^grade-(\d+)\/main-w(\d+)-/.exec(p);
  if (rel && lm && +lm[2] > rel[lm[1]]) return lockedPage_(+lm[1], +lm[2], me.email);
  var html;
  try { html = HtmlService.createHtmlOutputFromFile('site/' + p).getContent(); }
  catch (err) { html = HtmlService.createHtmlOutputFromFile('site/index').getContent(); p = 'index'; }
  var bridge = HtmlService.createTemplateFromFile('bridge');
  bridge.cfg = JSON.stringify({ email: me.email, name: me.name, role: me.role, page: p, base: ScriptApp.getService().getUrl(),
    sections: me.role === 'teacher' ? visibleSections_(me) : [], section: me.section || '', grade: me.grade || '',
    locked: rel ? lockedLinks_(rel, me.email) : {} });
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
function opensFor_(grade, week, email, short) {
  var secs = studentRows_(email).map(function (r) { return String(r.section || ''); }).filter(function (s) { return gradeOf_(s) === grade; });
  var ds = secs.map(function (s) { return AICAL.opensOn(s, week); }).filter(Boolean);
  var d = ds.length ? new Date(Math.min.apply(null, ds)) : AICAL.opensOnGrade(grade, week);
  if (!d) return '';
  var day = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()],
      mon = ['January','February','March','April','May','June','July','August','September','October','November','December'][d.getMonth()];
  return short ? day.slice(0, 3) + ' ' + d.getDate() + ' ' + mon.slice(0, 3) : day + ' ' + d.getDate() + ' ' + mon + ' ' + d.getFullYear();
}
/** Links a student's pages should show as locked: {"grade-8/main-w5-l1": "Mon 2 Nov"}. */
function lockedLinks_(rel, email) {
  var out = {};
  CATALOG.forEach(function (c) { if (c.course === 'main' && c.week > rel[c.grade]) out[c.id] = opensFor_(c.grade, c.week, email, true); });
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
  var section = '', grade = '';
  if (role === 'student') {
    rows_('Roster').forEach(function (r) {
      if (lc_(r.email) !== email) return;
      if (r.role === 'teacher') role = 'teacher';
      if (r.role === 'student' && !section) { section = String(r.section || ''); grade = Number(r.grade) || gradeOf_(section); }
      name = name || r.name;
    });
  }
  var me = { email: email, name: name || email.split('@')[0], role: role };
  if (role === 'student') { me.section = section; me.grade = grade; }
  return me;
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

/* A section (e.g. Boys 8) can be split between teachers. The Roster's courseName column holds the
   class names (e.g. "8B1"; several are joined with ", "); a teacher's own students are those who
   share one of their classes. A teacher-made class move (Changes type 'class') wins over the
   import while the student stays in that section. Anyone without class names falls back to
   the whole section, so nobody is locked out. */
function splitClasses_(s) { return String(s || '').split(/\s*,\s*/).filter(String); }
function classMap_() {
  var stu = {}, tea = {}, moved = {};
  rows_('Changes').forEach(function (c) {           // in time order: the latest move wins
    if (c.type === 'class' && c.status === 'done' && c.toClass) moved[lc_(c.student)] = { section: c.toSection, cls: String(c.toClass) };
  });
  rows_('Roster').forEach(function (r) {
    var e = lc_(r.email), cls = splitClasses_(r.courseName);
    if (r.role === 'student') {
      var s = stu[e] || (stu[e] = { section: r.section, classes: [] });
      if (r.section === s.section) cls.forEach(function (c) { if (s.classes.indexOf(c) < 0) s.classes.push(c); });
    } else if (r.role === 'teacher' && r.section) {
      var t = tea[e] || (tea[e] = {}), l = t[r.section] || (t[r.section] = []);
      cls.forEach(function (c) { if (l.indexOf(c) < 0) l.push(c); });
    }
  });
  Object.keys(moved).forEach(function (e) { if (stu[e] && stu[e].section === moved[e].section) stu[e].classes = [moved[e].cls]; });
  return { students: stu, teachers: tea };
}
/** True if this student is one of the teacher's own (owners and SLT: everyone). */
function isMine_(me, vis, cm, email, section) {
  if (vis === null) return true;
  if (vis.indexOf(section) < 0) return false;
  var mine = ((cm.teachers[me.email] || {})[section]) || [], theirs = (cm.students[email] || {}).classes || [];
  if (!mine.length || !theirs.length) return true;
  return theirs.some(function (c) { return mine.indexOf(c) >= 0; });
}

/* ===================== retakes ===================== */

/* A teacher can ask a student to redo a lesson (e.g. finished in a few minutes with a low score).
   The new attempt starts at the retake's time: only work after it counts as the lesson's first
   tries; the earlier attempt stays in the sheet and is shown to the teacher for comparison. */
function retakes_() {
  var out = {};
  rows_('Retakes').forEach(function (r) {             // in time order: the latest retake wins
    var k = lc_(r.student) + '|' + r.lessonId, o = out[k] || (out[k] = { n: 0 });
    o.n++; o.at = new Date(r.timestamp).getTime(); o.by = r.teacher;
  });
  return out;
}
function since_(rt, email, lessonId) { var o = rt[email + '|' + lessonId]; return o ? o.at : 0; }
function after_(r, start) { return !start || new Date(r.timestamp).getTime() > start; }

/** Asks a student to redo a lesson: their answers are cleared and the next attempt is recorded afresh. */
function setRetake(studentEmail, lessonId, note) {
  var me = requireUser_(), email = checkEmail_(studentEmail);
  lessonId = cleanId_(lessonId);
  if (me.role === 'student') throw new Error('Only teachers can ask for a retake.');
  var vis = visibleSections_(me);
  if (vis !== null) {
    var cm = classMap_(), st = cm.students[email];
    if (!st || !isMine_(me, vis, cm, email, st.section)) throw new Error('You can only ask your own students to retake a lesson.');
  }
  return withLock_(function () {
    var start = since_(retakes_(), email, lessonId);
    var any = rows_('Scores').some(function (r) { return lc_(r.email) === email && r.lessonId === lessonId && after_(r, start); });
    if (!any) throw new Error(start ? 'A retake is already set – the student has not started it yet.' : 'This student has not started this lesson yet.');
    append_('Retakes', [[new Date(), email, lessonId, me.email, cleanText_(note, 200)]]);
    return { retake: true, attempt: (retakes_()[email + '|' + lessonId] || {}).n + 1 };
  });
}

/* ===================== called from lesson pages ===================== */

/** Activity ids this student already has a first-try score for in a lesson (current attempt),
    and how many retakes their teacher has set (the page clears old answers when this goes up). */
function getLessonState(lessonId) {
  var me = requireUser_();
  lessonId = cleanId_(lessonId);
  var done = {}, latest = {}, rt = retakes_(), start = since_(rt, me.email, lessonId);
  rows_('Scores').forEach(function (r) { if (lc_(r.email) === me.email && r.lessonId === lessonId && after_(r, start)) done[r.activityId] = Number(r.firstScore); });
  rows_('Retries').forEach(function (r) { if (lc_(r.email) === me.email && r.lessonId === lessonId && after_(r, start)) latest[r.activityId] = Number(r.score); });
  return { done: done, latest: latest, attempt: (rt[me.email + '|' + lessonId] || {}).n || 0 };
}

/** The signed-in user's own work, lesson by lesson, for the home page:
    { lessons: { lessonId: { done, score, max } } } – first tries only. */
function getMyProgress() {
  var me = requireUser_(), out = {}, seen = {}, rt = retakes_();
  rows_('Scores').forEach(function (r) {
    if (lc_(r.email) !== me.email || !after_(r, since_(rt, me.email, r.lessonId))) return;
    var k = r.lessonId + '|' + r.activityId; if (seen[k]) return; seen[k] = 1;   // the earliest first try only
    var o = out[r.lessonId] || (out[r.lessonId] = { done: 0, score: 0, max: 0 });
    o.done++; o.score += Number(r.firstScore) || 0; o.max += Number(r.max) || 0;
  });
  return { lessons: out };
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
    var have = {}, start = since_(retakes_(), me.email, lessonId);
    rows_('Scores').forEach(function (r) { if (lc_(r.email) === me.email && r.lessonId === lessonId && after_(r, start)) have[r.activityId] = 1; });
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
    var cm = classMap_(), st = cm.students[student];
    if (!st || !isMine_(me, vis, cm, student, st.section)) throw new Error('You can only record judgements for students you teach. If they belong in your class, move them to it under Class lists.');
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
function logChange_(type, email, name, from, to, by, status, note, fromClass, toClass) {
  var sh = sheet_('Changes'), head = sh.getDataRange().getValues()[0] || [];
  if (head.length < TABS.Changes.length) sh.getRange(1, 1, 1, TABS.Changes.length).setValues([TABS.Changes]);   // sheets made before class moves
  append_('Changes', [[new Date(), type, email, cleanText_(name, 80), from || '', to || '', by, status, '', '', cleanText_(note, 200), fromClass || '', toClass || '']]);
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

/** Moves a student in one of your sections into your own class within it (e.g. 8B2 → 8B1),
    when the school list put them with the wrong teacher. Logged; a fresh import does not undo it. */
function claimStudent(studentEmail, toClass, note) {
  var me = requireUser_(), email = checkEmail_(studentEmail), cls = cleanText_(toClass, 60);
  if (me.role === 'student') throw new Error('You can only move students into your own classes.');
  return withLock_(function () {
    var rows = studentRows_(email);
    if (!rows.length) throw new Error('That student is not on the class lists.');
    var cm = classMap_(), sec = rows[0].section, mine = (cm.teachers[me.email] || {})[sec] || [];
    if (mine.indexOf(cls) < 0) throw new Error('You can only move students into your own classes. ' + (rows[0].name || email) + ' is in ' + sec + ' – to bring them into another section, use Add or request a missing student.');
    var from = ((cm.students[email] || {}).classes || []).join(', ');
    if (from === cls) throw new Error('That student is already in ' + cls + '.');
    logChange_('class', email, rows[0].name, sec, sec, me.email, 'done', note, from, cls);
    return { moved: true, section: sec, from: from, to: cls };
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
    var own = (classMap_().teachers[me.email] || {})[section] || [];
    logChange_('add', email, nm, '', section, me.email, 'done', note);
    if (own.length === 1) logChange_('class', email, nm, section, section, me.email, 'done', 'Added by their teacher', '', own[0]);
    return { added: true, to: section, cls: own.length === 1 ? own[0] : '' };
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
        recent.push({ type: c.type, student: email, name: c.name, from: c.fromSection, to: c.toSection, fromClass: c.fromClass || '', toClass: c.toClass || '', by: c.by, at: new Date(c.timestamp).toISOString(), status: c.status });
    }
  });
  var conf = {};
  rows_('Confirmations').forEach(function (c) { if (mine(c.section)) conf[c.section] = { by: c.teacher, at: new Date(c.timestamp).toISOString(), students: c.students }; });
  Object.keys(conf).forEach(function (s) { conf[s].changedSince = (lastChange[s] || 0) > new Date(conf[s].at).getTime(); });
  var lead = me.role === 'owner' || me.role === 'slt';   // they also get the full log, to send to IT
  return { sections: SECTIONS, mySections: all ? SECTIONS : vis, requests: requests, recent: (lead ? recent : recent.slice(-30)).reverse(), confirmations: conf, canExport: lead };
}

/* ===================== dashboard data ===================== */

/** Every student's current attempt at every lesson (first tries, time, fixes), plus the attempt
    before the latest retake. Shared by the dashboard and the awards. */
function lessonCells_() {
  var per = {};   // email|lesson -> {score, done, firstAt, lastAt, seconds, acts:{id:[score,max]}}
  function cell(e, l) { var k = e + '|' + l; return per[k] || (per[k] = { email: e, lessonId: l, score: 0, done: 0, seconds: 0, firstAt: null, lastAt: null, acts: {} }); }
  var rt = retakes_(), prev = {};                    // prev: email|lesson -> the attempt before the latest retake
  rows_('Scores').forEach(function (r) {
    var e = lc_(r.email), k = e + '|' + r.lessonId, start = since_(rt, e, r.lessonId);
    if (!after_(r, start)) {
      var p = prev[k] || (prev[k] = { score: 0, max: 0, done: 0, seconds: 0, seen: {} });
      if (!p.seen[r.activityId]) { p.seen[r.activityId] = 1; p.score += Number(r.firstScore) || 0; p.max += Number(r.max) || 0; p.done++; }
      return;
    }
    var c = cell(e, r.lessonId);
    if (c.acts[r.activityId]) return;                // keep the earliest first try only
    c.acts[r.activityId] = [Number(r.firstScore), Number(r.max), r.activityTitle, r.part];
    c.score += Number(r.firstScore); c.done += 1;
    var t = new Date(r.timestamp).getTime();
    c.firstAt = c.firstAt === null ? t : Math.min(c.firstAt, t); c.lastAt = Math.max(c.lastAt || 0, t);
  });
  rows_('Time').forEach(function (r) {
    var e = lc_(r.email), k = e + '|' + r.lessonId;
    if (after_(r, since_(rt, e, r.lessonId))) cell(e, r.lessonId).seconds += Number(r.seconds) || 0;
    else if (prev[k]) prev[k].seconds += Number(r.seconds) || 0;
  });
  rows_('Retries').forEach(function (r) {           // rows are in time order, so the last one wins
    var e = lc_(r.email); if (!after_(r, since_(rt, e, r.lessonId))) return;
    var a = cell(e, r.lessonId).acts[r.activityId];
    if (a) a[4] = Number(r.score);
  });
  return { per: per, prev: prev, rt: rt };
}

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

  var LC = lessonCells_(), per = LC.per, prev = LC.prev, rt = LC.rt;

  Object.keys(per).forEach(function (k) {             // people who worked but are not on the roster
    var e = per[k].email;
    if (!students[e]) students[e] = { email: e, name: e.split('@')[0], section: 'Unassigned', grade: '' };
  });

  var allowed = function (s) {
    if (vis === null) return true;
    if (!vis.length) return s.email === me.email;
    return vis.indexOf(s.section) >= 0;
  };
  var cm = classMap_(), myClasses = vis === null ? {} : (cm.teachers[me.email] || {});
  var outStudents = Object.keys(students).map(function (e) { return students[e]; }).filter(allowed);
  outStudents.forEach(function (s) { s.classes = (cm.students[s.email] || {}).classes || []; s.mine = me.role === 'student' || isMine_(me, vis, cm, s.email, s.section); });
  var keep = {}; outStudents.forEach(function (s) { keep[s.email] = 1; });
  var results = Object.keys(per).map(function (k) { return per[k]; }).filter(function (c) { return keep[c.email]; });
  var retakes = {};                                   // email|lesson -> { n, at, by, prev: {score, max, done, seconds} }
  Object.keys(rt).forEach(function (k) { if (!keep[k.split('|')[0]]) return; var p = prev[k];
    retakes[k] = { n: rt[k].n, at: new Date(rt[k].at).toISOString(), by: rt[k].by, prev: p ? { score: p.score, max: p.max, done: p.done, seconds: p.seconds } : null }; });
  return {
    me: me,
    scope: vis === null ? 'school' : (vis.length ? 'sections' : 'self'),
    sections: vis === null ? unique_(outStudents.map(function (s) { return s.section; })) : vis,
    lessons: Object.keys(lessons).map(function (k) { return lessons[k]; }),
    students: outStudents,
    results: results,
    retakes: retakes,
    judgements: judgementsFor_(keep),
    framework: typeof FRAMEWORK === 'undefined' ? null : FRAMEWORK,
    canJudge: me.role !== 'student',
    myClasses: myClasses,
    canAward: me.role === 'owner',
    myAwards: myAwards_(me.email),
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

/* ===================== AI & Innovation Student / Teacher of the Month (owners) ===================== */

/* The same rules as the dashboard: a lesson is rushed when finished in under 10 minutes of active
   time with a first-try score under 50%. */
var RUSH_MIN = 10, RUSH_PCT = 50, AWARD_TYPES = ['student', 'teacher'];
function month_(m) {
  var x = /^(\d{4})-(\d{2})$/.exec(String(m || ''));
  var now = new Date(), y = x ? Number(x[1]) : now.getFullYear(), mo = x ? Number(x[2]) - 1 : now.getMonth();
  return { key: y + '-' + ('0' + (mo + 1)).slice(-2), from: new Date(y, mo, 1).getTime(), to: new Date(y, mo + 1, 1).getTime() };
}
function awardMonths_() {
  var out = [], d = new Date(TERM_START + 'T00:00:00'), now = new Date();
  d = new Date(d.getFullYear(), d.getMonth(), 1);
  while (d <= now) { out.push(d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2)); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
  return out.reverse();
}
function clamp01_(v) { return Math.max(0, Math.min(1, v)); }
/** Weighted score out of 100; parts without data (null) are left out and the rest re-weighted. */
function weighted_(parts) {
  var w = 0, s = 0;
  parts.forEach(function (p) { if (p[0] !== null && p[0] !== undefined) { w += p[1]; s += p[0] * p[1]; } });
  return w ? Math.round(s / w * 100) : 0;
}
/** One student's month: lessons due and finished, first-try quality, care, growth and fixes. */
function studentMonth_(email, section, grade, per, rt, M, now) {
  var cat = typeof CATALOG === 'undefined' ? [] : CATALOG, known = AICAL.SCHEDULE.some(function (r) { return r[0] === section; });
  var o = { due: 0, doneDue: 0, fin: 0, sc: 0, mx: 0, secs: 0, rushed: 0, wrong: 0, fixed: 0, bsc: 0, bmx: 0, active: false };
  cat.forEach(function (l) {
    if (l.grade !== grade) return;
    var c = per[email + '|' + l.id], finished = c && l.activities && c.done >= l.activities;
    if (c && c.lastAt >= M.from && c.lastAt < M.to) o.active = true;
    if (l.course === 'main' && known) {
      var d = AICAL.lessonDate(section, l.week), t = d ? d.getTime() : 0;
      if (t >= M.from && t < M.to && t <= now) { o.due++; if (finished) o.doneDue++; }
    }
    if (!finished) return;
    var mx = Object.keys(c.acts).reduce(function (n, k) { return n + c.acts[k][1]; }, 0);
    if (c.lastAt < M.from) { o.bsc += c.score; o.bmx += mx; return; }
    if (c.lastAt >= M.to) return;
    o.fin++; o.sc += c.score; o.mx += mx; o.secs += c.seconds;
    var secs = c.seconds > 0 ? c.seconds : (c.lastAt - c.firstAt) / 1000;
    if (mx && c.score / mx * 100 < RUSH_PCT && secs < RUSH_MIN * 60) o.rushed++;
    Object.keys(c.acts).forEach(function (k) { var a = c.acts[k]; if (a[0] < a[1]) { o.wrong++; if (a[4] === a[1]) o.fixed++; } });
  });
  o.quality = o.mx ? Math.round(o.sc / o.mx * 100) : null;
  o.completion = o.due ? Math.round(o.doneDue / o.due * 100) : null;
  o.care = o.fin ? Math.round(o.secs / o.fin / 60) : null;                       // active minutes per finished lesson
  o.growth = o.quality !== null && o.bmx ? o.quality - Math.round(o.bsc / o.bmx * 100) : null;
  o.fixRate = o.wrong ? Math.round(o.fixed / o.wrong * 100) : null;
  return o;
}
function studentScore_(o) {
  return weighted_([[o.quality === null ? null : o.quality / 100, 40], [o.completion === null ? null : o.completion / 100, 25],
    [o.care === null ? null : clamp01_(o.care / 30), 15], [o.growth === null ? null : clamp01_((o.growth + 20) / 40), 10],
    [o.fin ? (o.fixRate === null ? 1 : o.fixRate / 100) : null, 10]]);
}

/** Rankings for a month, owners only. Students: at least 2 lessons finished that month, none rushed,
    and at least 75% of the lessons taught that month finished. Teachers: at least 5 students. */
function getAwards(month) {
  var me = requireOwner_(), M = month_(month), now = Math.min(Date.now(), M.to);
  var LC = lessonCells_(), per = LC.per, rt = LC.rt, cm = classMap_();
  var studs = {}, names = {}, teachers = {};
  rows_('Roster').forEach(function (r) {
    var e = lc_(r.email);
    if (r.role === 'student' && !studs[e]) studs[e] = { email: e, name: r.name || e.split('@')[0], section: r.section, grade: Number(r.grade) || gradeOf_(r.section) };
    if (r.role === 'teacher') { names[e] = names[e] || r.name || e.split('@')[0]; (teachers[e] = teachers[e] || {})[r.section] = 1; }
  });
  var stats = {};
  Object.keys(studs).forEach(function (e) { var s = studs[e]; stats[e] = studentMonth_(e, s.section, s.grade, per, rt, M, now); });
  var students = Object.keys(studs).map(function (e) {
    var s = studs[e], o = stats[e], why = [];
    if (o.fin < 2) why.push('fewer than 2 lessons finished this month');
    if (o.rushed) why.push(o.rushed + ' rushed lesson' + (o.rushed > 1 ? 's' : ''));
    if (o.completion !== null && o.completion < 75) why.push('finished ' + o.completion + '% of the lessons taught');
    return { email: e, name: s.name, section: s.section, grade: s.grade, classes: (cm.students[e] || {}).classes || [], fin: o.fin, due: o.due, doneDue: o.doneDue,
      quality: o.quality, completion: o.completion, care: o.care, growth: o.growth, fixRate: o.fixRate, rushed: o.rushed, score: studentScore_(o), eligible: !why.length, why: why.join('; ') };
  }).filter(function (x) { return x.fin || x.due; }).sort(function (a, b) { return (b.eligible - a.eligible) || b.score - a.score; });
  var judged = {}; rows_('Judgements').forEach(function (j) { var t = new Date(j.timestamp).getTime(); if (t >= M.from && t < M.to) judged[lc_(j.teacher)] = (judged[lc_(j.teacher)] || 0) + 1; });
  var confirmed = {}; rows_('Confirmations').forEach(function (c) { confirmed[lc_(c.teacher)] = (confirmed[lc_(c.teacher)] || 0) + 1; });
  var tlist = Object.keys(teachers).map(function (t) {
    var tme = { email: t, role: 'teacher' }, vis = Object.keys(teachers[t]);
    var mine = Object.keys(studs).filter(function (e) { return isMine_(tme, vis, cm, e, studs[e].section); });
    var a = { due: 0, doneDue: 0, sc: 0, mx: 0, bsc: 0, bmx: 0, active: 0, rushed: 0, followed: 0 };
    mine.forEach(function (e) { var o = stats[e]; a.due += o.due; a.doneDue += o.doneDue; a.sc += o.sc; a.mx += o.mx; a.bsc += o.bsc; a.bmx += o.bmx; if (o.active) a.active++;
      a.rushed += o.rushed;
      if (o.rushed) Object.keys(rt).forEach(function (k) { if (k.split('|')[0] === e && rt[k].at >= M.from) a.followed++; }); });
    var q = a.mx ? Math.round(a.sc / a.mx * 100) : null, comp = a.due ? Math.round(a.doneDue / a.due * 100) : null;
    var growth = q !== null && a.bmx ? q - Math.round(a.bsc / a.bmx * 100) : null, eng = mine.length ? Math.round(a.active / mine.length * 100) : null;
    var follow = a.rushed ? Math.min(100, Math.round(a.followed / a.rushed * 100)) : null;
    var score = weighted_([[comp === null ? null : comp / 100, 35], [q === null ? null : q / 100, 25], [growth === null ? null : clamp01_((growth + 20) / 40), 15],
      [eng === null ? null : eng / 100, 15], [follow === null ? 1 : follow / 100, 10]]);
    var why = [];
    if (mine.length < 5) why.push('fewer than 5 students');
    if (!a.mx) why.push('no finished lessons this month');
    return { email: t, name: names[t], sections: vis, students: mine.length, completion: comp, quality: q, growth: growth, engagement: eng, rushed: a.rushed, followed: a.followed,
      tiers: judged[t] || 0, listsConfirmed: confirmed[t] || 0, score: score, eligible: !why.length, why: why.join('; ') };
  }).sort(function (a, b) { return (b.eligible - a.eligible) || b.score - a.score; });
  var noms = {}, history = [];
  rows_('Awards').forEach(function (r) { noms[r.month + '|' + r.type] = { month: String(r.month), type: r.type, email: lc_(r.email), name: r.name, by: r.by, note: r.note, at: new Date(r.timestamp).toISOString() }; });
  Object.keys(noms).forEach(function (k) { history.push(noms[k]); });
  history.sort(function (a, b) { return b.month.localeCompare(a.month) || a.type.localeCompare(b.type); });
  return { month: M.key, months: awardMonths_(), students: students.slice(0, 40), teachers: tlist, nominees: { student: noms[M.key + '|student'] || null, teacher: noms[M.key + '|teacher'] || null }, history: history,
    rules: { rushMin: RUSH_MIN, rushPct: RUSH_PCT } };
}

/** Owners name the AI & Innovation Student or Teacher of the Month (a later nomination replaces it). */
function nominate(month, type, email, note) {
  var me = requireOwner_(), M = month_(month), e = lc_(email);
  if (AWARD_TYPES.indexOf(type) < 0) throw new Error('Unknown award.');
  var row = rows_('Roster').filter(function (r) { return lc_(r.email) === e && r.role === type; })[0];
  if (!row) throw new Error('That ' + type + ' is not on the class lists.');
  append_('Awards', [[new Date(), M.key, type, e, cleanText_(row.name, 80) || e.split('@')[0], me.email, cleanText_(note, 300)]]);
  return { saved: true, month: M.key, type: type, name: row.name };
}
/** Awards won by this user (shown as a banner on their own dashboard). */
function myAwards_(email) {
  var noms = {};
  rows_('Awards').forEach(function (r) { noms[r.month + '|' + r.type] = { month: String(r.month), type: r.type, email: lc_(r.email), note: r.note }; });
  return Object.keys(noms).map(function (k) { return noms[k]; }).filter(function (a) { return a.email === email; }).sort(function (a, b) { return b.month.localeCompare(a.month); });
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
if (typeof module !== 'undefined') module.exports = { doGet: doGet, getMyProgress: getMyProgress, getLessonState: getLessonState, recordScores: recordScores, recordTime: recordTime, recordLatest: recordLatest, setJudgement: setJudgement, getDashboard: getDashboard, syncClassroom: syncClassroom, importRoster: importRoster, transferStudent: transferStudent, addStudent: addStudent, decideRequest: decideRequest, confirmRoster: confirmRoster, setup: setup, currentUser_: currentUser_ };
