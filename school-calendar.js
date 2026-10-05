/* AISA 2026–27 school calendar + Secondary AI Literacy timetable.
   Shared by calendar.html and the signed-in dashboard (build.py inlines it there).

   How lessons are counted: each section has one AI Literacy period a week. Its
   n-th period on a real school day teaches Main course Week n. A period that falls
   on a holiday, break or PD day does not happen, so that section's next lesson is
   simply pushed to its next period. */
var AICAL = (function () {
  var TERM_START = '2026-09-28';   // Monday of AI Literacy Week 1
  var YEAR_END = '2027-07-02';     // ADEK last day of school
  /* true: a week with no school days at all (e.g. Mid-Term Break) does not advance
     the Week 1 / Week 2 timetable cycle – the cycle resumes where it left off. */
  var CYCLE_SKIPS_BREAKS = true;

  /* Weekdays with no school for students (from the ADEK-approved AISA calendar). */
  var NO_SCHOOL = [
    ['2026-10-12', '2026-10-16', 'Mid-Term Break'],
    ['2026-10-19', '2026-10-20', 'Professional Development – no school for students'],
    ['2026-12-02', '2026-12-03', 'UAE National Day'],
    ['2026-12-14', '2027-01-01', 'Winter Break'],
    ['2027-03-08', '2027-03-11', 'Eid Al-Fitr (dates to be confirmed)'],
    ['2027-03-15', '2027-03-15', 'Professional Development – no school for students'],
    ['2027-04-05', '2027-04-09', 'Spring Break'],
    ['2027-05-17', '2027-05-17', 'Arafat Day & Eid Al-Adha (dates to be confirmed)']
  ];
  /* School is open, but worth knowing when planning a lesson. */
  var EVENTS = [
    ['2026-11-09', '2026-11-09', 'Parent-Teacher Conferences'],
    ['2027-02-01', '2027-02-05', 'Winter MAP & Semester Finals'],
    ['2027-04-23', '2027-04-23', 'IB Exams begin'],
    ['2027-05-03', '2027-05-03', 'Parent-Teacher Conferences'],
    ['2027-05-19', '2027-05-19', 'IB Exams end'],
    ['2027-05-31', '2027-06-04', 'Spring MAP'],
    ['2027-06-23', '2027-06-30', 'End-of-Year Semester Exams'],
    ['2027-07-02', '2027-07-02', 'Last day of school']
  ];

  /* Section, grade, subject, cycle week (1/2), day, period, time – AISA Secondary AI Literacy Timetable */
  var SCHEDULE = [["Boys 6", 6, "Arabic", 1, "Wed", 7, "2:05 - 2:55"], ["Boys 7", 7, "Arabic", 1, "Wed", 2, "8:50 - 9:40"], ["Girls 7", 7, "Islamic", 1, "Wed", 1, "7:55 - 8:45"], ["Boys 8", 8, "Arabic", 1, "Wed", 5, "11:55 - 12:45"], ["Girls 8", 8, "Islamic", 1, "Wed", 6, "1:10 - 2:00"], ["Boys 10", 10, "Islamic", 1, "Thu", 6, "1:10 - 2:00"], ["Girls 6", 6, "Arabic", 1, "Fri", 2, "8:35 - 9:25"], ["Boys 9", 9, "Arabic", 1, "Fri", 4, "10:40 - 11:30"], ["Girls 9", 9, "Arabic", 1, "Fri", 3, "9:45 - 10:35"], ["Girls 10", 10, "Arabic", 1, "Fri", 2, "8:35 - 9:25"], ["Boys 11", 11, "Arabic", 1, "Fri", 3, "9:45 - 10:35"], ["Girls 11", 11, "Islamic", 1, "Fri", 4, "10:40 - 11:30"], ["Boys 12", 12, "Arabic", 1, "Fri", 1, "7:40 - 8:30"], ["Girls 12", 12, "Arabic", 1, "Fri", 1, "7:40 - 8:30"], ["Boys 8", 8, "Islamic", 2, "Mon", 7, "2:05 - 2:55"], ["Boys 6", 6, "Islamic", 2, "Wed", 6, "1:10 - 2:00"], ["Boys 7", 7, "Islamic", 2, "Wed", 2, "8:50 - 9:40"], ["Boys 10", 10, "Arabic", 2, "Wed", 4, "11:00 - 11:50"], ["Boys 11", 11, "Islamic", 2, "Wed", 7, "2:05 - 2:55"], ["Boys 12", 12, "Islamic", 2, "Wed", 1, "7:55 - 8:45"], ["Girls 12", 12, "Islamic", 2, "Wed", 1, "7:55 - 8:45"], ["Girls 6", 6, "Islamic", 2, "Fri", 4, "10:40 - 11:30"], ["Girls 7", 7, "Arabic", 2, "Fri", 1, "7:40 - 8:30"], ["Girls 8", 8, "Arabic", 2, "Fri", 2, "8:35 - 9:25"], ["Boys 9", 9, "Islamic", 2, "Fri", 3, "9:45 - 10:35"], ["Girls 9", 9, "Islamic", 2, "Fri", 2, "8:35 - 9:25"], ["Girls 10", 10, "Islamic", 2, "Fri", 1, "7:40 - 8:30"], ["Girls 11", 11, "Arabic", 2, "Fri", 3, "9:45 - 10:35"]];

  /* Arabic for the calendar labels above (the pages can switch to Arabic). */
  var AR_LABELS = {
    'Mid-Term Break': 'إجازة منتصف الفصل',
    'Professional Development – no school for students': 'تطوير مهني – لا دوام للطلاب',
    'UAE National Day': 'اليوم الوطني لدولة الإمارات',
    'Winter Break': 'العطلة الشتوية',
    'Eid Al-Fitr (dates to be confirmed)': 'عيد الفطر (التواريخ قيد التأكيد)',
    'Spring Break': 'عطلة الربيع',
    'Arafat Day & Eid Al-Adha (dates to be confirmed)': 'يوم عرفة وعيد الأضحى (التواريخ قيد التأكيد)',
    'Parent-Teacher Conferences': 'اجتماعات أولياء الأمور والمعلمين',
    'Winter MAP & Semester Finals': 'اختبارات MAP الشتوية والاختبارات النهائية للفصل',
    'IB Exams begin': 'بداية امتحانات البكالوريا الدولية',
    'IB Exams end': 'نهاية امتحانات البكالوريا الدولية',
    'Spring MAP': 'اختبارات MAP الربيعية',
    'End-of-Year Semester Exams': 'امتحانات نهاية العام',
    'Last day of school': 'آخر يوم دراسي',
    'Weekend': 'عطلة نهاية الأسبوع',
    'After the last day of school': 'بعد آخر يوم دراسي',
    'No school': 'لا دوام'
  };
  function label(s, lang) { return lang === 'ar' && AR_LABELS[s] ? AR_LABELS[s] : s; }

  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function parse(s) { var p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function day0(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function monday(d) { return addDays(day0(d), -((d.getDay() + 6) % 7)); }
  function within(list, s) { for (var i = 0; i < list.length; i++) if (s >= list[i][0] && s <= list[i][1]) return list[i][2]; return null; }

  /** Why there is no school on this date (weekend, break, holiday…), or null on a school day. */
  function noSchool(d) {
    d = day0(d); var s = iso(d);
    if (d.getDay() === 0 || d.getDay() === 6) return 'Weekend';
    if (s > YEAR_END) return 'After the last day of school';
    return within(NO_SCHOOL, s);
  }
  function eventOn(d) { return within(EVENTS, iso(day0(d))); }
  function weekHasSchool(mon) { for (var i = 0; i < 5; i++) if (!noSchool(addDays(mon, i))) return true; return false; }

  var weekCache = {};
  /** Teaching week of a date: 1 = the week of 28 Sep. Weeks with no school days are not counted
      (null while inside one); 0 before the timetable starts. */
  function teachingWeek(d) {
    var mon = monday(d), start = parse(TERM_START), key = iso(mon);
    if (mon < start) return 0;
    if (key in weekCache) return weekCache[key];
    if (!weekHasSchool(mon)) return (weekCache[key] = null);
    var n = 0;
    for (var m = new Date(start); m <= mon; m = addDays(m, 7)) if (weekHasSchool(m)) n++;
    return (weekCache[key] = n);
  }
  /** Timetable cycle (1 or 2) for a date, or 0 if the timetable is not running. */
  function cycleOf(d) {
    var mon = monday(d), start = parse(TERM_START);
    if (mon < start) return 0;
    if (CYCLE_SKIPS_BREAKS) { var t = teachingWeek(d); return t ? (t % 2 === 1 ? 1 : 2) : 0; }
    return Math.round((mon - start) / 6048e5) % 2 === 0 ? 1 : 2;
  }
  /** Timetable rows that actually happen on this date (none on a no-school day). */
  function slotsOn(d) {
    if (noSchool(d)) return [];
    var c = cycleOf(d), dn = DAYS[day0(d).getDay()];
    return c ? SCHEDULE.filter(function (r) { return r[3] === c && r[4] === dn; }) : [];
  }

  var countCache = {};
  /** How many AI lessons this section has had from Week 1 up to and including this date. */
  function taughtCount(section, d) {
    var end = day0(d), key = section + '|' + iso(end);
    if (key in countCache) return countCache[key];
    var n = 0;
    for (var x = parse(TERM_START); x <= end; x = addDays(x, 1))
      n += slotsOn(x).filter(function (r) { return r[0] === section; }).length;
    return (countCache[key] = n);
  }
  /** The Main course week this section is taught on this date, or 0 if it has no AI period that day. */
  function lessonOn(section, d) {
    return slotsOn(d).some(function (r) { return r[0] === section; }) ? taughtCount(section, d) : 0;
  }
  /** The section's lesson for the week containing this date: its lesson this week if it has one
      (taught or still to come), otherwise the next one it will be taught. */
  function currentLesson(section, d) {
    var mon = monday(d);
    for (var i = 0; i < 5; i++) { var n = lessonOn(section, addDays(mon, i)); if (n) return n; }
    return taughtCount(section, d) + 1;
  }
  /** Lessons taught so far to a section; for an unknown section, the teaching weeks so far. */
  function taughtSoFar(section, d) {
    d = d || new Date();
    if (section && SCHEDULE.some(function (r) { return r[0] === section; })) return taughtCount(section, d);
    var w = teachingWeek(d);
    if (w === null) { for (var x = monday(d); w === null && x >= parse(TERM_START); x = addDays(x, -7)) w = teachingWeek(x); }
    return w || 0;
  }
  /** Label for the week containing this date, e.g. "Teaching week 3 · 19 – 23 Oct". */
  function weekLabel(d) {
    var mon = monday(d), fri = addDays(mon, 4), t = teachingWeek(d);
    var f = function (x) { return x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
    if (t === 0) return 'Before the AI Literacy timetable starts';
    if (t === null) return (noSchool(mon) || 'No school') + ' · ' + f(mon) + ' – ' + f(fri);
    return 'Teaching week ' + t + ' · ' + f(mon) + ' – ' + f(fri);
  }

  return { TERM_START: TERM_START, YEAR_END: YEAR_END, SCHEDULE: SCHEDULE, NO_SCHOOL: NO_SCHOOL, EVENTS: EVENTS, DAYS: DAYS,
           iso: iso, parse: parse, monday: monday, noSchool: noSchool, eventOn: eventOn, teachingWeek: teachingWeek,
           cycleOf: cycleOf, slotsOn: slotsOn, taughtCount: taughtCount, lessonOn: lessonOn, currentLesson: currentLesson,
           taughtSoFar: taughtSoFar, weekLabel: weekLabel, label: label };
})();
if (typeof module !== 'undefined') module.exports = AICAL;
