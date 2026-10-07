# AI Curriculum – signed-in app (setup guide)

This folder is the **signed-in version** of the AI Lessons site. It runs as a
Google Apps Script web app inside AISA's Google Workspace and:

- only opens for **@aisa.sch.ae** Google accounts (checked twice: by Google at
  the door, and again by the app on every request);
- saves each student's **first-try score** for every activity and their
  **active time** on each lesson;
- gives **students** their own progress, **teachers** their own sections (from
  Google Classroom), and **owners and SLT** the whole school.

The public site (the HTML files at the top of this repository) keeps working
exactly as before, with no sign-in and no data saved.

## Strands, tiers and the framework

Progress is tracked against the **ADEK K–12 AI Fluency Framework** strands used in
the AI Literacy Scope & Sequence – four per grade:
**CU** AI Conceptual Understanding (Grades 6–8) / AI Systems Understanding (9–12),
**SD** AI Solution Design & Development, **CE** Critical Evaluation & Informed
Interaction, and **GE** the grade's ethics and governance strand.

Every activity is tagged to one strand in `STRAND_MAP` in `src/dashboard.html`.
**When you add a lesson, add a line there.** Each student gets a tier per strand,
using the rules in `TIER_RULES` (same file – one place to change them):

| Tier | Rule (provisional – to be reviewed by the head of data and assessment) |
|---|---|
| Not yet evidenced | No activities in the strand yet |
| Working towards Emerging | Under 70% first try |
| On track – needs more evidence | 70%+ first try, but fewer than 3 activities |
| Emerging (Term 1 expected standard) | 70%+ first try on 3+ activities |
| Proficient (year target) | Emerging, plus 85%+ on 5+ activities or 70%+ on ⭐ challenge activities |
| Advanced | Only recorded by a teacher (e.g. from the Week 10 showcase rubric) |

Teachers can set any student's tier in a strand by clicking it in their dashboard's
student table and choosing from the menu (marked ✎); it overrides the automatic
tier until they set it back to Automatic. Only the
student's own teachers, SLT and owners can do this.

### Keeping the framework wording private

The framework descriptors and week-by-week plan are **not** in this public
repository. Put the Scope & Sequence HTML in `app/private/` (git-ignored) before
running `python3 app/build.py`; the build turns it into `Framework.js`, which goes
only into the Apps Script project in the school's Google account. Students then
see the next tier's descriptor as their "next step", and teachers see the
official strand names. Without the file everything still works, minus the
descriptor wording.

Bridging lessons are shown as "to be scheduled" and don't count towards
Finisher until they are assigned.

### School calendar and pushed lessons

`school-calendar.js` (top of the repository) holds the AISA 2026–27 calendar –
breaks, public holidays and PD days, plus exam and MAP weeks as notes – and the
AI Literacy timetable. Each section has one AI period a week; its *n*-th period
on a real school day teaches Main course Week *n*. A period that falls on a day
with no school simply doesn't happen, so that section's lesson is **pushed** to
its next period (e.g. the six Wednesday/Thursday sections lose one lesson to UAE
National Day). Weeks with no school at all (Mid-Term, Winter, Spring Break) don't
advance the Week 1 / Week 2 cycle – change `CYCLE_SKIPS_BREAKS` if the school's
cycle runs on by date instead.

The teaching calendar shows no-school days, each section's actual lesson and a
"pushed back" note; the dashboards count a lesson as due only once the
student's section has been taught it ("Not taught yet" vs "Not started", the
Finisher badge, completion and "this week's lesson"). When the Islamic holiday
dates are confirmed, update `NO_SCHOOL` in that file. `node app/test/calendar.test.js`
checks the rules.

The timetable runs in two weeks: **Week 1 is Days 1–5 and Week 2 is Days 6–10**
(Monday–Friday). The calendar shows the day number on every lesson.
`AICAL.dayNumber`, `lessonDate`, `nextLesson` and `lostPeriods` in
`school-calendar.js` give the day, a class's lesson dates and the periods it lost
to holidays.

## When students can open a lesson

Students only see Main course lessons their class has reached. Each week opens
on the **Monday of the week their section is taught it** (so a lesson pushed back
by a holiday opens a week later too); every earlier week stays open for catching
up. Week 1 and the Bridging lessons are always open.

- **Signed-in app:** the server refuses a locked lesson to a student and shows
  "Not open yet" with the date it opens. Locked lessons show 🔒 and their opening
  date on the grade selector, the calendar and the student's dashboard.
  Teachers, SLT and owners can open every week.
