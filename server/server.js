'use strict';
/* ============================================================
   IndexPrep — REST API server (Node built-in http, zero deps)
   Run:  node server.js       (defaults to port 4000)
   The backend is AUTHORITATIVE: it decides correctness, enforces
   the Index-Questions gate, stores attempts, and builds feedback.
   ============================================================ */
const http = require('http');
const fs = require('fs');
const pathmod = require('path');
const { all, get, run, seed } = require('./db');

const PUBLIC = pathmod.join(__dirname, '..', 'public');
const UPLOADS = pathmod.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogg': 'video/ogg' };
function serveFromDir(res, baseDir, relPath) {
  const full = pathmod.join(baseDir, pathmod.normalize(relPath).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[pathmod.extname(full).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}
function serveStatic(res, pathname) { serveFromDir(res, PUBLIC, pathname === '/' ? '/index.html' : pathname); }

const PORT = process.env.PORT || 4000;
const inserted = seed();
if (inserted) console.log('Seeded fresh database.');

/* ---------- helpers ---------- */
const J = s => { try { return JSON.parse(s); } catch (e) { return null; } };
const topicsOf = cid => all('SELECT id,name FROM topics WHERE chapter_id=?', cid);
function indexRow(r) {
  // NOTE: correct_key is deliberately NOT sent to clients — the server alone
  // decides correctness (see POST /api/attempts). This prevents answer leakage.
  return { id: r.id, chapterId: r.chapter_id, topicId: r.topic_id, stem: r.stem,
    options: J(r.options_json), concept: r.concept, solution: r.solution,
    keyPoints: J(r.key_points_json) || [], note: r.note, noteSource: r.note_source };
}
function mediaOf(qid) {
  const rows = all('SELECT * FROM question_media WHERE question_id=?', qid);
  const card = rows.find(m => m.kind && m.kind.indexOf('flashcard') === 0);
  const vid = rows.find(m => m.kind === 'video');
  return {
    flashcard: card ? { front: card.flashcard_front, back: card.flashcard_back, fileName: card.file_name, fileType: card.file_type, fileUrl: card.file_url || '' } : null,
    video: vid ? { title: vid.title, duration: vid.duration, fileName: vid.file_name, fileUrl: vid.file_url || '' } : null
  };
}
function mapsOf(bid) {
  return all('SELECT * FROM question_index_map WHERE bank_question_id=?', bid)
    .map(m => ({ indexId: m.index_question_id, score: m.score, status: m.status, rationale: m.rationale }));
}
function bankRow(r) {
  // correct_key intentionally omitted from client payload (server-authoritative).
  return { id: r.id, chapterId: r.chapter_id, topics: J(r.topics_json), stem: r.stem, options: J(r.options_json),
    solution: r.solution, difficulty: r.difficulty, review: r.review_status,
    noMatch: !!r.no_match, solutionOnly: !!r.solution_only, maps: mapsOf(r.id) };
}

/* ---------- AI concept matching (deterministic stand-in) ---------- */
const STOP = { a:1,an:1,the:1,of:1,to:1,for:1,on:1,in:1,is:1,and:1,with:1,about:1,its:1,known:1,body:1,which:1,find:1 };
const tokens = s => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP[w]);
function overlap(a, b) {
  const A = tokens(a), setB = {}; tokens(b).forEach(w => setB[w] = 1);
  let sh = 0; A.forEach(w => { if (setB[w]) sh++; });
  const bl = tokens(b).length; return bl ? Math.min(1, sh / Math.max(3, bl * 0.6)) : 0;
}
function matchBank(chapterId, topics, stem) {
  const res = [];
  all('SELECT * FROM index_questions WHERE chapter_id=? AND active=1', chapterId).forEach(iq => {
    const share = topics.indexOf(iq.topic_id) >= 0;
    const score = (share ? 0.6 : 0) + overlap(stem, iq.stem + ' ' + (iq.concept || '')) * 0.4;
    if (score >= 0.5) res.push({ indexId: iq.id, score: Math.round(score * 100) / 100, status: 'ai_suggested',
      rationale: (share ? 'Shares the topic "' + (topicsOf(chapterId).find(t=>t.id===iq.topic_id)||{}).name + '"' : 'Overlapping concept') + ' and key terms with "' + iq.concept + '".' });
  });
  res.sort((a, b) => b.score - a.score);
  return res.slice(0, 2);
}

/* ---------- route table ---------- */
const routes = [];
const on = (method, pattern, handler) => routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });

