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
  Awards:    ['timestamp', 'month', 'type', 'email', 'name', 'by', 'note'],
  Absences:  ['timestamp', 'student', 'lessonId', 'teacher', 'status', 'note'],
  Reminders: ['timestamp', 'teacher', 'section', 'lessonId', 'by', 'cc'],
  Visits:    ['timestamp', 'email', 'role']
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

/** ▶ RUN THIS ONCE from the script editor (pick it in the function menu next to Run / Debug), then click
    Allow: it lets the app send the reminder emails. The log shows "Email is allowed" when it worked. */
function authorizeEmail() { var msg = 'Email is allowed. Reminders left today: ' + MailApp.getRemainingDailyQuota(); console.log(msg); return msg; }

function doGet(e) {
  var me = currentUser_();
  if (!me) return page_('<h1>Sign in with your AISA account</h1><p>This site is only available to <b>@' + DOMAIN +
    '</b> Google accounts. Sign out of any personal account and open the link again with your school account.</p>', 'Access denied');
  // Staff land on today's teaching calendar; students on their home page (their own lessons and dates).
  logVisit_(me);
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
    locked: rel ? lockedLinks_(rel, me.email) : {},
    teachers: (me.role === 'owner' || me.role === 'slt') && p === 'calendar' ? calendarTeachers_() : {} });
  html = html.replace(/<head>/i, '<head>' + bridge.evaluate().getContent());
  return HtmlService.createHtmlOutput(html)
    .setTitle(titleOf_(html))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Staff only, once a day: when each teacher last opened the app (for the manager view). */
