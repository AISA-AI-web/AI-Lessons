#!/usr/bin/env python3
"""Builds app/build/ for `clasp push`: the Apps Script source plus a copy of
every page of the public site (index, calendar and each lesson)."""
import glob, os, re, shutil
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'build')
shutil.rmtree(OUT, ignore_errors=True)
shutil.copytree(os.path.join(ROOT, 'app', 'src'), OUT)
pages = ['index.html', 'calendar.html'] + sorted(glob.glob('grade-*/*.html', root_dir=ROOT))
for p in pages:
    dest = os.path.join(OUT, 'site', p)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    html = open(os.path.join(ROOT, p), encoding='utf-8').read()
    if not re.search(r'<head>', html, re.I):
        raise SystemExit(f'{p}: no <head> tag for the sign-in bridge')
    if p.startswith('grade-') and 'LessonHooks' not in html:
        raise SystemExit(f'{p}: missing the LessonHooks line in update() – scores would not be saved')
    open(dest, 'w', encoding='utf-8').write(html)
print(f'Built {len(pages)} pages into app/build/')