/* CONTENT (read) */
on('GET', '/api/subjects', () => all('SELECT * FROM subjects'));
on('GET', '/api/chapters', (p, q) => {
  const rows = q.subject ? all('SELECT * FROM chapters WHERE subject_id=? ORDER BY ord', q.subject) : all('SELECT * FROM chapters ORDER BY ord');
  return rows.map(c => ({ id: c.id, subjectId: c.subject_id, name: c.name,
    indexCount: get('SELECT COUNT(*) c FROM index_questions WHERE chapter_id=?', c.id).c,
    bankCount: get('SELECT COUNT(*) c FROM bank_questions WHERE chapter_id=?', c.id).c,
    pendingCount: get("SELECT COUNT(*) c FROM bank_questions WHERE chapter_id=? AND review_status='pending'", c.id).c }));
});
on('GET', '/api/chapters/:id', p => {
  const c = get('SELECT * FROM chapters WHERE id=?', p.id); if (!c) return null;
  return { id: c.id, subjectId: c.subject_id, name: c.name, topics: topicsOf(c.id) };
});
on('GET', '/api/chapters/:id/topics', p => topicsOf(p.id));
on('GET', '/api/chapters/:id/index-questions', p =>
  all('SELECT * FROM index_questions WHERE chapter_id=? AND active=1', p.id).map(r => Object.assign(indexRow(r), { media: mediaOf(r.id) })));
on('GET', '/api/chapters/:id/bank-questions', p =>
  all('SELECT * FROM bank_questions WHERE chapter_id=?', p.id).map(bankRow));
on('GET', '/api/chapters/:id/review-queue', p =>
  all("SELECT * FROM bank_questions WHERE chapter_id=? AND review_status='pending'", p.id).map(bankRow));
on('GET', '/api/index-questions/:id', p => {
  const r = get('SELECT * FROM index_questions WHERE id=?', p.id); if (!r) return null;
  return Object.assign(indexRow(r), { media: mediaOf(r.id) });
});

/* STUDENT — attempt (server decides correctness + builds feedback) */
on('POST', '/api/attempts', (p, q, body) => {
  const { studentId, questionId, questionType, section, chapterId } = body;
  const chosen = body.chosenKey;
  let correctKey, solution, topics, indexIds, feedback = {};
  if (questionType === 'index') {
    const iq = get('SELECT * FROM index_questions WHERE id=?', questionId);
    correctKey = iq.correct_key; solution = iq.solution; topics = [iq.topic_id]; indexIds = [iq.id];
    feedback = { keyPoints: J(iq.key_points_json) || [], note: iq.note, noteSource: iq.note_source, media: mediaOf(iq.id) };
  } else {
    const bq = get('SELECT * FROM bank_questions WHERE id=?', questionId);
    correctKey = bq.correct_key; solution = bq.solution; topics = J(bq.topics_json);
    const approved = mapsOf(bq.id).filter(m => m.status === 'sme_approved' || m.status === 'manual');
    indexIds = approved.map(m => m.indexId);
    feedback = { mappedIndex: approved.map(m => { const iq = get('SELECT * FROM index_questions WHERE id=?', m.indexId); return { id: iq.id, concept: iq.concept, stem: iq.stem, correctText: (J(iq.options_json).find(o=>o[0]===iq.correct_key)||[])[1] }; }) };
  }
  const isCorrect = chosen === correctKey ? 1 : 0;
  run('INSERT INTO attempts(student_id,question_id,question_type,section,chapter_id,topics_json,index_ids_json,is_correct,chosen_key) VALUES(?,?,?,?,?,?,?,?,?)',
    studentId, questionId, questionType, section, chapterId, JSON.stringify(topics), JSON.stringify(indexIds), isCorrect, chosen);
  // save a note on a missed index question
  if (questionType === 'index' && !isCorrect && feedback.note) {
    try { run('INSERT OR IGNORE INTO notes(student_id,chapter_id,question_id,concept,note,source,key_points_json) VALUES(?,?,?,?,?,?,?)',
      studentId, chapterId, questionId, (get('SELECT concept FROM index_questions WHERE id=?', questionId)||{}).concept, feedback.note, feedback.noteSource, JSON.stringify(feedback.keyPoints)); } catch (e) {}
  }
  return { correct: !!isCorrect, correctKey, solution, feedback };
});

