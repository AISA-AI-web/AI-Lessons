/* Public site only: a Main course lesson stays closed until a class in its grade reaches
   that week on the school timetable (AICAL.releasedForGrade in school-calendar.js).
   Signed-in staff see every lesson through the app; there the server decides instead,
   and build.py leaves this script out. */
(function () {
  if (window.APP || !window.AICAL) return;
  var m = /grade-(\d+)\/main-w(\d+)-/.exec(location.pathname);
  if (!m) return;
  var grade = +m[1], week = +m[2];
  if (week <= AICAL.releasedForGrade(grade, new Date())) return;
  var d = AICAL.opensOnGrade(grade, week);
  var when = d ? d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
  var hide = document.createElement('style');
  hide.textContent = 'body>*:not(.lesson-closed){display:none!important}';
  document.head.appendChild(hide);
  document.addEventListener('DOMContentLoaded', function () {
    var box = document.createElement('main');
    box.className = 'lesson-closed';
    box.style.cssText = 'font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;max-width:560px;margin:60px auto;padding:0 16px;color:#1a1a1a';
    box.innerHTML = '<h1 style="font-size:26px">🔒 Not open yet</h1>' +
      '<p>Grade ' + grade + ' Main course <b>Week ' + week + '</b> opens' + (when ? ' on <b>' + when + '</b>' : ' when classes reach it') + '.</p>' +
      '<p dir="rtl" lang="ar">🔒 هذا الدرس غير متاح بعد. سيُفتح عندما يصل إليه صفّك.</p>' +
      '<p style="color:#555">Teachers: sign in to the school AI Curriculum app to open upcoming lessons.</p>' +
      '<p><a href="../index.html">← All lessons</a></p>';
    document.body.appendChild(box);
    document.title = 'Not open yet – Grade ' + grade + ' Week ' + week;
  });
})();