- **Public site:** it has no sign-in, so a week opens there as soon as **any**
  section of that grade reaches it (`lesson-gate.js`). This is a courtesy lock:
  the files are public, so someone determined can still read them. Students
  should use the signed-in app.

The rule lives in `school-calendar.js` (`releasedFor`, `opensOn`) and is tested in
`app/test/calendar.test.js` and `app/test/server.test.js`.

## Home page by role

Opening the web app link with no page chosen takes **teachers, SLT and owners**
to the **teaching calendar on today's date**. **Students** land on their **home
page**. The public site works the same way without signing in.

- **Students** see this week's lesson with when their class has it, a *Start /
  Continue / Review* button and their progress, then **My AI lessons**: every
  lesson for their grade with their class's date, period and subject, a "No
  school" line where a break falls, and the foundation lessons. There is no grade
  picker – the app knows their class from the Roster. Their menu is *My lessons ·
  My progress*; the calendar is not shown to students (opening it takes them to
  their home page).
- **Teachers, SLT and owners** opening *Lessons* see **All grades**: every lesson
  on the site, Grades 6–12, grouped by grade with each class's date for every
  week and the foundation lessons. The grade chooser above the list (or *Grade N
  only* beside a grade) narrows it to one grade; the choice is remembered on that
  device, and *All grades* goes back to the full list.
- **Visitors to the public site** choose a grade or *All grades* (remembered on
  that device) and see "This week in every grade" until they do.
- A signed-in account the app can't find on the Roster or Roles sheet is treated
  as a student without a class: it sees All grades with a note to ask their
  teacher. Put teachers on the Roster with the role `teacher` (SLT and owners go
  on the Roles sheet) so they get the staff pages.

## The teaching calendar (staff)

- **My lessons** (teachers): every AI lesson of their own classes in order, week by
  week – date, period, day number, class, subject and the lesson. Breaks show as
  one line; a holiday inside a week says which class's lesson moves and to when; a
  class pushed back by a holiday gets the reason once, then a short "one lesson
  behind" tag. *Show earlier weeks* and *Show 4 more weeks* page through the year.
- **Whole school** (SLT, owners and the public site; teachers can switch to it):
  one timetable for the week, periods down and days across, each class a small
  chip with its grade colour. Click a class for its lesson and links; filter by
  grade; a notice warns when next week has a break.
- Every lesson has **Open lesson**, **Copy link** and **Share to Classroom**. In
  the app the link is the signed-in address of the lesson, so students' answers
  save to their accounts. *Share to Classroom* opens Google Classroom's share page
  with the link and title filled in – choose the class and post it as an
  assignment, material or announcement.

## The teacher dashboard

- **Class tabs** (a class menu when there are more than six classes); **Class
  lists** keeps its red counter; **More** holds the student view, *Save as PDF* and
  *Download data (CSV)*.
- **Tiles:** this week's lesson for each class (started and finished, or the day it
  will be taught); **Need a nudge** – students who haven't finished the last lesson
  their class was taught before this week, with *Show them*; the average first try
  with its trend; the share of strand ratings at Emerging or above.
- **Lesson overview** (newest first, the latest four with *Show all*) and
  **Attainment by strand**, each with a *Table* view.
- **The student table keeps the same seven columns all year:** student · the
  lesson (each class's lesson this week, or any lesson picked from the menu) ·
  lessons so far (count, one square per lesson, overall first try) · CU · SD · CE ·
  GE. Badges are not in the teacher table; students still see theirs. Search,
  filters (*Need a nudge*, *Not started*, *Finished*) and sorting sit above it, and
  "Which activities need reteaching?" follows the picked lesson. On phones each
  student becomes a card.

## The student dashboard

Students open **My progress** from the bar at the top of any page. They see:
this week's lesson; their learning journey (every lesson for their grade, with
status); first-try score, answers fixed and badges; their **four strands** with
their tier and the next tier's descriptor as a "next step"; and
first-try scores lesson by lesson.

**Badges** (Grades 6–8) or **milestones** (Grades 9–12, plainer style) reward
learning behaviours, never speed or time: First Steps, Finisher, Week Streak,
Fixer (corrected every wrong answer in a lesson), Stretch (a ⭐ challenge),
Bullseye (90%+ first try on a lesson), and one per strand for securing
Emerging – AI Detective (CU), Solution Builder (SD), Fair Judge (CE),
Responsible User (GE). There are no
leaderboards or class rankings. Teachers see each student's badges in their
dashboard.