/* STUDENT — gating / progress */
on('GET', '/api/progress/:studentId/:chapterId', p => {
  const row = get('SELECT * FROM chapter_progress WHERE student_id=? AND chapter_id=?', p.studentId, p.chapterId);
  const done = row ? !!row.index_completed : false;
  const total = get('SELECT COUNT(*) c FROM index_questions WHERE chapter_id=?', p.chapterId).c;
  const attempted = get('SELECT COUNT(DISTINCT question_id) c FROM attempts WHERE student_id=? AND chapter_id=? AND section=?', p.studentId, p.chapterId, 'index').c;
  return { indexCompleted: done, indexTotal: total, indexAttempted: attempted, unlocked: done };
});
on('POST', '/api/progress/complete-index', (p, q, body) => {
  const { studentId, chapterId } = body;
  const total = get('SELECT COUNT(*) c FROM index_questions WHERE chapter_id=?', chapterId).c;
  const attempted = get('SELECT COUNT(DISTINCT question_id) c FROM attempts WHERE student_id=? AND chapter_id=? AND section=?', studentId, chapterId, 'index').c;
  if (attempted < total) return { ok: false, reason: 'Not all index questions attempted', attempted, total };
  run('INSERT INTO chapter_progress(student_id,chapter_id,index_completed,completed_at) VALUES(?,?,1,datetime(\'now\')) ON CONFLICT(student_id,chapter_id) DO UPDATE SET index_completed=1, completed_at=datetime(\'now\')', studentId, chapterId);
  return { ok: true, unlocked: true };
});

/* STUDENT — notes + weak areas */
on('GET', '/api/notes/:studentId', p =>
  all('SELECT * FROM notes WHERE student_id=? ORDER BY created_at DESC', p.studentId).map(n => ({
    chapterId: n.chapter_id, questionId: n.question_id, concept: n.concept, note: n.note, source: n.source, keyPoints: J(n.key_points_json) || [] })));
on('GET', '/api/weak-areas/:studentId/:chapterId', p => {
  const rows = all("SELECT * FROM attempts WHERE student_id=? AND chapter_id=? AND section!='index'", p.studentId, p.chapterId);
  const stat = {};
  rows.forEach(a => (J(a.index_ids_json) || []).forEach(id => { stat[id] = stat[id] || { tot: 0, wrong: 0 }; stat[id].tot++; if (!a.is_correct) stat[id].wrong++; }));
  return Object.keys(stat).filter(id => stat[id].wrong > 0).map(id => {
    const iq = get('SELECT concept FROM index_questions WHERE id=?', id) || {};
    return { indexId: id, concept: iq.concept, wrong: stat[id].wrong, accuracy: Math.round((stat[id].tot - stat[id].wrong) / stat[id].tot * 100) };
  }).sort((a, b) => b.wrong - a.wrong);
});

