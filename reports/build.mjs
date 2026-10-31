// docs/ 보고서를 읽어 검색·목차가 있는 단일 HTML 뷰어(dist/index.html)를 만든다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const docs = path.join(here, '..', 'docs');
const list = JSON.parse(fs.readFileSync(path.join(here, 'reports.json'), 'utf8'));

function parseTxt(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const title = lines.slice(0, 12).map((l) => l.trim()).filter(Boolean);
  const header = lines.map((l) => l.trim()).find((l) => /^\S.*\S$/.test(l) && lines.filter((x) => x.trim() === l).length > 5);
  const isHead = (l) => /^(\d+(\.\d+)*\.?|부록 [A-Z]\.)\s+\S/.test(l) && !/\s{3,}\d+\s*$/.test(l) && !/\. \. \./.test(l) && l.length < 60;
  const sections = [];
  let cur = { title: '표지·목차', level: 1, body: [] };
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (/^\s*\d+\s*$/.test(l)) continue; // 쪽 번호
    if (header && l.trim() === header) continue; // 반복 머리글
    if (isHead(l)) {
      sections.push(cur);
      const num = l.match(/^(\d+(?:\.\d+)*)/);
      const level = num ? num[1].split('.').length : 1;
      cur = { title: l.trim(), level, body: [] };
      continue;
    }
    cur.body.push(l);
  }
  sections.push(cur);
  // PDF에서 옮기며 생긴 줄바꿈을 문단으로 이어 붙인다(표처럼 칸을 띄운 줄은 그대로 둔다).
  const prose = (l) => l.trim() && !/\S\s{3,}\S/.test(l) && !/^\s/.test(l);
  for (const s of sections) {
    const out = [];
    for (const l of s.body) {
      const prev = out[out.length - 1];
      if (prev !== undefined && prose(prev) && prose(l) && !/^[-•·※▶①-⑳\d]/.test(l.trim())) out[out.length - 1] = prev + ' ' + l.trim();
      else out.push(l);
    }
    s.body = out;
  }
  for (const s of sections) s.body = s.body.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\s+$/g, '');
  return { subtitle: title.slice(0, 3).join(' · '), sections: sections.filter((s) => s.body || s.level > 0) };
}

function parseMd(text) {
  const sections = [];
  let cur = { title: '머리말', level: 1, body: [] };
  for (const l of text.replace(/\r/g, '').split('\n')) {
    const m = l.match(/^(#{1,4})\s+(.*)/);
    if (m) {
      sections.push(cur);
      cur = { title: m[2], level: Math.max(1, m[1].length - 1), body: [] };
    } else cur.body.push(l);
  }
  sections.push(cur);
  for (const s of sections) s.body = s.body.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { subtitle: '', sections: sections.filter((s) => s.body || s.level === 1) };
}

const reports = list.map((r) => {
  const text = fs.readFileSync(path.join(docs, r.file), 'utf8');
  const parsed = r.file.endsWith('.md') ? parseMd(text) : parseTxt(text);
  return { ...r, ...parsed, chars: text.length };
});

const tpl = fs.readFileSync(path.join(here, 'viewer.html'), 'utf8');
const data = JSON.stringify(reports).replace(/</g, '\\u003c');
const out = tpl.replace('/*__DATA__*/null', data);
const dist = path.join(here, 'dist');
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), out);
console.log(`보고서 ${reports.length}건, 절 ${reports.reduce((n, r) => n + r.sections.length, 0)}개 → dist/index.html`);
