# UX proposal – home page, teaching calendar, dashboard

**Status: proposal only.** Nothing on the live pages has changed. This folder holds three clickable
mockups and the thinking behind them. Open the HTML files in a browser from this folder.

| Mockup | What it shows | Switches (black bar, bottom right) |
|---|---|---|
| `home.html` | A student's home: this week's lesson, then *their own* AI lessons with dates. | Signed-in student · Visitor (not signed in) |
| `calendar.html` | Staff calendar: **My lessons** (an agenda of the teacher's classes) and **Whole school** (one compact timetable). | Teacher · School leader, and "today" = 7 Oct or 25 Nov |
| `dashboard.html` | Teacher dashboard with a table that keeps the same eight columns however many lessons there are. | Data as of 7 Oct (2 lessons) · 25 Nov (8 lessons) |

Add `?clean` to any address to hide the switches (used for screenshots). Dates, periods, holidays
and "pushed back" lessons come from the real `school-calendar.js`. Students and scores in the dashboard are
fictional (`dashboard-data.js`); lessons after Grade 8 Week 2 are placeholders.

---

## Round 2 – what changed after feedback

| Feedback | Change |
|---|---|
| The home page samples are good. | Kept the layout: hero with this week's lesson, "no school" card, badges. |
| Why show students other grades, a grade picker and "your grade is remembered"? | **Removed** for signed-in students – the app already knows their grade. Their list is now **My AI lessons**, each with its date (*Mon 5 Oct*), period and subject, plus a "No school" line where a break falls. The grade chooser stays only on the public, not-signed-in page, where it is the only way to pick a grade. |
| The calendar will get cluttered. Should students see a whole-school calendar? | **No – students only see their own AI lessons**, on their home page. The calendar becomes a staff page with two views: **My lessons**, an agenda of the teacher's own classes, week by week, with breaks as one line each; and **Whole school**, a periods × days timetable where each class is a small chip, with the details on click. Students' menus no longer show "Calendar". |
| One column per lesson will get too crowded. | The table has **eight fixed columns**: student · the selected lesson (pick any week from a menu) · *Lessons so far* (count, a small square per lesson, overall first try) · CU · SD · CE · GE · badges. With 8 lessons it is exactly as wide as with 2. The lesson chart shows the latest four lessons, with "Show all". |
| Strands should be symmetrical, in columns. | **Four equal columns** under one "Strand tier" heading. Each cell is the same-size tier chip. Clicking a chip opens a small menu to record a tier (no more drop-downs on every row). On phones the four strands sit side by side in each student card. |
| Use the AISA logos. | Top bar: white lockup (monogram + "American International School in Abu Dhabi"); white monogram on narrow screens. Purple footer with the white seal. Favicon from the purple monogram. Purple lockup on the printed report header. |

---

## What gets in the way today

- **Three different looks and no shared navigation.** The home page and calendar use Lexend and indigo on grey; the dashboard uses the system font and blue. You cannot get from the dashboard to the calendar except through the small sign-in strip.
- **The home page is a catalogue.** A Grade 8 student scrolls past Grades 6 and 7 and reads "Teach 5 – 9 Oct 2026" tags to find this week's lesson, and is never told "Continue".
- **The calendar answers "what happens on this date", not "what do I teach".** Teachers click day by day; nothing warns about the coming break.
- **The dashboard grows sideways.** A column per lesson plus four drop-downs per student – 144 menus for two classes – and on a phone the lesson columns are off-screen.
- **Three hand-kept lesson lists** (`index.html`, the calendar's `LESSONS`, the generated catalog) drift apart.

## The direction (all three pages)

1. **One shell** – the same purple top bar and footer, with the school logos, on every page.
2. **Lead with "now"** – each page opens on what this person needs this week.
3. **Show only what this person needs** – students see their own lessons; teachers see their own classes first; leaders see the whole school.
4. **Fewer controls, shown when needed** – class tabs instead of menus, tier menus on click, PDF and CSV under "More".
5. **Phone first for students, phone-capable for teachers.**
6. **One source of truth for lessons** – `build.py` writes a `lessons.js` that the home page, calendar and dashboard all read.

---

## Home page

**Signed-in student**
- Hero: this week's lesson, when *your class* has (or had) it, progress, one *Continue* button.
- "No school next week" card with the date of the next AI lesson; badges card.
- **My AI lessons**: one row per lesson with a date tile, "Week 2 · Period 7 · Islamic Studies", status (*Finished · 78%*, *In progress · 14 of 19*, *Lesson page coming*) and *Review / Continue*. Breaks appear as a single "No school" line between lessons.
- Menu: **My lessons · My progress** (no calendar, no grade picker).

**Visitor (public site, not signed in)**
- The same hero for the chosen grade, with both classes' days.
- **Choose your grade** pills, then that grade's lessons. A "Teachers" card points to the teaching calendar.

**Not mocked:** teachers opening "Lessons" in the app would get the visitor layout, starting on their own classes' grade.

## Teaching calendar (staff only)

**My lessons** (default for teachers)
- One row per lesson: date tile · period and time · class and subject · "Week 3 · lesson title" · *Open lesson* and *Class progress*.
- Past lessons fade with "✓ Taught"; the next one is outlined with "Next up".
- Breaks are one line ("No school · Mid-Term Break · Mon 12 – Fri 16 Oct"). A holiday inside a week says which lessons move and to when ("Boys 8's lesson moves to Mon 7 Dec").
- A class pushed back by a holiday gets the full reason once, then a short "⏪ One lesson behind" tag.
- Four teaching weeks by default, with *Show earlier weeks* and *Show 4 more weeks*.

**Whole school** (default for school leaders)
- Rows P1–P7 × Monday–Friday for one week. Each class is a small chip with its grade colour, "Week 2 · Islamic", and ● page ready / ○ page coming. The teacher's own classes are outlined.
- Click a chip for the details and links. Grade filter. "Next week: Mid-Term Break" notice. A week with no school is one banner.
- On phones the grid becomes a list by day.

**In the app:** the calendar would be staff-only – a student opening `?p=calendar` goes to their home page.

## Dashboard (teacher)

- **Class tabs** (All my classes · Boys 8 · Girls 8); *Class lists* keeps its red counter; *More* holds student view, Save as PDF and CSV.
- **Tiles:** this week's lesson per class (started and finished, or the day it will be taught); **Need a nudge** – students who haven't finished their last lesson, with *Show them*; average first try with a small trend line; share at Emerging or above.
- **Lesson overview:** latest four lessons, newest first, as finished / in progress / not started / not taught yet, with the average first try. *Show all*, and a **Table** view.
- **Attainment by strand:** one bar per strand by tier, with the share at Emerging or above, and a **Table** view.
- **Students table – always eight columns:** student · selected lesson · lessons so far · CU · SD · CE · GE · badges. Search, filter chips (*Need a nudge*, *Not started Week N*, *Finished Week N*), sort (class, lowest first try, most behind), and a lesson picker. Phone: one card per student.

**Not changed this round:** the student's own "My progress" page and the class-lists screen.

---

## Branding and logo files

| File (`assets/`) | Size | Used for |
|---|---|---|
| `aisa-lockup-white.png` | 558×96 | Top bar on wide screens (shown 40 px high) |
| `aisa-monogram-white.png` | 96×96 | Top bar on narrow screens |
| `aisa-seal-white.png` | 256×256 | Purple footer |
| `aisa-lockup-purple.png` | 558×96 | Printed report header (Save as PDF) |
| `aisa-monogram-purple.png`, `favicon.png` | 96×96, 64×64 | Light backgrounds, browser tab |

Made from the files provided (trimmed and resized only, colours untouched). The logos' own purple is a little bluer than the brand purple `#21076C`, so the white versions are used on purple.
**For the build:** Apps Script cannot serve image files, so `build.py` should inline these PNGs as data URIs (about 75 KB as files, about 100 KB once inlined). The tab icon in the app needs a public URL (`setFaviconUrl`), for example the GitHub Pages copy.

## Colours in the charts

- **Strand tiers** use one purple, light to dark: Not yet `#ECEAF2` (neutral) · Working towards `#a3a7d1` · On track `#8084c0` · Emerging `#6062af` · Proficient `#413a9a` · Advanced `#21076C`. Checked as an ordered scale (lightness always falls, steps ≥ 0.06 apart, lightest step 2.33:1 on white). Dark-mode steps for the real dashboard, checked the same way on `#1a1a19`: `#444582 · #5d5db1 · #7777e3 · #9598ff · #b9befe`.
- **Lesson states** use green / amber / red / grey, always with a shape (●, ◐, ○) and a word, so they never rely on colour alone.

---

## Suggested order of work

1. Shared top bar and footer with the logos on the three pages (`build.py` inlines the images).
2. Student home page: hero + My AI lessons with dates; grade chooser only on the public page.
3. Calendar: My lessons agenda and Whole school timetable; calendar staff-only in the app.
4. Dashboard: tabs, tiles, lesson overview, the eight-column table with the tier menu; phone cards.
5. `build.py` writes `lessons.js`; the home page and calendar read it instead of their own lists.
6. Then: the student "My progress" page and class lists in the same style, Arabic for the new labels, dark mode for the dashboard.

## Decisions needed

- **Staff landing page:** the calendar (today's behaviour) or the dashboard?
- **"Need a nudge":** is "hasn't finished their last lesson" the right rule?
- **Badges column:** keep it in the teacher table, or show badges only in the student view?
- **Words:** "Timetable Week 1 / 2" – or do teachers say A / B? Is "✓ Taught" right for past lessons?
