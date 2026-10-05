# UX proposal – home page, teaching calendar, dashboard

**Status: proposal only.** Nothing on the live pages has changed. This folder holds three clickable
mockups and the thinking behind them, so the ideas can be discussed before any real work starts.

| Mockup | Open | What it shows |
|---|---|---|
| Home page | `home.html` | Student-first home: *your* lesson this week, then your grade's lesson list. Switch "Preview as" (bottom right) to see the public, not-signed-in version. |
| Teaching calendar | `calendar.html` | "My week" grid for a teacher of Boys 8 and Girls 8, with the break coming up. `calendar.html?view=all` shows every grade. |
| Dashboard (teacher) | `dashboard.html` | Class tabs, four tiles that say what to do, one lesson-overview chart, and a lighter student table that turns into cards on a phone. |

The clock in the mockups is fixed at **Wednesday 7 October 2026** so the week, the Mid-Term Break
notice and the "pushed back" logic are real (they come from `school-calendar.js`). The students and
scores in the dashboard are fictional (`dashboard-data.js`).

---

## What gets in the way today

Taken from the current pages (screenshots were made at 1280 px and 390 px):

- **Three different looks.** The home page and calendar use Lexend and indigo on grey; the dashboard uses the system font and blue with its own dark mode; the PDF header already uses AISA purple. There is no shared top bar, so you cannot get from the dashboard to the calendar, or from the calendar to the dashboard, without the small black sign-in strip.
- **The home page is a catalogue, not a starting point.** A Grade 8 student has to scroll past Grades 6 and 7 (3,200 px on a phone) and read "Teach 5 – 9 Oct 2026" tags to find this week's lesson. It never says "Continue" even though the app knows the student has done 14 of 19 activities.
- **Teacher words on student screens.** "Bridging course", "Core + Lab", "Teach 28 Sep – 2 Oct", "Week 0 + Week 1". The footer still says "Print your results to show your teacher", which the signed-in app made unnecessary.
- **The calendar answers "what happens on this date" rather than "what do I teach this week".** On 7 October the list is six rows of "lesson is not on the site yet". The teacher's own two classes are a filter at the end of the controls row. Nothing warns that next week is the Mid-Term Break, and the date box shows an ambiguous `10/07/2026`.
- **The dashboard is a data wall.** Thirty-six rows, each with four drop-down menus (144 inputs on screen), emoji badges, and cells like "57% ✓ done · 35m". "Lessons finished 16" counts student-lessons, which nobody says out loud. On a phone only the name and badge columns fit; the lesson progress is off-screen to the right. There is no sort, no search and no "who hasn't started".
- **Three hand-kept lesson lists.** `index.html`, the `LESSONS` map in `calendar.html` and the catalog that `build.py` generates all describe the same lessons. They drift (Grade 7 is "Week 0 + Week 1", the "Teach …" dates ignore pushed sections).

---

## The direction (applies to all three pages)

1. **One shell.** The same purple top bar on every page: *AISA · AI Lessons* · Lessons | Calendar | My progress (or Dashboard) · who is signed in · العربية. The language switch finally reaches the home page too.
2. **Lead with "now".** Each page opens on what this person needs this week, and the detail follows.
3. **Fewer controls, shown when needed.** Class tabs instead of a Section menu; tier drop-downs only after pressing ✎; PDF and CSV under "More".
4. **Phone first for students, phone-capable for teachers.** Students arrive by QR code on phones; the dashboard table becomes one card per student under 720 px.
5. **One source of truth for lessons.** Let `build.py` write a `lessons.js` the public site loads, so the home page, the calendar and the dashboard always agree on titles, dates and which lesson pages exist.
6. **Brand, lightly.** AISA purple for structure, gold for emphasis, DM Sans; the grade colours stay so Grade 8 is still green on the way into a lesson. The layouts do not depend on this – they work in today's indigo and Lexend if the school prefers.

---

## Home page

**Ideas, most valuable first**

1. **"Your lesson this week" hero** – week label, lesson title, when your class has it (day, period, subject), progress bar, one big *Continue* button. For a visitor it becomes "This week's lesson for Grade 8" with both sections' periods.
2. **Grade picker that remembers** – the seven grade pills; the signed-in app pre-selects the student's grade from the roster, the public site remembers the last choice on the device.
3. **One grade's lessons as a list with status** – Week 1 *Finished · 78%* → *Review*; Week 2 *14 of 19* → *Continue*; Week 3 *Coming Wed 21 Oct · after the break*. Lessons that are not published yet are listed as "Lesson page coming" instead of being invisible.
4. **A "no school" card** when a break or PD day is in the next three weeks, with the date of the next AI lesson.
5. **Badges glimpse** (students) and a **Teachers** card pointing to the calendar.
6. **"Browse all grades"** collapsed at the bottom for teachers and visitors – the current grid, one line per grade.
7. Rewrite the student copy: *Bridging course → Foundation lessons*, drop "Core + Lab" from the home page, replace "Teach 28 Sep – 2 Oct" with *Taught Wed 30 Sept* / *This week · Mon 5 Oct, period 7* / *Coming Mon 26 Oct*.
8. Hero states not mocked: when the week's lesson is finished, say so and offer *Review* or the ⭐ challenge; during a break week, show the next lesson's date.

