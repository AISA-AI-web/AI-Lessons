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
  page = env.call('doGet', { parameter: { p } }); ok(/<h1>AI Lessons<\/h1>/.test(page.getContent()), 'unknown page falls back to index: ' + p);
}
page = env.call('doGet', { parameter: {} }); ok(/<h1>AI Lessons<\/h1>/.test(page.getContent()), 'students land on the grade selector');
env.as('t6@aisa.sch.ae'); page = env.call('doGet', { parameter: {} });
ok(/AI Teaching Calendar/.test(page.getContent()) && /"sections":\["Girls 6"\]/.test(page.getContent()), 'teachers land on the calendar with their own sections');
env.as('principal@aisa.sch.ae'); page = env.call('doGet', { parameter: {} });
ok(/AI Teaching Calendar/.test(page.getContent()) && /"sections":\[\]/.test(page.getContent()), 'SLT land on the calendar (all grades)');
page = env.call('doGet', { parameter: { p: 'index' } }); ok(/<h1>AI Lessons<\/h1>/.test(page.getContent()), 'staff can still open the grade selector');
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
env.as('s2@aisa.sch.ae'); env.call('recordScores', L, meta, [{ id: 'vocab', score: 2, max: 5 }]);
env.as('b1@aisa.sch.ae'); env.call('recordScores', 'grade-7/main-w1-l1', { title: 'G7', activities: 2, maxPoints: 10 }, [{ id: 'vocab', score: 3, max: 5 }]);
env.as('stray@aisa.sch.ae'); env.call('recordScores', L, meta, [{ id: 'vocab', score: 1, max: 5 }]);

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
  throws(() => E.call('importRoster'), /student email/, 'import asks for student emails when there is no column or pattern');
  E.ctx.PropertiesService.getScriptProperties().setProperty('STUDENT_EMAIL_PATTERN', '{id}@aisa.sch.ae');
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
  sh.Import.push(['G08AILIT1', 'Islamic', 'Three', 'Teacher', 't3@aisa.sch.ae', 'G08ISA1', 505, 5, 'New', 'Noor', 'F', 8, 'G08ISA1']);
  res = E.call('importRoster');
  ok(res.students === 4 && sh.Roster.slice(1).filter(r => r[0] === '101@aisa.sch.ae').length === 1, 're-import replaces earlier imported rows instead of duplicating');
  sh.Import[0] = H.concat(['Student Email']); sh.Import.slice(1).forEach((r, i) => r[13] = 'pupil' + i + '@aisa.sch.ae');
  res = E.call('importRoster');
  ok(sh.Roster.slice(1).some(r => r[0] === 'pupil0@aisa.sch.ae') && !sh.Roster.slice(1).some(r => r[0] === '101@aisa.sch.ae'), 'a Student Email column wins over the pattern');
  E.as('t3@aisa.sch.ae'); ok(E.ctx.currentUser_().role === 'teacher', 'imported teacher signs in as a teacher');
  E.as('pupil0@aisa.sch.ae'); ok(E.ctx.currentUser_().role === 'student' && E.ctx.currentUser_().name === 'Omar Ali', 'imported student signs in with their name');
  E.ctx.Classroom = { Courses: { list: () => ({ courses: [] }), Students: { list: () => ({}) }, Teachers: { list: () => ({}) } } };
  E.as('bbaki@aisa.sch.ae'); E.call('syncClassroom');
  ok(sh.Roster.slice(1).some(r => r[0] === 'pupil0@aisa.sch.ae'), 'syncClassroom keeps imported rows');
}
console.log('All ' + n + ' server checks passed');
