const assert = require('assert');
const { makeEnv } = require('./harness');
const env = makeEnv(), { ctx, sheets } = env;
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const throws = (f, re, m) => { assert.throws(f, re, m); n++; };

/* setup */
env.as('bbaki@aisa.sch.ae'); env.call('setup');
ok(sheets.Roles.some(r => r[0] === 'bbaki@aisa.sch.ae' && r[1] === 'owner'), 'setup makes deployer an owner');
sheets.Roles.push(['hodai@aisa.sch.ae', 'owner', '', ''], ['principal@aisa.sch.ae', 'slt', 'Principal', '']);

/* Classroom sync */
const C = {
  courses: [{ id: 'c1', name: 'Girls 6 Arabic' }, { id: 'c2', name: 'Boys 7', section: 'Islamic Studies' }, { id: 'c3', name: 'Staff PD' }, { id: 'c4', name: 'Girls Grade 4 Arabic' }, { id: 'c5', name: 'Boys 9 Social Studies' }],
  students: { c1: [['s1@aisa.sch.ae', 'Sara One'], ['s2@aisa.sch.ae', 'Sara Two']], c2: [['b1@aisa.sch.ae', 'Bilal One']] },
  teachers: { c1: [['t6@aisa.sch.ae', 'Teacher Six']], c2: [['t7@aisa.sch.ae', 'Teacher Seven']], c5: [['hodai@aisa.sch.ae', 'Social Studies Teacher']] }
};
const prof = ([e, nm]) => ({ profile: { emailAddress: e, name: { fullName: nm } } });
ctx.Classroom = { Courses: { list: () => ({ courses: C.courses }),
  Students: { list: id => ({ students: (C.students[id] || []).map(prof) }) },
  Teachers: { list: id => ({ teachers: (C.teachers[id] || []).map(prof) }) } } };
env.as('s1@aisa.sch.ae'); throws(() => env.call('syncClassroom'), /owners/, 'students cannot sync');
env.as('hodai@aisa.sch.ae'); const sync = env.call('syncClassroom');
ok(sync.rosterRows === 5, 'roster has 3 students + 2 teachers, got ' + sync.rosterRows);
const cm = Object.fromEntries(sheets.CourseMap.slice(1).map(r => [r[0], r]));
ok(cm.c1[2] === 'Girls 6' && cm.c1[3] === 'Y', 'Girls 6 mapped');
ok(cm.c2[2] === 'Boys 7' && cm.c2[3] === 'Y', 'section from course section field');
ok(cm.c3[3] === 'N' && cm.c4[3] === 'N', 'non-section and out-of-range courses excluded');
ok(cm.c5[2] === 'Boys 9' && cm.c5[3] === 'N' && /other subject/.test(cm.c5[4]), 'other-subject course in a section is excluded');
ok(!sheets.Roster.some(r => r[0] === 'hodai@aisa.sch.ae'), 'a Social Studies teacher does not become an AI teacher of that section');
sheets.Roster.push(['tut@aisa.sch.ae', 'Tutor Nine', 'teacher', 'Boys 9', 9, '', 'AI timetable – tutor', '']);
const sync2 = env.call('syncClassroom');
ok(sync2.rosterRows === 5 && sync2.keptManualRows === 1, 'second sync keeps hand-added rows');
ok(sheets.Roster.filter(r => r[0] === 'tut@aisa.sch.ae' && r[3] === 'Boys 9').length === 1, 'hand-added teacher row kept once, not duplicated');
ok(sheets.Roster.filter(r => r[0] === 's1@aisa.sch.ae').length === 1, 'synced rows are replaced, not duplicated');

/* sign-in gate */
for (const bad of ['', 'someone@gmail.com', 'x@notaisa.sch.ae', 'x@aisa.sch.ae.evil.com']) {
  env.as(bad); const out = env.call('doGet', { parameter: {} });
  ok(/Sign in with your AISA account/.test(out.getContent()), 'blocked: ' + (bad || '(none)'));
  throws(() => env.call('recordTime', 'grade-6/main-w1-l1', 30), /Only @aisa/, 'API blocked: ' + (bad || '(none)'));
}
env.as('S1@AISA.SCH.AE'); ok(ctx.currentUser_().email === 's1@aisa.sch.ae', 'email is case-normalised');

