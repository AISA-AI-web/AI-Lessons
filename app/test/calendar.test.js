/* Checks school-calendar.js: holidays, the Week 1 / Week 2 cycle and lessons pushed by holidays. */
const assert = require('assert');
const A = require('../../school-calendar.js');
const d = A.parse;
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

ok(A.teachingWeek(d('2026-09-28')) === 1 && A.cycleOf(d('2026-09-28')) === 1, 'term starts in teaching week 1, cycle 1');
ok(A.teachingWeek(d('2026-09-25')) === 0 && A.slotsOn(d('2026-09-25')).length === 0, 'no AI lessons before 28 Sep');
ok(A.noSchool(d('2026-10-14')) === 'Mid-Term Break' && A.teachingWeek(d('2026-10-14')) === null, 'mid-term break is not a teaching week');
ok(/Professional Development/.test(A.noSchool(d('2026-10-19'))), 'PD days are no-school days');
ok(A.teachingWeek(d('2026-10-21')) === 3 && A.cycleOf(d('2026-10-21')) === 1, 'the cycle resumes after the break (break weeks do not count)');
ok(A.noSchool(d('2026-10-10')) === 'Weekend' && A.noSchool(d('2027-07-05')) !== null, 'weekends and days after the last day have no school');
ok(A.lessonOn('Boys 8', d('2026-09-30')) === 1 && A.lessonOn('Boys 8', d('2026-10-05')) === 2 && A.lessonOn('Boys 8', d('2026-10-21')) === 3, 'Boys 8 lessons 1–3 fall on their AI periods');
ok(A.slotsOn(d('2026-12-02')).length === 0, 'no AI periods on UAE National Day');
ok(A.lessonOn('Boys 8', d('2026-12-07')) === 9 && A.teachingWeek(d('2026-12-07')) === 10, 'a section that lost a period to a holiday is pushed back a lesson');
ok(A.taughtCount('Girls 12', d('2026-12-11')) === 10 && A.taughtCount('Boys 8', d('2026-12-11')) === 9, 'sections not hit by holidays reach lesson 10 by the end of term');
ok(A.currentLesson('Girls 6', d('2026-10-05')) === 2 && A.taughtCount('Girls 6', d('2026-10-05')) === 1, 'current lesson is this week\'s lesson even before it is taught');
ok(A.taughtSoFar('', d('2026-10-14')) === 2, 'unknown sections fall back to the last teaching week');
ok(A.eventOn(d('2027-02-03')) === 'Winter MAP & Semester Finals', 'exam weeks are flagged');
ok(/Mid-Term Break/.test(A.weekLabel(d('2026-10-14'))) && /Teaching week 3/.test(A.weekLabel(d('2026-10-22'))), 'week labels');
console.log('All ' + n + ' calendar checks passed');
