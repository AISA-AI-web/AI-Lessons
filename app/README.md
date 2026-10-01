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

## Where the data lives

One Google Sheet, kept in an AISA **Shared Drive** that only the system owners
manage. The app reads and writes it for users; nobody else can open it. **No
student data is ever stored in this GitHub repository**, which is public.

| Tab | What it holds |
|---|---|
| Roles | Owners and SLT – edit by hand |
| Roster | Students and teachers by section – filled from Google Classroom |
| CourseMap | Which Classroom course is which section – check after each sync |
| Lessons | Lessons that have been used, with their activity count and points |
| Scores | One row per student per activity: first-try score only |
| Time | Active seconds on each lesson page |

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
4. **Create the project and upload the code** from the repository folder:
   ```
   python3 app/build.py
   clasp create --type standalone --title "AI Curriculum" --rootDir app/build
   clasp push
   ```
   `clasp create` writes a `.clasp.json` file; it is ignored by git. If your
   Workspace allows it, move the new *AI Curriculum* script file into the
   Shared Drive as well.
5. **Create the data sheet.** Run `clasp open`, choose `setup` in the function
   menu, and press **Run**. Approve the permissions. A sheet called
   *AI Curriculum – Student Data (PROTECTED)* appears in your My Drive – **move
   it into the Shared Drive** (its link stays the same).
6. **Owners and SLT.** Open the sheet's **Roles** tab. `setup` has added you as
   `owner`. Add the second owner, then one row per SLT member with role `slt`
   (Director, principals, vice principals, head of teaching and learning, head
   of data and assessment, head of inclusion).
7. **Class lists from Google Classroom.** In the script editor run
   `syncClassroom`. It reads every active course, guesses the section from the
   course name (for example *Girls 6 …*) and fills **CourseMap** and
   **Roster**. Check CourseMap: fix any wrong section, set `include` to `Y` for
   the courses that carry AI Literacy and `N` for the rest, then run
   `syncClassroom` again.
   *To read every course, the account running the sync needs Google Workspace
   or Classroom admin rights. Without them it only sees courses that account
   teaches – ask IT to run this step, or to grant the rights.*
8. **Publish.** In the editor: **Deploy → New deployment → Web app**.
   *Execute as:* **Me**. *Who has access:* **Anyone within AISA**. Copy the web
   app URL – that is the address students and teachers use (it works with the
   QR buttons too).
9. **Keep rosters fresh (optional).** In the editor, **Triggers → Add
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
