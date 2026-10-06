/* Checks lessons.js – the lesson list the home page and the calendar read – matches the lesson files.
   If it fails: run `python3 app/build.py` and commit lessons.js. */
const assert = require('assert'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const LIST = require(path.join(ROOT, 'lessons.js'));
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', nbsp: ' ', hellip: '…' };
const plain = s => s.replace(/<[^>]+>/g, ' ')
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENT[e] || m))
  .replace(/\s+/g, ' ').trim();
const files = fs.readdirSync(ROOT).filter(f => /^grade-\d+$/.test(f))
  .flatMap(g => fs.readdirSync(path.join(ROOT, g)).filter(f => /^(main|bridging)-w\d+-.+\.html$/.test(f)).map(f => g + '/' + f));
ok(LIST.length === files.length, `lessons.js lists every lesson file (${LIST.length} of ${files.length}) – run python3 app/build.py and commit lessons.js`);
files.forEach(f => {
  const id = f.replace(/\.html$/, ''), l = LIST.find(x => x.id === id), src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  ok(l, id + ' is in lessons.js – run python3 app/build.py');
  const m = /^grade-(\d+)\/(main|bridging)-w(\d+)/.exec(id);
  ok(l.grade === Number(m[1]) && l.course === m[2] && l.week === Number(m[3]), id + ': grade, course and week');
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(src);
  ok(!h1 || l.title === plain(h1[1]), id + ': title matches the lesson heading');
  ok(l.activities === (src.match(/^ \{id:"/gm) || []).length, id + ': activity count');
});
console.log('All ' + n + ' site checks passed');