function logVisit_(me) {
  if (!me || me.role === 'student') return;
  try {
    var key = 'visit:' + me.email + ':' + AICAL.iso(new Date()), cache = CacheService.getScriptCache();
    if (cache.get(key)) return;
    append_('Visits', [[new Date(), me.email, me.role]]);
    cache.put(key, '1', 21600);
  } catch (err) {}
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
/* Only imported rows (school export 'sis' or a Classroom course) carry class names; rows added by hand
   (blank courseId) hold a note such as "AI timetable – teacher" or "Added by …", which is not a class. */
function sectionCodes_(stu) {
  var out = {};
  Object.keys(stu).forEach(function (e) { var s = stu[e]; (s.classes || []).forEach(function (c) { (out[s.section] = out[s.section] || {})[c] = 1; }); });
  return out;
}
function classesOf_(r) { return String(r.courseId || '').trim() ? splitClasses_(r.courseName) : []; }
/* The subject of a class: the school's codes put it after the grade (BO6ISA1 = Boys 6 Islamic,
   GI9AFL2 = Girls 9 Arabic first language, BO6ASL = Arabic second language, BO6TUT = tutor group);
   Classroom course names and hand-added notes say it in words. AI lessons sit in Arabic or Islamic periods. */
function subjectOf_(c) {
  c = String(c || '');
  var m = /^[A-Za-z]{0,3}\d{1,2}\s*([A-Za-z]+)/.exec(c), k = m ? m[1].toUpperCase() : '';
  if (/^IS/.test(k) || /islam/i.test(c)) return 'Islamic';
  if (/^(AFL|ASL|AR)/.test(k) || /arab/i.test(c)) return 'Arabic';
  if (/^TUT/.test(k) || /tutor/i.test(c)) return 'Tutor';
  return '';
}
function classMap_() {
  var stu = {}, tea = {}, moved = {};
  rows_('Changes').forEach(function (c) {           // in time order: the latest move wins
    if (c.type === 'class' && c.status === 'done' && c.toClass) moved[lc_(c.student)] = { section: c.toSection, cls: String(c.toClass) };
  });
  rows_('Roster').forEach(function (r) {
    var e = lc_(r.email), cls = classesOf_(r);
    if (r.role === 'student') {
      var s = stu[e] || (stu[e] = { section: r.section, classes: [] });
      if (r.section === s.section) cls.forEach(function (c) { if (s.classes.indexOf(c) < 0) s.classes.push(c); });
    } else if (r.role === 'teacher' && r.section) {
      var t = tea[e] || (tea[e] = {}), l = t[r.section] || (t[r.section] = []);
      cls.forEach(function (c) { if (l.indexOf(c) < 0) l.push(c); });
    }
  });
  var codes = sectionCodes_(stu);                     // codes the school export gives students (before teachers' moves)
  Object.keys(moved).forEach(function (e) { if (stu[e] && stu[e].section === moved[e].section) stu[e].classes = [moved[e].cls]; });
  /* A teacher's codes only separate students when the students carry them too: if the school export lists
     students under other codes (e.g. only their Arabic group), the teacher teaches the whole section. */
  Object.keys(tea).forEach(function (e) { Object.keys(tea[e]).forEach(function (sec) { tea[e][sec] = tea[e][sec].filter(function (c) { return (codes[sec] || {})[c]; }); }); });
  return { students: stu, teachers: tea, codes: codes };
}
/** section -> [{name, email, classes, subjects}] for every teacher on the class lists. */
function teachersBySection_() {
  var out = {}, idx = {};
  rows_('Roster').forEach(function (r) {
    if (r.role !== 'teacher' || !r.section) return;
    var e = lc_(r.email), k = r.section + '|' + e, t = idx[k];
    if (!t) { t = idx[k] = { name: cleanText_(r.name, 80) || e.split('@')[0], email: e, classes: [], subjects: [] }; (out[r.section] = out[r.section] || []).push(t); }
    var cls = classesOf_(r);
    cls.forEach(function (c) { if (t.classes.indexOf(c) < 0) t.classes.push(c); });
    (cls.length ? cls : splitClasses_(r.courseName).concat([String(r.courseName || '')])).forEach(function (c) { var s = subjectOf_(c); if (s && t.subjects.indexOf(s) < 0) t.subjects.push(s); });
  });
  var codes = classMap_().codes;
  Object.keys(out).forEach(function (sec) { out[sec].forEach(function (t) { t.classes = t.classes.filter(function (c) { return (codes[sec] || {})[c]; }); }); });
  return out;
}
/** For the owners' and SLT's calendar: names and subjects only (no class codes). */
function calendarTeachers_() {
  var tbs = teachersBySection_(), out = {};
  Object.keys(tbs).forEach(function (sec) { out[sec] = tbs[sec].map(function (t) { return { name: t.name, email: t.email, subjects: t.subjects }; }); });
  return out;
}
/** The teachers who teach this student (sharing one of their classes, or the whole section when either
    has no class names), by subject – so a lesson can be matched to the teacher of that day's period.
    names: their Arabic and Islamic teachers (a tutor only when no one else is listed). */
function teachersOf_(cm, tbs, email, section) {
  var theirs = (cm.students[email] || {}).classes || [], bySub = {}, lesson = [], tutors = [];
  (tbs[section] || []).forEach(function (t) {
    if (t.classes.length && theirs.length && !theirs.some(function (c) { return t.classes.indexOf(c) >= 0; })) return;
    var subs = t.subjects.length ? t.subjects : [''];
    subs.forEach(function (sb) { var l = bySub[sb] || (bySub[sb] = []); if (l.indexOf(t.name) < 0) l.push(t.name); });
    if (subs.some(function (sb) { return sb !== 'Tutor'; })) { if (lesson.indexOf(t.name) < 0) lesson.push(t.name); }
    else if (tutors.indexOf(t.name) < 0) tutors.push(t.name);
  });
  return { names: lesson.length ? lesson : tutors, bySub: bySub };
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
  var tbs = me.role === 'student' ? {} : teachersBySection_();
  outStudents.forEach(function (s) { s.classes = (cm.students[s.email] || {}).classes || []; s.mine = me.role === 'student' || isMine_(me, vis, cm, s.email, s.section);
    if (me.role !== 'student') { var to = teachersOf_(cm, tbs, s.email, s.section); s.teachers = to.names; s.tsub = to.bySub; } });
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
    absences: (function () { var a = absences_(), o = {}; Object.keys(a).forEach(function (k) { if (keep[k.split('|')[0]]) o[k] = a[k]; }); return o; })(),
    judgements: judgementsFor_(keep),
    framework: typeof FRAMEWORK === 'undefined' ? null : FRAMEWORK,
    canJudge: me.role !== 'student',
    myClasses: myClasses,
    canAward: me.role === 'owner',
    canManage: me.role === 'owner' || me.role === 'slt',
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

/* ===================== absences ===================== */

/* A teacher marks a student absent for a lesson, so a lesson not started is explained: it is shown as
   Absent, and left out of 'Not started', 'Need a nudge', completion, the awards and the not-taught check. */
function absences_() {
  var out = {};
  rows_('Absences').forEach(function (r) {             // in time order: the latest mark wins
    var k = lc_(r.student) + '|' + r.lessonId;
    if (r.status === 'absent') out[k] = { by: lc_(r.teacher), at: new Date(r.timestamp).toISOString(), note: r.note };
    else delete out[k];
  });
  return out;
}
/** Marks (absent = true) or clears a student's absence for a lesson. Own students; owners and SLT: anyone. */
function setAbsent(studentEmail, lessonId, absent, note) {
  var me = requireUser_(), email = checkEmail_(studentEmail);
  lessonId = cleanId_(lessonId);
  if (me.role === 'student') throw new Error('Only teachers can mark absences.');
  var vis = visibleSections_(me);
  if (vis !== null) {
    var cm = classMap_(), st = cm.students[email];
    if (!st || !isMine_(me, vis, cm, email, st.section)) throw new Error('You can only mark your own students absent.');
  }
  append_('Absences', [[new Date(), email, lessonId, me.email, absent ? 'absent' : 'cleared', cleanText_(note, 200)]]);
  return { absent: !!absent };
}

/* ===================== lessons not taught: reminders to teachers (owners) ===================== */

/* A lesson counts as not taught when its date has passed and fewer than a quarter of a teacher's
   students (in that period's subject group, leaving out absences) have opened it – at least 3 students. */
var NOT_TAUGHT_SHARE = 0.25, NOT_TAUGHT_MIN = 1;
/* Only lessons from the day the app was rolled out (script property NOT_TAUGHT_FROM overrides it), and
   only once the lesson's period has ended. */
var NOT_TAUGHT_FROM = '2026-10-07';
/** When a slot's period ends on date d: '1:10 - 2:00' ends at 2:00 pm (school hours 7:00–6:59). */
function periodEnd_(d, time) {
  var m = /-\s*(\d{1,2}):(\d{2})/.exec(String(time || '')), h = m ? Number(m[1]) : 23, mi = m ? Number(m[2]) : 59;
  if (m && h < 7) h += 12;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mi);
}
function rolloutFrom_() { return AICAL.parse(PropertiesService.getScriptProperties().getProperty('NOT_TAUGHT_FROM') || NOT_TAUGHT_FROM); }

/** One model of every class's AI periods, shared by the manager view and the not-taught reminders.
    sections: [{ name, grade, students: [{e, n}], lessons: [lessonId by week], teachers: [{email, name, subjects}],
                 groups: { 'Subject|teacherEmail': [student index] } }]  – who teaches whom, per subject
    cells: { 'section|lessonId': { id, week, title, date, day, period, time, subject, end, state, st, pc } }
      state: 'before' (before the app was rolled out) | 'upcoming' (period not over yet) | 'due'
      st: one letter per student – F finished, R finished but rushed, S started, N not started, A absent
      pc: each student's first-try % (-1 = no answers yet) */
function periodModel_() {
  var LC = lessonCells_(), cm = classMap_(), tbs = teachersBySection_(), ab = absences_(), cat = typeof CATALOG === 'undefined' ? [] : CATALOG;
  var now = new Date(), from = rolloutFrom_(), names = {}, bySec = {};
  rows_('Roster').forEach(function (r) { if (r.role === 'student') { var e = lc_(r.email); if (!names[e]) names[e] = cleanText_(r.name, 80) || e.split('@')[0]; } });
  Object.keys(cm.students).forEach(function (e) { var sec = cm.students[e].section; if (sec) (bySec[sec] = bySec[sec] || []).push(e); });
  var sections = [], cells = {};
  SECTIONS.forEach(function (sec) {
    if (!AICAL.SCHEDULE.some(function (r) { return r[0] === sec; })) return;
    var grade = gradeOf_(sec), list = (bySec[sec] || []).slice().sort(function (a, b) { return names[a].localeCompare(names[b]); });
    var students = list.map(function (e) { return { e: e, n: names[e], c: cm.students[e].classes || [] }; }), groups = {};
    (tbs[sec] || []).forEach(function (t) {
      (t.subjects.length ? t.subjects : ['']).forEach(function (sub) {
        var tc = t.classes.filter(function (c) { return subjectOf_(c) === sub; }); if (!tc.length) tc = t.classes;
        groups[sub + '|' + t.email] = students.map(function (x, i) { return !tc.length || !x.c.length || x.c.some(function (c) { return tc.indexOf(c) >= 0; }) ? i : -1; })
          .filter(function (i) { return i >= 0; });
      });
    });
    var lessons = cat.filter(function (l) { return l.grade === grade && l.course === 'main'; }).sort(function (a, b) { return a.week - b.week; });
    sections.push({ name: sec, grade: grade, students: students.map(function (x) { return { e: x.e, n: x.n }; }), groups: groups, lessons: lessons.map(function (l) { return l.id; }),
      teachers: (tbs[sec] || []).map(function (t) { return { email: t.email, name: t.name, subjects: t.subjects }; }) });
    lessons.forEach(function (l) {
      var d = AICAL.lessonDate(sec, l.week); if (!d) return;
      var slot = AICAL.SCHEDULE.filter(function (x) { return x[0] === sec && x[3] === AICAL.cycleOf(d) && x[4] === AICAL.DAYS[d.getDay()]; })[0];
      var end = periodEnd_(d, slot ? slot[6] : ''), st = '', pc = [];
      students.forEach(function (x) {
        var k = x.e + '|' + l.id, c = LC.per[k], mx = c ? Object.keys(c.acts).reduce(function (n, a) { return n + c.acts[a][1]; }, 0) : 0, p = c && mx ? Math.round(c.score / mx * 100) : -1, code;
        if (c && l.activities && c.done >= l.activities) { var secs = c.seconds > 0 ? c.seconds : (c.lastAt - c.firstAt) / 1000; code = p < RUSH_PCT && secs < RUSH_MIN * 60 ? 'R' : 'F'; }
        else if (c || LC.prev[k]) code = 'S';
        else code = ab[k] ? 'A' : 'N';
        st += code; pc.push(p);
      });
      cells[sec + '|' + l.id] = { id: l.id, week: l.week, title: l.title, date: AICAL.iso(d), day: AICAL.dayNumber(d), period: slot ? slot[5] : '', time: slot ? String(slot[6]).replace(' - ', '–') : '',
        subject: slot ? slot[2] : '', end: end.getTime(), state: d < from ? 'before' : end > now ? 'upcoming' : 'due', st: st, pc: pc };
    });
  });
  return { sections: sections, cells: cells, from: AICAL.iso(from), now: now.getTime() };
}
/** The teacher groups for one class period: the teachers of that period's subject (or, if none, of no known
    subject), each with their students; students no such teacher has are grouped as 'no teacher' (email ''). */
function slotGroups_(sec, subject) {
  var keys = Object.keys(sec.groups), pick = keys.filter(function (k) { return k.split('|')[0] === subject; }), tn = {};
  if (!pick.length) pick = keys.filter(function (k) { return k.split('|')[0] === ''; });
  sec.teachers.forEach(function (t) { tn[t.email] = t.name; });
  var out = pick.map(function (k) { var em = k.slice(k.indexOf('|') + 1); return { email: em, name: tn[em] || em, idx: sec.groups[k] }; }), covered = {};
  out.forEach(function (g) { g.idx.forEach(function (i) { covered[i] = 1; }); });
  var rest = sec.students.map(function (x, i) { return i; }).filter(function (i) { return !covered[i]; });
  if (rest.length) out.push({ email: '', name: '', idx: rest });
  return out;
}
function groupCounts_(cell, idx) {
  var o = { n: 0, started: 0, finished: 0 };
  idx.forEach(function (i) { var c = cell.st.charAt(i); if (c === 'A') return; o.n++; if (c !== 'N') o.started++; if (c === 'F' || c === 'R') o.finished++; });
  return o;
}
function notTaught_(M) {
  M = M || periodModel_();
  var rem = {}; rows_('Reminders').forEach(function (r) { rem[lc_(r.teacher) + '|' + r.lessonId + '|' + r.section] = new Date(r.timestamp).toISOString(); });
  var out = [];
  M.sections.forEach(function (sec) {
    sec.lessons.forEach(function (id) {
      var cell = M.cells[sec.name + '|' + id]; if (!cell || cell.state !== 'due') return;
      slotGroups_(sec, cell.subject).forEach(function (g) {
        var k = groupCounts_(cell, g.idx); if (k.n < NOT_TAUGHT_MIN || k.started / k.n >= NOT_TAUGHT_SHARE) return;
        out.push({ teacher: g.name, email: g.email, section: sec.name, lessonId: id, week: cell.week, title: cell.title, date: cell.date, subject: cell.subject, period: cell.period,
          time: cell.time, students: k.n, started: k.started, reminded: g.email ? (rem[g.email + '|' + id + '|' + sec.name] || '') : '' });
      });
    });
  });
  return out.sort(function (a, b) { return b.date.localeCompare(a.date) || a.section.localeCompare(b.section) || a.teacher.localeCompare(b.teacher); });
}

/** Owners and SLT: the manager view – every class's AI periods with each teacher's students, and what
    each teacher has done in the app. Counting happens in the page from the per-student letters. */
function getManager() {
  var me = requireUser_();
  if (me.role !== 'owner' && me.role !== 'slt') throw new Error('Only owners and SLT can open the manager view.');
  var M = periodModel_(), T = {};
  M.sections.forEach(function (sec) {
    sec.teachers.forEach(function (t) {
      var o = T[t.email] || (T[t.email] = { email: t.email, name: t.name, subjects: [], sections: [], lastSeen: '', absences: 0, retakes: 0, tiers: 0, fixes: 0, reminders: 0, lastReminder: '', confirmed: '' });
      t.subjects.forEach(function (x) { if (o.subjects.indexOf(x) < 0) o.subjects.push(x); });
      if (o.sections.indexOf(sec.name) < 0) o.sections.push(sec.name);
    });
  });
  var iso = function (t) { return new Date(t).toISOString(); }, later = function (a, b) { return !a || new Date(b) > new Date(a) ? iso(b) : a; };
  rows_('Visits').forEach(function (r) { var o = T[lc_(r.email)]; if (o) o.lastSeen = later(o.lastSeen, r.timestamp); });
  rows_('Absences').forEach(function (r) { var o = T[lc_(r.teacher)]; if (o && r.status === 'absent') o.absences++; });
  rows_('Retakes').forEach(function (r) { var o = T[lc_(r.teacher)]; if (o) o.retakes++; });
  rows_('Judgements').forEach(function (r) { var o = T[lc_(r.teacher)]; if (o) o.tiers++; });
  rows_('Changes').forEach(function (r) { var o = T[lc_(r.by)]; if (o && (r.status === 'done' || r.status === 'pending')) o.fixes++; });
  rows_('Reminders').forEach(function (r) { var o = T[lc_(r.teacher)]; if (o) { o.reminders++; o.lastReminder = later(o.lastReminder, r.timestamp); } });
  var conf = {};
  rows_('Confirmations').forEach(function (r) { conf[r.section] = { by: lc_(r.teacher), at: iso(r.timestamp), students: Number(r.students) || 0 }; var o = T[lc_(r.teacher)]; if (o) o.confirmed = later(o.confirmed, r.timestamp); });
  return { from: M.from, now: M.now, sections: M.sections, cells: M.cells, teachers: Object.keys(T).map(function (k) { return T[k]; }).sort(function (a, b) { return a.name.localeCompare(b.name); }),
    confirmations: conf, share: Math.round(NOT_TAUGHT_SHARE * 100), min: NOT_TAUGHT_MIN, rush: { min: RUSH_MIN, pct: RUSH_PCT }, canRemind: me.role === 'owner' };
}
function reminderCc_() { return PropertiesService.getScriptProperties().getProperty('REMINDER_CC') || ''; }
/** Owners: lessons whose date has passed but which a teacher's students have not started. */
function getNotTaught() {
  var me = requireOwner_();
  var items = notTaught_(), ex = items.filter(function (x) { return x.email; });
  var sample = ex.length ? ex.filter(function (x) { return x.email === ex[0].email; }) : [{ teacher: 'Teacher Name', section: 'Boys 6', week: 2, title: 'Example lesson', lessonId: 'grade-6/main-w2-l1', date: AICAL.iso(new Date()), subject: 'Islamic', period: 6, time: '1:10–2:00', students: 18, started: 2 }];
  return { items: items, preview: reminderEmail_(sample[0].teacher, sample, me.name).html, cc: reminderCc_(), share: Math.round(NOT_TAUGHT_SHARE * 100), min: NOT_TAUGHT_MIN,
    from: PropertiesService.getScriptProperties().getProperty('NOT_TAUGHT_FROM') || NOT_TAUGHT_FROM };
}
/** Owners: one email per teacher listing their untaught lessons, with the CC list (remembered). */
function sendReminders(keys, cc) {
  var me = requireOwner_();
  if (!Array.isArray(keys) || !keys.length || keys.length > 200) throw new Error('Choose the lessons to send reminders for.');
  var ccl = String(cc || '').split(/[\s,;]+/).filter(String).map(function (x) { x = lc_(x); return x.indexOf('@') < 0 ? x + '@' + DOMAIN : x; });
  ccl.forEach(function (x) { checkEmail_(x); });
  PropertiesService.getScriptProperties().setProperty('REMINDER_CC', ccl.map(function (x) { return x.split('@')[0]; }).join(', '));
  var want = {}; keys.forEach(function (k) { want[String(k)] = 1; });
  var items = notTaught_().filter(function (x) { return x.email && want[x.email + '|' + x.lessonId + '|' + x.section]; });
  if (!items.length) throw new Error('Those lessons no longer need a reminder.');
  var byT = {}; items.forEach(function (x) { (byT[x.email] = byT[x.email] || []).push(x); });
  var sent = 0, now = new Date(), log = [];
  Object.keys(byT).forEach(function (em) {
    var L = byT[em], m = reminderEmail_(L[0].teacher, L, me.name);
    try { MailApp.sendEmail({ to: em, cc: ccl.join(','), replyTo: me.email, name: 'AISA AI Web', subject: m.subject, body: m.text, htmlBody: m.html }); }
    catch (err) {
      if (/permission|authori/i.test(String(err && err.message))) throw new Error('The app is not allowed to send email yet. In the script editor, choose authorizeEmail, click Run and then Allow – then send again.' + (sent ? ' (' + sent + ' email(s) were already sent.)' : ''));
      throw err;
    }
    sent++;
    L.forEach(function (x) { log.push([now, em, x.section, x.lessonId, me.email, ccl.join(', ')]); });
  });
  append_('Reminders', log);
  return { sent: sent, lessons: items.length };
}
/* ---------- the reminder email: AISA-branded, English and Arabic side by side, a link to each lesson ---------- */
var EMAIL_ASSETS = 'https://aisa-ai-web.github.io/AI-Lessons/assets/';    // public images (logo, Classroom icon)
var DAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var DAY_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'], MON_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
function reminderEmail_(teacher, L, owner) {
  var base = ScriptApp.getService().getUrl(), first = String(teacher || '').split(' ')[0] || 'colleague', many = L.length > 1;
  var link = function (p) { return base + '?p=' + encodeURIComponent(p); };
  var dEn = function (iso) { var p = iso.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]); return DAY_EN[d.getDay()] + ' ' + d.getDate() + ' ' + MON_EN[d.getMonth()]; };
  var dAr = function (iso) { var p = iso.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]); return DAY_AR[d.getDay()] + ' ' + d.getDate() + ' ' + MON_AR[d.getMonth()]; };
  var secAr = function (s) { return String(s).replace(/^Boys/, 'بنين').replace(/^Girls/, 'بنات'); };
  var subAr = { Arabic: 'حصة اللغة العربية', Islamic: 'حصة التربية الإسلامية' };
  var share = function (x) { return 'https://classroom.google.com/share?url=' + encodeURIComponent(link(x.lessonId)) + '&title=' + encodeURIComponent('AI Literacy – ' + x.section + ', Week ' + x.week + ': ' + x.title); };
  var subject = (many ? 'AI Lessons – ' + L.length + ' lessons not yet taught' : 'AI Lessons – ' + L[0].section + ' Week ' + L[0].week + ' not yet taught') + ' | تذكير بدروس الذكاء الاصطناعي';
  var F = 'font-family:\'DM Sans\',Arial,Helvetica,sans-serif;', FA = 'font-family:Tahoma,\'Segoe UI\',Arial,sans-serif;';
  var btn = function (href, label, solid, ar) { return '<a href="' + href + '" style="display:inline-block;margin:4px 0;padding:9px 16px;border-radius:999px;font-weight:700;font-size:13px;text-decoration:none;' + (ar ? FA : F) +
    (solid ? 'background:#21076C;color:#ffffff;border:2px solid #21076C;' : 'background:#ffffff;color:#137333;border:2px solid #F4B400;') + '">' + label + '</a>'; };
  var card = function (x, ar) {
    var when = ar ? dAr(x.date) + (x.subject ? ' · ' + (subAr[x.subject] || x.subject) : '') + (x.period ? ' · الحصة ' + x.period : '') + (x.time ? ' · <span dir="ltr">' + esc_(x.time) + '</span>' : '')
      : dEn(x.date) + (x.subject ? ' · ' + x.subject + ' period' : '') + (x.period ? ' P' + x.period : '') + (x.time ? ' · ' + esc_(x.time) : '');
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;border-collapse:separate;background:#FBF8EE;border:1px solid #EADFBF;border-' + (ar ? 'right' : 'left') + ':5px solid #D8B664;border-radius:10px"><tr><td style="padding:12px 14px;' + (ar ? FA + 'text-align:right' : F) + '" dir="' + (ar ? 'rtl' : 'ltr') + '">' +
      '<div style="font-size:12px;font-weight:700;letter-spacing:.04em;color:#7a5200;text-transform:uppercase">' + (ar ? esc_(secAr(x.section)) + ' · الأسبوع ' + x.week : esc_(x.section) + ' · Week ' + x.week) + '</div>' +
      '<div style="font-size:15px;font-weight:700;color:#21076C;margin:3px 0 4px" dir="ltr">' + esc_(x.title) + '</div>' +
      '<div style="font-size:13px;color:#555555;margin:0 0 6px">' + (ar ? 'المخطط له: ' : 'Planned for ') + when + '</div>' +
      '<div style="font-size:13px;color:#b3261e;font-weight:700;margin:0 0 8px">' + (ar ? 'بدأه ' + x.started + ' من ' + x.students + ' طلاب' : x.started + ' of ' + x.students + ' students have started it') + '</div>' +
      btn(link(x.lessonId), ar ? 'افتح الدرس ←' : 'Open the lesson →', true, ar) + ' &nbsp;' + btn(share(x), (ar ? 'شارك في Google Classroom' : 'Share to Google Classroom'), false, ar) + '</td></tr></table>';
  };
  var en = '<p style="margin:0 0 12px;font-size:15px;color:#1A1A1A">Dear ' + esc_(first) + ',</p>' +
    '<p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#1A1A1A">Our AI Lessons records show that ' + (many ? 'these AI Literacy lessons' : 'this AI Literacy lesson') + ' planned for your class' + (many ? 'es have' : ' has') + ' not been taught yet:</p>' +
    L.map(function (x) { return card(x, false); }).join('') +
    '<p style="margin:14px 0;padding:10px 12px;background:#F2EFFA;border-radius:8px;font-size:14px;line-height:1.5;color:#21076C"><b>The AI lessons are mandatory</b> for every class. Please teach ' + (many ? 'them' : 'it') + ' as soon as you can – students can still complete ' + (many ? 'them' : 'it') + ' in the app.</p>' +
    '<p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#1A1A1A">If you need any support – with the lesson, the app or finding the time – just <b>reply to this email</b> and we will help.</p>' +
    '<p style="margin:0;font-size:14px;color:#1A1A1A">Thank you,<br><b>' + esc_(owner) + '</b></p>';
  var ar = '<p style="margin:0 0 12px;font-size:15px;color:#1A1A1A">الأستاذ/ة ' + esc_(first) + ' المحترم/ة،</p>' +
    '<p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#1A1A1A">تُظهر سجلات تطبيق دروس الذكاء الاصطناعي أن ' + (many ? 'الدروس التالية المخطط لها لصفوفك لم تُدرَّس بعد:' : 'الدرس التالي المخطط له لصفّك لم يُدرَّس بعد:') + '</p>' +
    L.map(function (x) { return card(x, true); }).join('') +
    '<p style="margin:14px 0;padding:10px 12px;background:#F2EFFA;border-radius:8px;font-size:14px;line-height:1.7;color:#21076C"><b>دروس الذكاء الاصطناعي إلزامية</b> لجميع الصفوف. يُرجى ' + (many ? 'تدريسها' : 'تدريسه') + ' في أقرب وقت ممكن – ولا يزال بإمكان الطلاب ' + (many ? 'إكمالها' : 'إكماله') + ' في التطبيق.</p>' +
    '<p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#1A1A1A">إذا احتجت إلى أي دعم – في الدرس أو التطبيق أو إيجاد الوقت – <b>ردّ على هذه الرسالة</b> وسنساعدك.</p>' +
    '<p style="margin:0;font-size:14px;color:#1A1A1A">مع الشكر،<br><b>' + esc_(owner) + '</b></p>';
  var html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>@media only screen and (max-width:620px){.col{display:block!important;width:100%!important;border:0!important;box-sizing:border-box}.colar{border-top:1px solid #E6E1F5!important}}</style></head>' +
    '<body style="margin:0;padding:0;background:#F2EFFA">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2EFFA"><tr><td align="center" style="padding:24px 10px">' +
    '<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #E6E1F5">' +
    '<tr><td style="background:#21076C;padding:18px 22px;border-bottom:4px solid #D8B664"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
      '<td style="vertical-align:middle"><img src="' + EMAIL_ASSETS + 'aisa/lockup-white.png" alt="American International School in Abu Dhabi" height="40" style="display:block;height:40px;width:auto;border:0"></td>' +
      '<td align="right" style="vertical-align:middle;' + F + 'color:#ffffff;font-size:13px;font-weight:700">AI Lessons<br><span style="' + FA + 'color:#D8B664;font-weight:400">دروس الذكاء الاصطناعي</span></td></tr></table></td></tr>' +
    '<tr><td style="padding:18px 22px 6px;' + F + '"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
      '<td style="' + F + 'font-size:20px;font-weight:700;color:#21076C">⏰ Lesson reminder</td><td align="right" dir="rtl" style="' + FA + 'font-size:20px;font-weight:700;color:#21076C">⏰ تذكير بالدروس</td></tr></table></td></tr>' +
    '<tr><td style="padding:6px 10px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
      '<td class="col" width="50%" valign="top" dir="ltr" style="width:50%;padding:12px 14px;border-right:1px solid #E6E1F5;' + F + '">' + en + '</td>' +
      '<td class="col colar" width="50%" valign="top" dir="rtl" style="width:50%;padding:12px 14px;text-align:right;' + FA + '">' + ar + '</td></tr></table></td></tr>' +
    '<tr><td style="padding:14px 22px;background:#FBFAFE;border-top:1px solid #E6E1F5;text-align:center;' + F + 'font-size:13px">' +
      '<a href="' + link('calendar') + '" style="color:#21076C;font-weight:700;text-decoration:none">📅 Teaching calendar · تقويم التدريس</a> &nbsp;&nbsp;|&nbsp;&nbsp; ' +
      '<a href="' + link('dashboard') + '" style="color:#21076C;font-weight:700;text-decoration:none">📊 Dashboard · لوحة المتابعة</a></td></tr>' +
    '<tr><td style="background:#21076C;padding:14px 22px;text-align:center;' + F + 'color:#ffffff;font-size:12px">American International School in Abu Dhabi · AI Literacy, Grades 6–12<br><span style="' + FA + 'color:#D8B664">المدرسة الأمريكية الدولية في أبوظبي · الثقافة في الذكاء الاصطناعي</span></td></tr>' +
    '</table></td></tr></table></body></html>';
  var text = 'Dear ' + first + ',\n\nOur AI Lessons records show that ' + (many ? 'these AI Literacy lessons' : 'this AI Literacy lesson') + ' planned for your class' + (many ? 'es have' : ' has') + ' not been taught yet:\n\n' +
    L.map(function (x) { return '• ' + x.section + ' – Week ' + x.week + ': ' + x.title + ' (planned for ' + dEn(x.date) + (x.subject ? ', ' + x.subject + ' period' + (x.period ? ' P' + x.period : '') : '') + ') – ' + x.started + ' of ' + x.students + ' students have started it\n  Open the lesson: ' + link(x.lessonId); }).join('\n') +
    '\n\nThe AI lessons are mandatory for every class. Please teach ' + (many ? 'them' : 'it') + ' as soon as you can – students can still complete ' + (many ? 'them' : 'it') + ' in the app.\n\nIf you need any support – with the lesson, the app or finding the time – just reply to this email and we will help.\n\nThank you,\n' + owner +
    '\n\n— — —\n\nالأستاذ/ة ' + first + ' المحترم/ة،\nتُظهر سجلات تطبيق دروس الذكاء الاصطناعي أن ' + (many ? 'الدروس المخطط لها لصفوفك لم تُدرَّس بعد.' : 'الدرس المخطط له لصفّك لم يُدرَّس بعد.') + ' دروس الذكاء الاصطناعي إلزامية لجميع الصفوف. إذا احتجت إلى أي دعم، ردّ على هذه الرسالة.\n\nTeaching calendar: ' + link('calendar');
  return { subject: subject, html: html, text: text };
}
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

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
function studentMonth_(email, section, grade, per, rt, M, now, ab) {
  var cat = typeof CATALOG === 'undefined' ? [] : CATALOG, known = AICAL.SCHEDULE.some(function (r) { return r[0] === section; });
  var o = { due: 0, doneDue: 0, fin: 0, sc: 0, mx: 0, secs: 0, rushed: 0, wrong: 0, fixed: 0, bsc: 0, bmx: 0, active: false };
  cat.forEach(function (l) {
    if (l.grade !== grade) return;
    var c = per[email + '|' + l.id], finished = c && l.activities && c.done >= l.activities;
    if (c && c.lastAt >= M.from && c.lastAt < M.to) o.active = true;
    if (l.course === 'main' && known) {
      var d = AICAL.lessonDate(section, l.week), t = d ? d.getTime() : 0;
      if (t >= M.from && t < M.to && t <= now && !(ab && ab[email + '|' + l.id] && !finished)) { o.due++; if (finished) o.doneDue++; }
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
  var ab = absences_();
  Object.keys(studs).forEach(function (e) { var s = studs[e]; stats[e] = studentMonth_(e, s.section, s.grade, per, rt, M, now, ab); });
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