/* page serving */
env.as('s1@aisa.sch.ae');
let page = env.call('doGet', { parameter: { p: 'grade-6/main-w1-l1' } });
ok(/window\.APP = CFG/.test(page.getContent()) && /"email":"s1@aisa.sch.ae"/.test(page.getContent()), 'bridge injected with user');
ok(/"role":"student"/.test(page.getContent()) && /"name":"Sara One"/.test(page.getContent()), 'name and role from roster');
for (const p of ['../Code', 'site/../Code', 'bridge', 'dashboard2', 'grade-6/../../x']) {
  page = env.call('doGet', { parameter: { p } }); ok(/<title>AI Lessons<\/title>/.test(page.getContent()), 'unknown page falls back to index: ' + p);
}
page = env.call('doGet', { parameter: {} }); ok(/<title>AI Lessons<\/title>/.test(page.getContent()), 'students land on their home page');
ok(/"section":"Girls 6"/.test(page.getContent()) && /"grade":6/.test(page.getContent()), 'students get their class and grade for the home page');
page = env.call('doGet', { parameter: { p: 'calendar' } }); ok(/<title>AI Lessons<\/title>/.test(page.getContent()), 'the calendar is for staff: students opening it get their home page');
ok(/data-shell/.test(page.getContent()) && /data:image\/png;base64,/.test(page.getContent()) && !/src="school-calendar.js"/.test(page.getContent()), 'home page served with its shell, logos and calendar inlined');
env.as('t6@aisa.sch.ae'); page = env.call('doGet', { parameter: {} });
ok(/<title>AI Teaching Calendar<\/title>/.test(page.getContent()) && /"sections":\["Girls 6"\]/.test(page.getContent()), 'teachers land on the calendar with their own sections');
env.as('principal@aisa.sch.ae'); page = env.call('doGet', { parameter: {} });
ok(/<title>AI Teaching Calendar<\/title>/.test(page.getContent()) && /"sections":\[\]/.test(page.getContent()), 'SLT land on the calendar (all grades)');
page = env.call('doGet', { parameter: { p: 'index' } }); ok(/<title>AI Lessons<\/title>/.test(page.getContent()), 'staff can still open the home page');
env.as('s1@aisa.sch.ae');
page = env.call('doGet', { parameter: { p: 'dashboard' } }); ok(/AI Curriculum Dashboard/.test(page.getContent()), 'dashboard served');

/* scores */
const L = 'grade-6/main-w1-l1', meta = { title: 'G6 lesson', activities: 3, maxPoints: 20 };
ok(env.call('recordScores', L, meta, [{ id: 'vocab', title: 'Words', part: 'Core', score: 4, max: 5 }, { id: 'sort', title: '=HYPERLINK("x")', part: 'Core', score: 9, max: 6 }]).saved === 2, 'two first scores saved');
ok(env.call('recordScores', L, meta, [{ id: 'vocab', score: 5, max: 5 }]).saved === 0, 'retry cannot overwrite first try');
const srow = sheets.Scores.find(r => r[3] === 'sort');
ok(srow[6] === 6, 'score clamped to max'); ok(srow[4].startsWith("'="), 'formula injection neutralised');
throws(() => env.call('recordScores', 'grade-6/../../secret', meta, [{ id: 'a', score: 1, max: 1 }]), /Unknown lesson/, 'bad lesson id rejected');
ok(JSON.stringify(env.call('getLessonState', L).done) === JSON.stringify({ vocab: 4, sort: 6 }), 'lesson state returns recorded scores');
ok(sheets.Lessons.some(r => r[0] === L && r[1] === 6 && r[2] === 'main' && r[3] === 1), 'lesson registered with grade/course/week');
ok(env.call('recordTime', L, 60).saved === 60 && env.call('recordTime', L, 99999).saved === 300, 'time recorded and capped');
let mp = env.call('getMyProgress').lessons; ok(mp[L] && mp[L].done === 2 && mp[L].score === 10 && mp[L].max === 11, 'home page progress: first tries per lesson');
env.as('s2@aisa.sch.ae'); env.call('recordScores', L, meta, [{ id: 'vocab', score: 2, max: 5 }]);
env.as('b1@aisa.sch.ae'); env.call('recordScores', 'grade-7/main-w1-l1', { title: 'G7', activities: 2, maxPoints: 10 }, [{ id: 'vocab', score: 3, max: 5 }]);
env.as('stray@aisa.sch.ae'); env.call('recordScores', L, meta, [{ id: 'vocab', score: 1, max: 5 }]);
env.as('s2@aisa.sch.ae'); mp = env.call('getMyProgress').lessons; ok(mp[L].done === 1 && mp[L].score === 2 && Object.keys(mp).length === 1, 'home page progress shows only your own work');