**Save as PDF.** Every dashboard has a **Save as PDF** button. It saves what is on
screen – the charts, strand attainment and student table for the chosen section
and lesson, or one student's report – as an A4 landscape report with a header
(school, who prepared it, date, "Confidential"). In the print window choose
**Save as PDF** as the destination. **Download data (CSV)** is still there for
spreadsheets.

**Seeing a student's view.** Teachers, SLT and owners can click a student's name
in the progress table, or choose one from the **Student view** menu, to see that
student's dashboard exactly as the student sees it (read-only; lesson buttons are
switched off). Teachers can only pick students in their own sections.

## English / العربية

The home page, the dashboard and the teaching calendar have an **العربية / English** button in the top bar.
Arabic switches the page to right-to-left and translates every label, button,
tooltip, message and badge (dates in Arabic, numbers stay 0–9). The choice is
remembered per user and also applies to the top bar on lesson pages. Lesson
content, lesson titles, names and the official framework descriptors stay in
English. Translations live in `src/dashboard.html` (`AR`), `calendar.html` (`AR`), `index.html` (`AR`)
and `school-calendar.js` (holiday names) – please have an Arabic-speaking
colleague check the wording.

## Class lists: transfer, add, request, confirm

Teachers, SLT and owners open **👥 Class lists** on the dashboard to make sure
their lists are right:

- **Move** a student who is in the wrong class to the right one (from your own
  classes only) – it happens straight away.
- **Add** a missing student by school email and name – straight away if they are
  new to the lists. If they are already in another class, it becomes a
  **request**: that class's teacher (or an owner / SLT) approves or declines it
  from their own Class lists screen (a red number on the button shows waiting
  requests).
- **Sections shared by several teachers** (e.g. Boys 8 taught as 8B1 and 8B2):
  each student's and teacher's teaching group comes from the *Class Name*
  column of the school export (Roster → `courseName`). A teacher's dashboard
  shows only their own group; **Show all of Boys 8** shows the whole section.
  Tiers can be recorded for their own students only. If the export put a
  student with the wrong teacher, **Move to my class** (Class lists, *Your
  class* column) moves them straight away; it is logged (type `class`) and
  wins over later imports while the student stays in that section. Students or
  teachers with no class name fall back to the whole section.
- **Who teaches a period.** Each AI lesson sits in an Arabic or an Islamic period
  (the 10-day timetable in `school-calendar.js`). A teacher's subject comes from
  their class codes in the school export (`BO6ISA1` = Islamic, `BO6AFL1` /
  `BO6ASL` = Arabic, `BO6TUT` = tutor) or from a Classroom course name. Owners and
  SLT see, in the calendar pop-up, the teachers of that subject for that class –
  names only – and on the dashboard the teacher of the period each lesson fell in.
  Rows added by hand (blank `courseId`) hold notes such as "AI timetable –
  teacher", which are never treated as class names.
- **✓ This list is correct** records who confirmed each class and when; the
  stamp turns amber ("changed since …") if the list changes afterwards, so SLT
  can see which lists are checked.

Every change is logged in the **Changes** tab (who, when, from, to), and
`importRoster` re-applies them, so a new export from IT doesn't undo teachers'
corrections. Owners and SLT can **Download changes for IT (CSV)** so the school
information system gets fixed at the source too.

## Rushed work and retakes

The dashboard flags a lesson as **⚡ Rushed** when a student finished it in under
10 minutes of active time with a first-try score under 50% (`RUSH_MIN` and
`RUSH_PCT` at the top of `dashboard.html`). The student's row turns red, the
**⚡ Rushed** chip lists them, and a **↻ Retake** button asks them to redo it.

A retake is a row in the **Retakes** tab (who, which lesson, which teacher, when).
From then on only work after the retake counts as that lesson's first tries; the
earlier attempt stays in the sheet and the teacher sees it next to the new one
("first attempt 26% in 5 min"). The next time the student opens the lesson, its
saved answers on their device are cleared and a note says their teacher asked
them to redo it. Teachers can set retakes for their own students; owners and SLT
for anyone.

## Progress over time

The dashboard's **Progress over time** card plots the average first-try score in
each strand (CU, SD, CE, GE), teaching week by teaching week, for the classes on
screen (hover a week for the values and the share of students who finished it;
**Table** shows the numbers). Under it, **What to focus on** lists the weakest
strand, any strand that dropped since the week before, the biggest gain and any
week that fewer than 70% of students finished. Students (and teachers viewing a
student) see **My progress over time**.

## AI & Innovation Student and Teacher of the Month (owners)

