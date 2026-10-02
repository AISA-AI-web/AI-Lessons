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

Teachers can set any student's tier in a strand from their dashboard (marked ✎);
it overrides the automatic tier until they set it back to Auto. Only the
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
Finisher until they are assigned; Main course lessons count from their
teaching week (Week 1 = 28 Sep 2026, set by `TERM_START` in `src/Code.js`).

## Home page by role

Opening the web app link with no page chosen takes **teachers, SLT and owners**
to the **teaching calendar on today's date**. Teachers see it filtered to
**My classes** (their sections in the Roster tab, tutors included); they can
switch to any grade. Owners and SLT see all grades. **Students** land on the
grade selector. The public site is unchanged.

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
```
and in the editor **Deploy → Manage deployments → Edit → New version**. The
web app URL stays the same.

Every lesson's `update()` function must start with the `LessonHooks` line –
`build.py` refuses to build if a lesson is missing it, so scores can't silently
stop saving.

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

`node app/test/server.test.js` runs the server code against stand-ins for the
Google services and checks the sign-in gate, role filtering, first-try
protection and input cleaning. Run `python3 app/build.py` first.