/* dashboard visibility */
const dash = e => { env.as(e); return env.call('getDashboard'); };
let d = dash('s1@aisa.sch.ae');
ok(d.scope === 'self' && d.students.length === 1 && d.results.every(r => r.email === 's1@aisa.sch.ae'), 'student sees only self');
ok(d.results[0].score === 10 && d.results[0].seconds === 360, 'student totals: score 10, 360 s');
d = dash('t6@aisa.sch.ae');
ok(d.scope === 'sections' && d.sections.join() === 'Girls 6', 'teacher scope = own section');
ok(d.students.map(s => s.email).sort().join() === 's1@aisa.sch.ae,s2@aisa.sch.ae', 'teacher sees only Girls 6 students');
ok(!d.results.some(r => r.email === 'b1@aisa.sch.ae' || r.email === 'stray@aisa.sch.ae'), 'teacher cannot see other sections or unassigned');
d = dash('t7@aisa.sch.ae'); ok(d.students.map(s => s.email).join() === 'b1@aisa.sch.ae', 'Boys 7 teacher sees only Boys 7');
d = dash('principal@aisa.sch.ae');
ok(d.scope === 'school' && d.students.length === 4 && d.sections.includes('Unassigned'), 'SLT sees whole school incl. unassigned');
d = dash('hodai@aisa.sch.ae'); ok(d.scope === 'school', 'owner sees whole school');
d = dash('nobody@aisa.sch.ae'); ok(d.scope === 'self' && d.students.length === 0 && d.results.length === 0, 'unknown staff with no data sees nothing');
/* final scores ("answers fixed") */
env.as('s1@aisa.sch.ae');
ok(env.call('recordLatest', L, [{ id: 'vocab', score: 5, max: 5 }]).saved === 1, 'latest score saved');
env.call('recordLatest', L, [{ id: 'vocab', score: 3, max: 5 }, { id: 'vocab', score: 5, max: 5 }]);
ok(env.call('getLessonState', L).latest.vocab === 5, 'lesson state returns latest score');
ok(env.call('getLessonState', L).done.vocab === 4, 'first try unchanged by later scores');
throws(() => env.call('recordLatest', '../x', [{ id: 'a', score: 1, max: 1 }]), /Unknown lesson/, 'latest: bad lesson rejected');
d = dash('s1@aisa.sch.ae');
const v = d.results.find(r => r.lessonId === L).acts.vocab;
ok(v[0] === 4 && v[4] === 5, 'dashboard shows first 4 and latest 5');
const lessonFiles = require('fs').readdirSync(require('path').join(__dirname, '..', '..')).filter(f => /^grade-\d+$/.test(f))
  .flatMap(g => require('fs').readdirSync(require('path').join(__dirname, '..', '..', g)).filter(f => /^(main|bridging)-w\d+-.+\.html$/.test(f)));