/* SME — file upload (flashcard image/PDF, video). Base64 in, stored on disk, URL out. */
let uploadSeq = 0;
on('POST', '/api/upload', (p, q, body) => {
  const name = String(body.name || 'file');
  const ext = (name.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
  const type = String(body.type || '');
  const fileType = (/pdf/.test(type) || ext === '.pdf') ? 'pdf'
    : (/jpe?g/.test(type) || ext === '.jpg' || ext === '.jpeg') ? 'jpeg'
    : (/png/.test(type) || ext === '.png') ? 'png'
    : (type.split('/')[0] === 'video' || ['.mp4', '.webm', '.mov', '.ogg'].includes(ext)) ? 'video' : 'file';
  const data = Buffer.from(String(body.dataBase64 || ''), 'base64');
  const fname = 'u' + Date.now() + '-' + (uploadSeq++) + (ext || '');
  fs.writeFileSync(pathmod.join(UPLOADS, fname), data);
  return { url: '/uploads/' + fname, fileName: name, fileType };
});

/* SME — create a topic (so it appears in the dropdown while authoring) */
on('POST', '/api/topics', (p, q, body) => {
  const c = get('SELECT * FROM chapters WHERE id=?', body.chapterId);
  if (!c) return null;
  const name = String(body.name || '').trim();
  if (!name) return { error: 'name required' };
  // if a topic with the same name already exists in this chapter, reuse it (idempotent)
  const existing = get('SELECT * FROM topics WHERE chapter_id=? AND lower(name)=lower(?)', body.chapterId, name);
  if (existing) return { id: existing.id, chapterId: existing.chapter_id, name: existing.name, existed: true };
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'topic';
  let id = base, i = 2;
  while (get('SELECT 1 x FROM topics WHERE id=?', id)) { id = base + '-' + i; i++; }
  run('INSERT INTO topics(id,chapter_id,name) VALUES(?,?,?)', id, body.chapterId, name);
  return { id, chapterId: body.chapterId, name };
});

/* SME — create index question */
on('POST', '/api/index-questions', (p, q, body) => {
  const c = get('SELECT * FROM chapters WHERE id=?', body.chapterId);
  const prefix = get('SELECT prefix FROM subjects WHERE id=?', c.subject_id).prefix;
  const nextNum = 150 + get('SELECT COUNT(*) c FROM index_questions').c;
  const id = prefix + '-' + nextNum;
  run('INSERT INTO index_questions(id,chapter_id,topic_id,stem,options_json,correct_key,concept,solution,key_points_json,note,note_source) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    id, body.chapterId, body.topicId, body.stem, JSON.stringify(body.options || []), body.correct, body.concept || '(concept)', body.solution || '',
    JSON.stringify(body.keyPoints || []), body.note || '', 'SME');
  if (body.flashcardFront || body.flashcardFileName)
    run('INSERT INTO question_media(question_id,question_type,kind,flashcard_front,flashcard_back,file_name,file_type,file_url) VALUES(?,?,?,?,?,?,?,?)',
      id, 'index', body.flashcardFileName ? 'flashcard_file' : 'flashcard_text', body.flashcardFront || '', body.flashcardBack || '', body.flashcardFileName || '', body.flashcardFileType || '', body.flashcardFileUrl || '');
  if (body.videoName)
    run('INSERT INTO question_media(question_id,question_type,kind,title,file_name,file_type,file_url) VALUES(?,?,?,?,?,?,?)', id, 'index', 'video', body.videoTitle || 'Video explanation', body.videoName, 'video', body.videoUrl || '');
  return { id };
});

/* SME — create bank question + run AI match */
on('POST', '/api/bank-questions', (p, q, body) => {
  const cnt = get('SELECT COUNT(*) c FROM bank_questions').c;
  const id = 'B' + (cnt + 1) + '-' + Date.now().toString().slice(-4);
  const suggestions = matchBank(body.chapterId, body.topics || [], body.stem || '');
  const noMatch = suggestions.length === 0 ? 1 : 0;
  run('INSERT INTO bank_questions(id,chapter_id,topics_json,stem,options_json,correct_key,solution,review_status,no_match,solution_only) VALUES(?,?,?,?,?,?,?,?,?,?)',
    id, body.chapterId, JSON.stringify(body.topics || []), body.stem, JSON.stringify(body.options || []), body.correct || null, body.solution || '', 'pending', noMatch, 0);
  suggestions.forEach(m => run('INSERT INTO question_index_map(bank_question_id,index_question_id,score,status,rationale) VALUES(?,?,?,?,?)', id, m.indexId, m.score, m.status, m.rationale));
  return { id, suggestions, noMatch: !!noMatch };
});

/* SME — approve / remap / no-match */
on('POST', '/api/bank-questions/:id/approve', p => {
  run("UPDATE question_index_map SET status='sme_approved' WHERE bank_question_id=?", p.id);
  run("UPDATE bank_questions SET review_status='done', no_match=0 WHERE id=?", p.id);
  return bankRow(get('SELECT * FROM bank_questions WHERE id=?', p.id));
});
on('POST', '/api/bank-questions/:id/remap', (p, q, body) => {
  run('DELETE FROM question_index_map WHERE bank_question_id=?', p.id);
  (body.indexIds || []).forEach(iid => {
    const iq = get('SELECT concept FROM index_questions WHERE id=?', iid) || {};
    run('INSERT INTO question_index_map(bank_question_id,index_question_id,score,status,rationale) VALUES(?,?,?,?,?)', p.id, iid, 1, 'manual', 'Manually mapped by SME to "' + iq.concept + '".');
  });
  run("UPDATE bank_questions SET review_status='done', no_match=0 WHERE id=?", p.id);
  return bankRow(get('SELECT * FROM bank_questions WHERE id=?', p.id));
});
on('POST', '/api/bank-questions/:id/no-match', p => {
  run('DELETE FROM question_index_map WHERE bank_question_id=?', p.id);
  run("UPDATE bank_questions SET no_match=1, review_status='pending' WHERE id=?", p.id);
  return bankRow(get('SELECT * FROM bank_questions WHERE id=?', p.id));
});
on('POST', '/api/bank-questions/:id/solution-only', p => {
  run('DELETE FROM question_index_map WHERE bank_question_id=?', p.id);
  run("UPDATE bank_questions SET solution_only=1, no_match=0, review_status='done' WHERE id=?", p.id);
  return bankRow(get('SELECT * FROM bank_questions WHERE id=?', p.id));
});

/* SME — dashboard stats */
on('GET', '/api/stats', () => {
  const chapters = all('SELECT * FROM chapters');
  let pending = 0;
  chapters.forEach(c => { pending += get("SELECT COUNT(*) c FROM bank_questions WHERE chapter_id=? AND review_status='pending'", c.id).c; });
  return {
    subjects: get('SELECT COUNT(*) c FROM subjects').c,
    chaptersWithContent: chapters.filter(c => get('SELECT COUNT(*) c FROM index_questions WHERE chapter_id=?', c.id).c > 0).length,
    indexQuestions: get('SELECT COUNT(*) c FROM index_questions').c,
    bankQuestions: get('SELECT COUNT(*) c FROM bank_questions').c,
    pending, topics: get('SELECT COUNT(*) c FROM topics').c
  };
});

/* ---------- router ---------- */
function match(method, pathname) {
  const segs = pathname.split('/').filter(Boolean);
  for (const r of routes) {
    if (r.method !== method || r.parts.length !== segs.length) continue;
    const params = {}; let ok = true;
    for (let i = 0; i < r.parts.length; i++) {
      if (r.parts[i][0] === ':') params[r.parts[i].slice(1)] = decodeURIComponent(segs[i]);
      else if (r.parts[i] !== segs[i]) { ok = false; break; }
    }
    if (ok) return { handler: r.handler, params };
  }
  return null;
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const query = Object.fromEntries(url.searchParams);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }

  // serve uploaded files (flashcard images/PDFs, videos)
  if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) return serveFromDir(res, UPLOADS, url.pathname.replace('/uploads/', '/'));
  // serve the front-end (anything not under /api) as static files
  if (req.method === 'GET' && !url.pathname.startsWith('/api')) return serveStatic(res, url.pathname);

  const m = match(req.method, url.pathname);
  if (!m) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'not found' })); }

  let raw = '';
  req.on('data', c => raw += c);
  req.on('end', () => {
    let body = {}; if (raw) { try { body = JSON.parse(raw); } catch (e) {} }
    try {
      const out = m.handler(m.params, query, body);
      res.writeHead(out == null ? 404 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out == null ? { error: 'not found' } : out));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e && e.message || e) }));
    }
  });
});
server.listen(PORT, () => console.log('IndexPrep API on http://localhost:' + PORT));