Owners get a **🏆 Awards** button on the dashboard. Pick a month to see:

- **Students**, ranked by a score out of 100: first-try score 40%, finishing the
  lessons taught that month 25%, care (active minutes per lesson, full marks at
  30) 15%, growth against their earlier lessons 10%, fixing wrong answers 10%.
  Only students with at least 2 lessons finished that month, no rushed lessons
  and at least 75% of the month's lessons finished are ranked.
- **Teachers**, ranked on their own students: completion 35%, first-try score
  25%, growth 15%, active students 15%, rushed lessons followed up with a retake
  10% (tiers recorded and confirmed class lists are shown, not scored). Teachers
  with fewer than 5 students are not ranked.

**Nominate** records the winner (and an optional reason) in the **Awards** tab;
a later nomination for the same month replaces it. Winners see a 🏆 banner on
their own dashboard. The rankings are a guide – the choice is the owner's.

## Where the data lives

One Google Sheet, kept in an AISA **Shared Drive** that only the system owners
manage. The app reads and writes it for users; nobody else can open it. **No
student data is ever stored in this GitHub repository**, which is public.

| Tab | What it holds |
|---|---|
| Roles | Owners and SLT – edit by hand |
| Roster | Students and teachers by section – from `importRoster` (courseId `sis`), Google Classroom, or added by hand (blank courseId) |
| CourseMap | Which Classroom course is which section – check after each sync |
| Lessons | Lessons that have been used, with their activity count and points |
| Scores | One row per student per activity: first-try score only |
| Time | Active seconds on each lesson page |
| Judgements | Tiers recorded by teachers (latest wins) |
| Changes | Class-list changes: transfers, additions and requests (with who decided) |
| Confirmations | Teachers confirming a class list is correct |
| Retries | A student's later score on an activity they corrected (for "answers fixed"); first tries are never changed |

## One-time setup (about 30 minutes)

You need a computer with Node.js installed, signed in to Chrome with an
@aisa.sch.ae account.

1. **Shared Drive.** In Google Drive create a Shared Drive called
   *AI Curriculum (Protected)*. Add `hodai@aisa.sch.ae` and
   `bbaki@aisa.sch.ae` as **Managers**. Add nobody else.
2. **Turn on the Apps Script API** for your account at
   <https://script.google.com/home/usersettings>.
3. **Install clasp and sign in** (in a terminal):
   ```
   npm install -g @google/clasp
   clasp login
   ```
   Choose your @aisa.sch.ae account.
4. **Add the private framework file.** Copy the AI Literacy Scope & Sequence
   HTML into `app/private/` (this folder is never committed).
5. **Create the project and upload the code** from the repository folder:
   ```
   python3 app/build.py
   clasp create --type standalone --title "AI Curriculum" --rootDir app/build
   clasp push
   ```
   `clasp create` writes a `.clasp.json` file; it is ignored by git. If your
   Workspace allows it, move the new *AI Curriculum* script file into the
   Shared Drive as well.
6. **Create the data sheet.** Run `clasp open`, choose `setup` in the function
   menu, and press **Run**. Approve the permissions. A sheet called
   *AI Curriculum – Student Data (PROTECTED)* appears in your My Drive – **move
   it into the Shared Drive** (its link stays the same).
7. **Owners and SLT.** Open the sheet's **Roles** tab. `setup` has added you as
   `owner`. Add the second owner, then one row per SLT member with role `slt`
   (Director, principals, vice principals, head of teaching and learning, head
   of data and assessment, head of inclusion).