ok(d.catalog.length === lessonFiles.length && d.catalog.some(c => c.id === L && c.activities === 22), 'catalog lists every lesson (' + lessonFiles.length + ') with activity counts');
ok(d.termStart === '2026-09-28', 'term start sent');
env.as('t7@aisa.sch.ae'); ok(!dash('t7@aisa.sch.ae').results.some(r => r.email === 's1@aisa.sch.ae'), 'latest scores still respect teacher scope');
/* teacher judgements (tiers) */
env.as('t6@aisa.sch.ae'); ok(env.call('setJudgement', 's1@aisa.sch.ae', 'CU', 'A', 'Showcase rubric').saved, 'teacher records a tier for own student');
throws(() => env.call('setJudgement', 'b1@aisa.sch.ae', 'CU', 'A', ''), /students you teach/, 'teacher cannot judge another section');
throws(() => env.call('setJudgement', 's1@aisa.sch.ae', 'XX', 'A', ''), /Unknown strand/, 'bad strand rejected');
throws(() => env.call('setJudgement', 's1@aisa.sch.ae', 'CU', 'Z', ''), /Unknown tier/, 'bad tier rejected');
env.as('s1@aisa.sch.ae'); throws(() => env.call('setJudgement', 's1@aisa.sch.ae', 'CU', 'A', ''), /Only teachers/, 'students cannot judge');
d = dash('s1@aisa.sch.ae'); ok(d.judgements['s1@aisa.sch.ae|CU'].tier === 'A' && !d.canJudge, 'student sees own judgement, cannot edit');
ok(d.framework && d.framework['6'].strands[0].code === 'CU' && /rule-based/.test(d.framework['6'].strands[0].E), 'private framework descriptors reach the dashboard');
env.as('principal@aisa.sch.ae'); env.call('setJudgement', 's1@aisa.sch.ae', 'CU', '', 'cleared');
ok(!dash('t6@aisa.sch.ae').judgements['s1@aisa.sch.ae|CU'], 'clearing a judgement restores the automatic tier');
ok(Object.keys(dash('t7@aisa.sch.ae').judgements).every(k => k.startsWith('b1@')), 'judgements respect teacher scope');
/* roster import from the school information system (fresh environment) */
{
  const E = makeEnv(), sh = E.sheets;
  E.as('bbaki@aisa.sch.ae'); E.call('setup');
  const H = ['AI Course', 'Subject', 'Instructor Last Name', 'Instructor First Name', 'Email Address', 'Class Name', 'Student ID', 'ESIS Number', 'Student Last Name', 'Student First Name', 'Student Gender', 'Student Grade', 'Course Number'];
  sh.Import = [H,
    ['B06AILIT1', 'Arabic', 'One', 'Teacher', 'T1@aisa.sch.ae', 'B06ASL', 101, 1, 'Ali', 'Omar', 'M', 6, 'B06ASL'],
    ['B06AILIT2', 'Islamic', 'Two', 'Teacher', 't2@aisa.sch.ae', 'B06ISA1', 101, 1, 'Ali', 'Omar', 'M', 6, 'B06ISA1'],
    ['B12AILIT1', 'Arabic', 'One', 'Teacher', 't1@aisa.sch.ae', '12ASL', 202, 2, 'Saeed', 'Mariam', 'F', 12, '12ASL'],
    ['G07AILIT1', 'Islamic', 'Three', 'Teacher', 't3@aisa.sch.ae', 'G07TUT', 303, 3, '=cmd', 'Huda', 'F', 7, 'G07TUT'],
    ['X', 'Arabic', 'Four', 'Teacher', 't4@aisa.sch.ae', 'K', 404, 4, 'Small', 'Kid', 'M', 4, 'K']];
  E.as('s1@aisa.sch.ae'); throws(() => E.call('importRoster'), /owners/, 'students cannot import');
  E.as('bbaki@aisa.sch.ae');
  sh.Roster.push(['hand@aisa.sch.ae', 'Hand Added', 'teacher', 'Boys 9', 9, '', 'AI timetable', '']);
  let res = E.call('importRoster');
  ok(res.students === 3 && res.teachers === 3 && res.skipped === 1 && res.keptOtherRows === 1, 'import counts students, teachers, skipped rows: ' + JSON.stringify(res));
  const R = sh.Roster.slice(1).filter(r => r[0]);
  ok(R.some(r => r[0] === '101@aisa.sch.ae' && r[2] === 'student' && r[3] === 'Boys 6' && r[1] === 'Omar Ali' && r[6] === 'B06ASL, B06ISA1'), 'student gets one row with section and both classes');
  ok(R.filter(r => r[0] === 't1@aisa.sch.ae').map(r => r[3]).sort().join() === 'Boys 6,Girls 12', 'teacher email lower-cased; sections come from the students they teach (mixed class adds Girls 12)');
  ok(R.some(r => r[0] === '303@aisa.sch.ae' && r[3] === 'Girls 7') && R.some(r => r[0] === 't3@aisa.sch.ae' && r[3] === 'Girls 7'), 'tutorial classes are included');
  ok(!R.some(r => r[0] === '404@aisa.sch.ae'), 'grades outside 6–12 are skipped');
  ok(R.some(r => r[0] === 'hand@aisa.sch.ae'), 'hand-added rows are kept');
  ok(R.find(r => r[0] === '303@aisa.sch.ae')[1].startsWith('Huda'), 'names imported');
  const saved = sh.Import.slice();
  sh.Import = [['AISA export'], [], saved[0].map(h => ' ' + h.replace(' ', '\u00a0') + ' ')].concat(saved.slice(1));
  ok(E.call('importRoster').students === 3, 'header row found below a title row, with odd spaces');
  sh.Import = [['Name', 'Grade']]; throws(() => E.call('importRoster'), /First row found: name \| grade/, 'missing header explains what was found');
  sh.Import = saved;
  ok(R.some(r => r[0] === '202@aisa.sch.ae'), 'with no email column, student emails default to {id}@aisa.sch.ae');
  sh.Import.push(['G08AILIT1', 'Islamic', 'Three', 'Teacher', 't3@aisa.sch.ae', 'G08ISA1', 505, 5, 'New', 'Noor', 'F', 8, 'G08ISA1']);
  res = E.call('importRoster');
  ok(res.students === 4 && sh.Roster.slice(1).filter(r => r[0] === '101@aisa.sch.ae').length === 1, 're-import replaces earlier imported rows instead of duplicating');
  E.ctx.PropertiesService.getScriptProperties().setProperty('STUDENT_EMAIL_PATTERN', '{first}.{last}@aisa.sch.ae');
  E.call('importRoster'); ok(sh.Roster.slice(1).some(r => r[0] === 'omar.ali@aisa.sch.ae'), 'STUDENT_EMAIL_PATTERN overrides the default');
  sh.Import[0] = H.concat(['Student Email']); sh.Import.slice(1).forEach((r, i) => r[13] = 'pupil' + i + '@aisa.sch.ae');
  res = E.call('importRoster');
  ok(sh.Roster.slice(1).some(r => r[0] === 'pupil0@aisa.sch.ae') && !sh.Roster.slice(1).some(r => r[0] === '101@aisa.sch.ae'), 'a Student Email column wins over the pattern');
  E.as('t3@aisa.sch.ae'); ok(E.ctx.currentUser_().role === 'teacher', 'imported teacher signs in as a teacher');
  E.as('pupil0@aisa.sch.ae'); ok(E.ctx.currentUser_().role === 'student' && E.ctx.currentUser_().name === 'Omar Ali', 'imported student signs in with their name');
  E.ctx.Classroom = { Courses: { list: () => ({ courses: [] }), Students: { list: () => ({}) }, Teachers: { list: () => ({}) } } };
  E.as('bbaki@aisa.sch.ae'); E.call('syncClassroom');
  ok(sh.Roster.slice(1).some(r => r[0] === 'pupil0@aisa.sch.ae'), 'syncClassroom keeps imported rows');
}
/* class lists: transfer, add, request, confirm (fresh environment) */
{
  const E = makeEnv(), sh = E.sheets;
  E.as('bbaki@aisa.sch.ae'); E.call('setup');
  sh.Roles.push(['head@aisa.sch.ae', 'slt', 'Head', '']);
  sh.Roster.push(
    ['ta@aisa.sch.ae', 'Teacher A', 'teacher', 'Boys 6', 6, 'sis', '', ''], ['tb@aisa.sch.ae', 'Teacher B', 'teacher', 'Boys 7', 7, 'sis', '', ''],
    ['101@aisa.sch.ae', 'Omar Ali', 'student', 'Boys 6', 6, 'sis', '', ''], ['102@aisa.sch.ae', 'Zaid Noor', 'student', 'Boys 6', 6, 'sis', '', ''],
    ['201@aisa.sch.ae', 'Sami Kh', 'student', 'Boys 7', 7, 'sis', '', '']);
  const sec = e => sh.Roster.slice(1).filter(r => r[0] === e && r[2] === 'student').map(r => r[3]).join();
  E.as('101@aisa.sch.ae'); throws(() => E.call('transferStudent', '102@aisa.sch.ae', 'Boys 7', ''), /own classes/, 'students cannot transfer');
  E.as('tb@aisa.sch.ae'); throws(() => E.call('transferStudent', '101@aisa.sch.ae', 'Boys 7', ''), /own classes/, 'a teacher cannot move a student out of someone else\'s class');
  E.as('ta@aisa.sch.ae');
  throws(() => E.call('transferStudent', '101@aisa.sch.ae', 'Year 6', ''), /Unknown class/, 'transfer target must be a real class');
  let r = E.call('transferStudent', '102@aisa.sch.ae', 'Boys 7', 'wrong section');
  ok(r.moved && sec('102@aisa.sch.ae') === 'Boys 7' && sh.Roster.find(x => x[0] === '102@aisa.sch.ae')[4] === 7, 'teacher moves their own student; section and grade update');
  ok(sh.Changes.slice(1).some(c => c[1] === 'transfer' && c[2] === '102@aisa.sch.ae' && c[4] === 'Boys 6' && c[5] === 'Boys 7' && c[6] === 'ta@aisa.sch.ae' && c[7] === 'done'), 'transfer is logged with who, from and to');
  throws(() => E.call('addStudent', '999@gmail.com', 'X Y', 'Boys 6', ''), /@aisa/, 'only school emails can be added');
  throws(() => E.call('addStudent', '150@aisa.sch.ae', 'New Kid', 'Boys 7', ''), /own classes/, 'cannot add to someone else\'s class');
  r = E.call('addStudent', '150@aisa.sch.ae', '=New Kid', 'Boys 6', '');
  ok(r.added && sec('150@aisa.sch.ae') === 'Boys 6' && String(sh.Roster.find(x => x[0] === '150@aisa.sch.ae')[1]).startsWith("'"), 'new student added straight away (formula-safe)');
  throws(() => E.call('addStudent', '150@aisa.sch.ae', 'New Kid', 'Boys 6', ''), /already in Boys 6/, 'cannot add a student twice');
  r = E.call('addStudent', '201@aisa.sch.ae', '', 'Boys 6', 'in my class every day');
  ok(r.requested && sec('201@aisa.sch.ae') === 'Boys 7', 'a student in another class becomes a request, not a move');
  throws(() => E.call('addStudent', '201@aisa.sch.ae', '', 'Boys 6', ''), /already a request/, 'no duplicate requests');
  let d = E.call('getDashboard'), req = d.roster.requests[0];
  ok(req && req.to === 'Boys 6' && req.from === 'Boys 7' && !req.canDecide, 'the requesting teacher sees the request but cannot approve it');
  throws(() => E.call('decideRequest', req.id, true, ''), /teacher, an owner or SLT/, 'requesting teacher cannot approve their own request');
  E.as('tb@aisa.sch.ae'); d = E.call('getDashboard');
  ok(d.roster.requests[0].canDecide, 'the student\'s current teacher can decide');
  ok(E.call('decideRequest', req.id, true, 'agreed').decided === 'approved' && sec('201@aisa.sch.ae') === 'Boys 6', 'approving moves the student');
  throws(() => E.call('decideRequest', req.id, false, ''), /already been decided/, 'a request is decided once');
  E.as('ta@aisa.sch.ae');
  r = E.call('confirmRoster', 'Boys 6', '');
  ok(r.confirmed && r.students === 3, 'confirming records the class size');
  throws(() => E.call('confirmRoster', 'Boys 7', ''), /own classes/, 'cannot confirm someone else\'s class');
  d = E.call('getDashboard');
  ok(d.roster.confirmations['Boys 6'] && !d.roster.confirmations['Boys 6'].changedSince, 'confirmation shows on the dashboard');
  sh.Confirmations[sh.Confirmations.length - 1][0] = new Date(Date.now() - 1000);   // confirmed a moment earlier
  E.call('transferStudent', '150@aisa.sch.ae', 'Girls 6', '');
  ok(E.call('getDashboard').roster.confirmations['Boys 6'].changedSince, 'a later change flags the list as changed since confirmation');
  E.as('head@aisa.sch.ae'); ok(E.call('transferStudent', '201@aisa.sch.ae', 'Boys 7', 'back').moved, 'SLT can move any student');
  // a fresh import from IT keeps the corrections
  sh.Import = [['Student ID', 'Student First Name', 'Student Last Name', 'Student Gender', 'Student Grade', 'Email Address', 'Class Name'],
    [101, 'Omar', 'Ali', 'M', 6, 'ta@aisa.sch.ae', 'B06'], [102, 'Zaid', 'Noor', 'M', 6, 'ta@aisa.sch.ae', 'B06'], [201, 'Sami', 'Kh', 'M', 7, 'tb@aisa.sch.ae', 'B07']];
  E.as('bbaki@aisa.sch.ae'); r = E.call('importRoster');
  ok(sec('102@aisa.sch.ae') === 'Boys 7' && sec('201@aisa.sch.ae') === 'Boys 7' && r.classListFixesKept >= 1, 're-import keeps teachers\' transfers');
  ok(sec('150@aisa.sch.ae') === 'Girls 6', 'students added by teachers survive a re-import');
}
/* students only open Main course lessons their class has reached */
{
  const E = makeEnv(), RealDate = Date;
  const at = iso => { E.ctx.Date = class extends RealDate { constructor(...a) { a.length ? super(...a) : super(iso + 'T09:00:00'); } static now() { return new RealDate(iso + 'T09:00:00').getTime(); } }; };
  E.as('bbaki@aisa.sch.ae'); E.call('setup');
  E.sheets.Roster.push(['g8@aisa.sch.ae', 'Boy Eight', 'student', 'Boys 8', 8, 'sis', '', ''], ['t8@aisa.sch.ae', 'Teacher Eight', 'teacher', 'Boys 8', 8, 'sis', '', '']);
  const open = (who, p) => { E.as(who); return !/Not open yet/.test(E.call('doGet', { parameter: { p } }).getContent()); };
  at('2026-10-06');
  ok(open('g8@aisa.sch.ae', 'grade-8/main-w2-l1'), 'a student can open this week\'s lesson');
  ok(!open('g8@aisa.sch.ae', 'grade-8/main-w3-l1'), 'a student cannot open next week\'s lesson');
  ok(/Monday 19 October 2026/.test((E.as('g8@aisa.sch.ae'), E.call('doGet', { parameter: { p: 'grade-8/main-w3-l1' } }).getContent())), 'the locked page says when it opens');
  ok(open('t8@aisa.sch.ae', 'grade-8/main-w10-l1') && open('bbaki@aisa.sch.ae', 'grade-12/main-w10-l1'), 'teachers and owners can open every week');
  ok(open('g8@aisa.sch.ae', 'grade-9/bridging-w1-l1'), 'bridging lessons are not timetabled, so they are not locked');
  E.as('g8@aisa.sch.ae'); const cfg = /var CFG = (\{.*?\});/.exec(E.call('doGet', { parameter: { p: 'index' } }).getContent());
  ok(cfg && JSON.parse(cfg[1]).locked['grade-8/main-w3-l1'] && !JSON.parse(cfg[1]).locked['grade-8/main-w2-l1'], 'the index gets the list of locked lessons');
  at('2026-12-01');
  ok(open('g8@aisa.sch.ae', 'grade-8/main-w8-l1') && !open('g8@aisa.sch.ae', 'grade-8/main-w9-l1'), 'a National Day push keeps Week 9 locked for Boys 8 until its new week');
  at('2026-12-07');
  ok(open('g8@aisa.sch.ae', 'grade-8/main-w9-l1'), 'Week 9 opens on the Monday of the week Boys 8 are taught it');
  E.sheets.Roster.push(['new@aisa.sch.ae', 'New Student', 'student', '', '', 'sis', '', '']);
  at('2026-10-06');
  ok(open('new@aisa.sch.ae', 'grade-9/main-w2-l1') && !open('new@aisa.sch.ae', 'grade-9/main-w4-l1'), 'a student not yet on a class list follows the school timetable');
}
/* a section split between teachers: each sees their own class first, can see the whole section,
   and can move a wrongly listed student into their own class (fresh environment) */
{
  const E = makeEnv(), sh = E.sheets;
  E.as('bbaki@aisa.sch.ae'); E.call('setup');
  sh.Roster.push(
    ['t1@aisa.sch.ae', 'Teacher One', 'teacher', 'Boys 8', 8, 'sis', '8B1', ''], ['t2@aisa.sch.ae', 'Teacher Two', 'teacher', 'Boys 8', 8, 'sis', '8B2', ''],
    ['t0@aisa.sch.ae', 'Teacher Zero', 'teacher', 'Boys 9', 9, '', '', ''],
    ['801@aisa.sch.ae', 'Ali A', 'student', 'Boys 8', 8, 'sis', '8B1', ''], ['802@aisa.sch.ae', 'Badr B', 'student', 'Boys 8', 8, 'sis', '8B1', ''],
    ['803@aisa.sch.ae', 'Fahad F', 'student', 'Boys 8', 8, 'sis', '8B2', ''], ['804@aisa.sch.ae', 'Hadi H', 'student', 'Boys 8', 8, '', '', ''],
    ['901@aisa.sch.ae', 'Omar O', 'student', 'Boys 9', 9, 'sis', '9B1', '']);
  const mine = e => { E.as(e); const d = E.call('getDashboard'); return d.students.filter(s => s.mine).map(s => s.email.slice(0, 3)).sort().join(); };
  E.as('t1@aisa.sch.ae'); let d = E.call('getDashboard');
  ok(d.students.length === 4, 'a teacher can still see the whole section (Show all)');
  ok(mine('t1@aisa.sch.ae') === '801,802,804', 'Teacher One\'s own students: their class, plus a student with no class name');
  ok(mine('t2@aisa.sch.ae') === '803,804', 'Teacher Two\'s own students');
  ok(d.myClasses['Boys 8'].join() === '8B1' && d.students.find(s => s.email === '803@aisa.sch.ae').classes.join() === '8B2', 'the dashboard gets class names');
  ok(mine('t0@aisa.sch.ae') === '901', 'a teacher with no class names sees the whole section as their own');
  E.as('t1@aisa.sch.ae');
  throws(() => E.call('setJudgement', '803@aisa.sch.ae', 'CU', 'A', ''), /students you teach/, 'no judgement for another teacher\'s student in the same section');
  ok(E.call('setJudgement', '804@aisa.sch.ae', 'CU', 'A', '').saved, 'judgement for a student with no class name is allowed');
  throws(() => E.call('claimStudent', '803@aisa.sch.ae', '8B2', ''), /own classes/, 'cannot move a student into a class that is not yours');
  throws(() => E.call('claimStudent', '901@aisa.sch.ae', '8B1', ''), /Add or request/, 'a student from another section needs a request');
  let r = E.call('claimStudent', '803@aisa.sch.ae', '8B1', 'listed with the wrong teacher');
  ok(r.moved && r.from === '8B2' && r.to === '8B1', 'a teacher moves a student into their own class');
  ok(sh.Changes[0].length === 13 && sh.Changes.slice(1).some(c => c[1] === 'class' && c[2] === '803@aisa.sch.ae' && c[11] === '8B2' && c[12] === '8B1' && c[6] === 't1@aisa.sch.ae'), 'the class move is logged with from and to class');
  ok(mine('t1@aisa.sch.ae') === '801,802,803,804' && mine('t2@aisa.sch.ae') === '804', 'after the move the student is Teacher One\'s, not Teacher Two\'s');
  E.as('t1@aisa.sch.ae'); throws(() => E.call('claimStudent', '803@aisa.sch.ae', '8B1', ''), /already in 8B1/, 'no double move');
  ok(E.call('getDashboard').roster.recent.some(c => c.type === 'class' && c.toClass === '8B1'), 'the class move shows in recent changes');
  E.as('803@aisa.sch.ae'); throws(() => E.call('claimStudent', '803@aisa.sch.ae', '8B1', ''), /own classes/, 'students cannot move themselves');
  E.as('t2@aisa.sch.ae'); ok(E.call('addStudent', '805@aisa.sch.ae', 'New Boy', 'Boys 8', '').cls === '8B2' && mine('t2@aisa.sch.ae') === '804,805', 'a student a teacher adds goes into that teacher\'s class');
  sh.Roster.push(['bbaki@aisa.sch.ae', '', 'teacher', 'Boys 8', 8, '', '', '']);
  E.as('bbaki@aisa.sch.ae'); ok(E.call('getDashboard').students.every(s => s.mine), 'owners see everyone as theirs');
}
/* Google's HtmlService cuts script lines at '//', even inside a quoted web address, so no
   inline script the app serves may contain '://' (build.py writes it as ':\/\/'). */
{
  const fs = require('fs'), path = require('path'), B = path.join(__dirname, '..', 'build');
  const pages = ['dashboard.html', 'bridge.html'].concat(fs.readdirSync(path.join(B, 'site'), { recursive: true }).filter(f => /\.html$/.test(f)).map(f => path.join('site', f)));
  const hits = pages.filter(p => [...fs.readFileSync(path.join(B, p), 'utf8').matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].some(m => m[1].includes('://')));
  ok(hits.length === 0, 'no inline script contains :// (Google would cut the line): ' + hits.join(', '));
  ok(fs.statSync(path.join(B, 'bridge.html')).size > 1000, 'the built bridge is not empty');
}
console.log('All ' + n + ' server checks passed');