## Teaching calendar

**Ideas, most valuable first**

1. **Week view, not day view** – Monday to Friday columns with every AI period as a card: period and time, class, subject chip, the lesson that class is on, *Open lesson* and *Class progress* links. Today's column is marked. On a phone the columns stack into an agenda.
2. **"My classes" as the default and as a visible segmented switch**, with "All grades" plus a grade menu when needed.
3. **"Coming up" notice** – the next break, holiday or PD days, and for each of my classes the date of its next lesson after them. This replaces having to click forward day by day.
4. **Say "pushed back" on the card itself** – kept from today, now with the plain reason.
5. **Week navigation in words** – ‹ *Teaching week 2 · Mon 5 – Fri 9 Oct · Timetable Week 2 of 2* › *Today*, with "Jump to a date" moved out of the way. (Worth agreeing what the school calls the two timetable weeks.)
6. **"Lesson page coming"** instead of "lesson is not on the site yet" six times, and a legend that explains the two card styles and the hatched no-school days.
7. **"About this calendar"** as a collapsed note rather than a paragraph under every view.
8. Not mocked: a **print view of the week** for the staff room, and a link from a card straight into the dashboard filtered to that class and lesson.

## Dashboard

**Teacher view – ideas, most valuable first**

1. **Class tabs** (All my classes · Boys 8 · Girls 8) instead of the Section menu; the student list and the Student-view menu fold into clickable names.
2. **Four tiles that say what to do**: *This week* (the current lesson, started/finished per class, or the date it will be taught); *Need a nudge* (students who have not started last week's lesson, with *Show them*); *Average first try* with the week-to-week trend; *At Emerging or above*.
3. **One lesson-overview chart** – per lesson, a stacked bar of finished / in progress / not started / not taught, and the average first-try score beside it. It replaces the two bar charts that showed the same lessons twice.
4. **Lighter table**: current lesson first, then the previous one; cells read *✓ 78%*, *59% · 14 of 19 activities*, *Not started · taught Mon 5 Oct* or *Not yet · on Fri 9 Oct* (the date is more useful than "not taught yet"); strands as four small chips with a ✎ that turns them into menus only for that student; badges as a count with a tooltip.
5. **Search, filter chips and sort** – find a student, *Needs a nudge*, *Finished Week 1*, sort by lowest first try or not-started first.
6. **Phone layout** – one card per student with the same cells.
7. **Secondary tools under "More"** (student view, Save as PDF, CSV); *Class lists* keeps its red counter.
8. **Attainment by strand** kept, with a purple sequential scale whose six steps can be told apart, and the share at Emerging+ as the number.

**Student view ("My progress")** – already the strongest page; not mocked, smaller changes: the same top bar; the "Hi Yousef" card and "This week's lesson" merge into the same hero as the home page; the four tiles lose "First-try score across 39 activities" in favour of *Lessons finished*, *This week*, *Badges* and *Answers fixed*; each strand shows one concrete next step even without the private framework file ("Finish Week 2's Lab to add Design & build evidence").

---

## Suggested order of work

**Phase 1 – quick wins, one pull request each, no data changes**
1. Shared top bar (and the language switch) on the three pages; "Lesson page coming" and the collapsed note on the calendar.
2. Home page hero + grade pills + status list (the public site gets dates and titles from the calendar data; the app adds *Continue* and *Finished*).
3. Calendar week grid with "My classes" default and the "Coming up" notice.
4. Dashboard tabs, tiles, lesson overview and the new table cells; phone cards.

**Phase 2**
5. `build.py` writes `lessons.js`; `index.html` and `calendar.html` read it.
6. Sort, filter and search; ✎ edit mode for tiers; "Show them" filter from the tile.
7. Role-aware landing in the app (students: home; staff: calendar or dashboard – to decide).

**Phase 3** – the brand restyle, if wanted, once the layouts are in.

## Decisions needed

- **Look:** AISA purple/gold with DM Sans (as mocked), or keep today's indigo and Lexend?
- **Staff landing page:** the calendar (today) or the dashboard "This week" tile?
- **Words:** what do teachers call the two timetable weeks – "Week 1 / Week 2", "A / B"? And is *Taught Mon 5 Oct* / *on Fri 9 Oct* the right tone?
- **Student home in the app:** should the home page replace the grade selector for students, with "My progress" kept as the detailed page?