8. **Class lists from the school information system (recommended).** Ask IT for
   the AI Literacy class export (one row per student per class, with the
   teacher's email). Student emails are built from the Student ID as
   `{id}@aisa.sch.ae` unless the export has a *Student Email* column. In the data sheet
   add a tab called **Import**, paste the export into it (header row first), and
   run `importRoster` from the editor. It creates one Roster row per student
   (section = gender + grade, e.g. *Boys 6*; tutorial classes included) and one
   row per teacher per section they teach, and reports how many it added. Run it
   again whenever IT sends a new export – it replaces the previous import and
   keeps rows you added by hand. If the school's email pattern ever changes, set
   the script property `STUDENT_EMAIL_PATTERN` (Project Settings → Script
   properties) – `{id}`, `{first}` and `{last}` are filled in. Clear the Import tab afterwards.

   **Or from Google Classroom.** In the script editor run
   `syncClassroom`. It reads active courses, guesses the section from the
   course name (for example *Girls 6 Arabic*) and fills **CourseMap** and
   **Roster**. Only **Arabic and Islamic Studies** courses for Grades 6–12 are
   included automatically, because those carry AI Literacy – so teachers of
   other subjects never see AI data. Check CourseMap: fix any wrong section,
   set `include` to `Y` or `N` as needed, then run `syncClassroom` again.

   **Seeing every class.** Google only lets an account list the courses it
   belongs to. To read the whole school, `syncClassroom` must be run by an
   account that is a **Google Workspace admin with Classroom privileges**
   (a super admin, or a delegated admin role that includes Classroom). Either:
   - ask IT to give one owner account (e.g. `bbaki@aisa.sch.ae`) an admin role
     with Classroom privileges, then that owner runs `syncClassroom`; or
   - ask an IT admin to run it: add them to the Shared Drive and the script
     temporarily, they run `syncClassroom` once from the editor and add a
     weekly trigger (step 10) under their account, then remove their Drive
     access if you prefer (the trigger keeps working only while they keep
     access, so the first option is simpler).

   **Teachers from the AI timetable.** You can also add teachers by hand:
   paste rows into **Roster** with role `teacher`, their section (e.g.
   `Boys 9`) and grade, and leave `courseId` **blank**. A teacher gets one
   row per section, and tutors can be added the same way. `syncClassroom`
   keeps every row with a blank `courseId` and only replaces the rows it
   created.

   If you ran it before and got the wrong courses, **clear the CourseMap tab**
   (keep the header row) and run it again so every course is re-checked.
9. **Publish.** In the editor: **Deploy → New deployment → Web app**.
   *Execute as:* **Me**. *Who has access:* **Anyone within AISA**. Copy the web
   app URL – that is the address students and teachers use (it works with the
   QR buttons too).
10. **Keep rosters fresh (optional).** In the editor, **Triggers → Add
   trigger**: `syncClassroom`, time-driven, weekly.

## Updating lessons

Add or change lessons in the repository as usual, then:
```
python3 app/build.py
clasp push
clasp deploy -i AKfycbyxIhdUxnImhZOsjjFX3E0kWRcVJN2_XgwUKSkmxt-8qha9COPqqK1bdYORnjt8cbBL4w -d "Update"
```
The last line makes a new version and points the existing web app deployment at
it (the same as **Deploy → Manage deployments → Edit → New version** in the
editor), so the web app URL – and the short link `…/AI-Lessons/app` – stay the
same. Access settings come from `appsscript.json` (*Execute as* me, *Anyone
within AISA*). Never use **New deployment**: that makes a new URL.

`build.py` also rewrites **`lessons.js`** – the lesson list the home page and the
calendar read, with each lesson's title taken from its own heading. **Commit
`lessons.js` after adding a lesson** so the public site lists it too
(`node app/test/site.test.js` checks it is up to date).

Every lesson's `update()` function must start with the `LessonHooks` line –
`build.py` refuses to build if a lesson is missing it, so scores can't silently
stop saving.

## The look: AISA brand and logos

The home page, calendar and dashboard share `site.css` (DM Sans, deep royal purple
`#21076C`, warm gold `#D8B664`, white pages) and one top bar with the school logo.
The logos are in `assets/aisa/` (white versions on purple, purple on white, the
seal in the footer, the purple lockup on printed reports). Apps Script cannot serve
image or CSS files, so `build.py` inlines `site.css`, `lessons.js`,
`school-calendar.js` and the logos into each page of the app. Lesson pages keep
their own design and the black "Signed in as" strip, which shows when answers are
saved.

## Privacy checklist

- [ ] The data sheet is in the Shared Drive and **only the two owners** are
      members. Never share the sheet itself with teachers or SLT – they use the
      dashboard.
- [ ] The deployment's access is **Anyone within AISA**, never "Anyone".
- [ ] Parents are told what is collected: name, school email, section,
      first-try scores and time on lesson pages. Nothing else.
- [ ] Agree how long data is kept (for example: delete the Scores and Time
      rows at the end of each academic year, after reports are done).
- [ ] The school's data-protection lead has reviewed this setup.

## Testing locally

`node app/test/calendar.test.js` checks the school-calendar rules.
`node app/test/server.test.js` runs the server code against stand-ins for the
Google services and checks the sign-in gate, role filtering, first-try
protection, input cleaning and which page each role lands on. Run
`python3 app/build.py` first (with the Scope & Sequence file in `app/private/`,
which the framework check needs). `node app/test/site.test.js` checks that
`lessons.js` matches the lesson files.
