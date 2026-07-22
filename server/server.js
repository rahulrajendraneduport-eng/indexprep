'use strict';
/* ============================================================
   IndexPrep — REST API server
   Works on SQLite (local) or Postgres (production) — selected in db.js.
   The backend is AUTHORITATIVE: it decides correctness, enforces the
   Index-Questions gate, stores attempts, and builds feedback.
   ============================================================ */
const http = require('http');
const fs = require('fs');
const pathmod = require('path');
const db = require('./db');
const { all, get, run } = db;

const PUBLIC = pathmod.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogg': 'video/ogg' };
function serveStatic(res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const full = pathmod.join(PUBLIC, pathmod.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[pathmod.extname(full).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}
const PORT = process.env.PORT || 4000;

/* ---------- helpers ---------- */
const J = s => { try { return JSON.parse(s); } catch (e) { return null; } };
const cnt = async (sql, ...p) => (await get(sql, ...p)).c;   // sql must select CAST(COUNT(...) AS INTEGER) AS c
const topicsOf = cid => all('SELECT id,name FROM topics WHERE chapter_id=?', cid);
function indexRow(r) {
  return { id: r.id, chapterId: r.chapter_id, topicId: r.topic_id, stem: r.stem,
    options: J(r.options_json), concept: r.concept, solution: r.solution,
    keyPoints: J(r.key_points_json) || [], note: r.note, noteSource: r.note_source };
}
async function mediaOf(qid) {
  const rows = await all('SELECT * FROM question_media WHERE question_id=?', qid);
  const card = rows.find(m => m.kind && m.kind.indexOf('flashcard') === 0);
  const vid = rows.find(m => m.kind === 'video');
  return {
    flashcard: card ? { front: card.flashcard_front, back: card.flashcard_back, fileName: card.file_name, fileType: card.file_type, fileUrl: card.file_url || '' } : null,
    video: vid ? { title: vid.title, duration: vid.duration, fileName: vid.file_name, fileUrl: vid.file_url || '' } : null
  };
}
async function mapsOf(bid) {
  return (await all('SELECT * FROM question_index_map WHERE bank_question_id=?', bid))
    .map(m => ({ indexId: m.index_question_id, score: m.score, status: m.status, rationale: m.rationale }));
}
async function bankRow(r) {
  return { id: r.id, chapterId: r.chapter_id, topics: J(r.topics_json), stem: r.stem, options: J(r.options_json),
    solution: r.solution, difficulty: r.difficulty, review: r.review_status,
    noMatch: !!r.no_match, solutionOnly: !!r.solution_only, maps: await mapsOf(r.id) };
}

/* ---------- AI concept matching (deterministic stand-in) ---------- */
const STOP = { a:1,an:1,the:1,of:1,to:1,for:1,on:1,in:1,is:1,and:1,with:1,about:1,its:1,known:1,body:1,which:1,find:1 };
const tokens = s => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP[w]);
function overlap(a, b) {
  const A = tokens(a), setB = {}; tokens(b).forEach(w => setB[w] = 1);
  let sh = 0; A.forEach(w => { if (setB[w]) sh++; });
  const bl = tokens(b).length; return bl ? Math.min(1, sh / Math.max(3, bl * 0.6)) : 0;
}
async function matchBank(chapterId, topics, stem) {
  const iqs = await all('SELECT * FROM index_questions WHERE chapter_id=? AND active=1', chapterId);
  const tnames = await topicsOf(chapterId);
  const res = [];
  iqs.forEach(iq => {
    const share = topics.indexOf(iq.topic_id) >= 0;
    const score = (share ? 0.6 : 0) + overlap(stem, iq.stem + ' ' + (iq.concept || '')) * 0.4;
    if (score >= 0.5) res.push({ indexId: iq.id, score: Math.round(score * 100) / 100, status: 'ai_suggested',
      rationale: (share ? 'Shares the topic "' + (tnames.find(t => t.id === iq.topic_id) || {}).name + '"' : 'Overlapping concept') + ' and key terms with "' + iq.concept + '".' });
  });
  res.sort((a, b) => b.score - a.score);
  return res.slice(0, 2);
}

/* ---------- route table ---------- */
const routes = [];
const on = (method, pattern, handler) => routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });

/* CONTENT (read) */
on('GET', '/api/courses', () => all('SELECT * FROM courses ORDER BY ord'));
on('GET', '/api/subjects', (p, q) => q.course
  ? all('SELECT * FROM subjects WHERE course_id=? ORDER BY ord', q.course)
  : all('SELECT * FROM subjects ORDER BY ord'));
on('GET', '/api/chapters', async (p, q) => {
  const rows = q.subject ? await all('SELECT * FROM chapters WHERE subject_id=? ORDER BY ord', q.subject) : await all('SELECT * FROM chapters ORDER BY ord');
  const out = [];
  for (const c of rows) out.push({ id: c.id, subjectId: c.subject_id, name: c.name,
    indexCount: await cnt('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM index_questions WHERE chapter_id=?', c.id),
    bankCount: await cnt('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM bank_questions WHERE chapter_id=?', c.id),
    pendingCount: await cnt("SELECT CAST(COUNT(*) AS INTEGER) AS c FROM bank_questions WHERE chapter_id=? AND review_status='pending'", c.id) });
  return out;
});
on('GET', '/api/chapters/:id', async p => {
  const c = await get('SELECT * FROM chapters WHERE id=?', p.id); if (!c) return null;
  return { id: c.id, subjectId: c.subject_id, name: c.name, topics: await topicsOf(c.id) };
});
on('GET', '/api/chapters/:id/topics', p => topicsOf(p.id));
on('GET', '/api/chapters/:id/index-questions', async p => {
  const rows = await all('SELECT * FROM index_questions WHERE chapter_id=? AND active=1', p.id);
  return Promise.all(rows.map(async r => Object.assign(indexRow(r), { media: await mediaOf(r.id) })));
});
on('GET', '/api/chapters/:id/bank-questions', async p =>
  Promise.all((await all('SELECT * FROM bank_questions WHERE chapter_id=?', p.id)).map(bankRow)));
on('GET', '/api/chapters/:id/review-queue', async p =>
  Promise.all((await all("SELECT * FROM bank_questions WHERE chapter_id=? AND review_status='pending'", p.id)).map(bankRow)));
on('GET', '/api/index-questions/:id', async p => {
  const r = await get('SELECT * FROM index_questions WHERE id=?', p.id); if (!r) return null;
  return Object.assign(indexRow(r), { media: await mediaOf(r.id) });
});

/* STUDENT — attempt (server decides correctness + builds feedback) */
on('POST', '/api/attempts', async (p, q, body) => {
  const { studentId, questionId, questionType, section, chapterId } = body;
  const chosen = body.chosenKey;
  let correctKey, solution, topics, indexIds, feedback = {};
  if (questionType === 'index') {
    const iq = await get('SELECT * FROM index_questions WHERE id=?', questionId);
    correctKey = iq.correct_key; solution = iq.solution; topics = [iq.topic_id]; indexIds = [iq.id];
    feedback = { keyPoints: J(iq.key_points_json) || [], note: iq.note, noteSource: iq.note_source, media: await mediaOf(iq.id) };
  } else {
    const bq = await get('SELECT * FROM bank_questions WHERE id=?', questionId);
    correctKey = bq.correct_key; solution = bq.solution; topics = J(bq.topics_json);
    const approved = (await mapsOf(bq.id)).filter(m => m.status === 'sme_approved' || m.status === 'manual');
    indexIds = approved.map(m => m.indexId);
    feedback = { mappedIndex: await Promise.all(approved.map(async m => {
      const iq = await get('SELECT * FROM index_questions WHERE id=?', m.indexId);
      return { id: iq.id, concept: iq.concept, stem: iq.stem, correctText: (J(iq.options_json).find(o => o[0] === iq.correct_key) || [])[1] };
    })) };
  }
  const isCorrect = chosen === correctKey ? 1 : 0;
  await run('INSERT INTO attempts(student_id,question_id,question_type,section,chapter_id,topics_json,index_ids_json,is_correct,chosen_key) VALUES(?,?,?,?,?,?,?,?,?)',
    studentId, questionId, questionType, section, chapterId, JSON.stringify(topics), JSON.stringify(indexIds), isCorrect, chosen);
  if (questionType === 'index' && !isCorrect && feedback.note) {
    const concept = (await get('SELECT concept FROM index_questions WHERE id=?', questionId) || {}).concept;
    try {
      await run('INSERT INTO notes(student_id,chapter_id,question_id,concept,note,source,key_points_json) VALUES(?,?,?,?,?,?,?) ON CONFLICT(student_id,question_id) DO NOTHING',
        studentId, chapterId, questionId, concept, feedback.note, feedback.noteSource, JSON.stringify(feedback.keyPoints));
    } catch (e) {}
  }
  return { correct: !!isCorrect, correctKey, solution, feedback };
});

/* STUDENT — gating / progress */
on('GET', '/api/progress/:studentId/:chapterId', async p => {
  const row = await get('SELECT * FROM chapter_progress WHERE student_id=? AND chapter_id=?', p.studentId, p.chapterId);
  const done = row ? !!row.index_completed : false;
  const total = await cnt('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM index_questions WHERE chapter_id=?', p.chapterId);
  const attempted = await cnt("SELECT CAST(COUNT(DISTINCT question_id) AS INTEGER) AS c FROM attempts WHERE student_id=? AND chapter_id=? AND section='index'", p.studentId, p.chapterId);
  return { indexCompleted: done, indexTotal: total, indexAttempted: attempted, unlocked: done };
});
on('POST', '/api/progress/complete-index', async (p, q, body) => {
  const { studentId, chapterId } = body;
  const total = await cnt('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM index_questions WHERE chapter_id=?', chapterId);
  const attempted = await cnt("SELECT CAST(COUNT(DISTINCT question_id) AS INTEGER) AS c FROM attempts WHERE student_id=? AND chapter_id=? AND section='index'", studentId, chapterId);
  if (attempted < total) return { ok: false, reason: 'Not all index questions attempted', attempted, total };
  const ts = new Date().toISOString();
  await run('INSERT INTO chapter_progress(student_id,chapter_id,index_completed,completed_at) VALUES(?,?,1,?) ON CONFLICT(student_id,chapter_id) DO UPDATE SET index_completed=1, completed_at=?',
    studentId, chapterId, ts, ts);
  return { ok: true, unlocked: true };
});

/* STUDENT — notes + weak areas */
on('GET', '/api/notes/:studentId', async p =>
  (await all('SELECT * FROM notes WHERE student_id=? ORDER BY created_at DESC', p.studentId)).map(n => ({
    chapterId: n.chapter_id, questionId: n.question_id, concept: n.concept, note: n.note, source: n.source, keyPoints: J(n.key_points_json) || [] })));
on('GET', '/api/weak-areas/:studentId/:chapterId', async p => {
  const rows = await all("SELECT * FROM attempts WHERE student_id=? AND chapter_id=? AND section!='index'", p.studentId, p.chapterId);
  const stat = {};
  rows.forEach(a => (J(a.index_ids_json) || []).forEach(id => { stat[id] = stat[id] || { tot: 0, wrong: 0 }; stat[id].tot++; if (!a.is_correct) stat[id].wrong++; }));
  const out = [];
  for (const id of Object.keys(stat).filter(id => stat[id].wrong > 0)) {
    const iq = await get('SELECT concept FROM index_questions WHERE id=?', id) || {};
    out.push({ indexId: id, concept: iq.concept, wrong: stat[id].wrong, accuracy: Math.round((stat[id].tot - stat[id].wrong) / stat[id].tot * 100) });
  }
  return out.sort((a, b) => b.wrong - a.wrong);
});

/* SME — file upload (stored IN the database so it survives redeploys) */
let uploadSeq = 0;
on('POST', '/api/upload', async (p, q, body) => {
  const name = String(body.name || 'file');
  const ext = (name.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
  const type = String(body.type || '');
  const fileType = (/pdf/.test(type) || ext === '.pdf') ? 'pdf'
    : (/jpe?g/.test(type) || ext === '.jpg' || ext === '.jpeg') ? 'jpeg'
    : (/png/.test(type) || ext === '.png') ? 'png'
    : (type.split('/')[0] === 'video' || ['.mp4', '.webm', '.mov', '.ogg'].includes(ext)) ? 'video' : 'file';
  const id = 'u' + Date.now() + '-' + (uploadSeq++) + (ext || '');
  await run('INSERT INTO uploads(id,name,mime,file_type,data) VALUES(?,?,?,?,?)', id, name, type, fileType, String(body.dataBase64 || ''));
  return { url: '/uploads/' + id, fileName: name, fileType };
});

/* SME — create a chapter (course + subject scoped) */
on('POST', '/api/chapters', async (p, q, body) => {
  const subjectId = String(body.subjectId || '');
  const subj = await get('SELECT * FROM subjects WHERE id=?', subjectId);
  if (!subj) return { error: 'Unknown subject' };
  const name = String(body.name || '').trim();
  if (!name) return { error: 'Chapter name required' };
  const ord = 1 + await cnt('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM chapters WHERE subject_id=?', subjectId);
  let base = (subj.course_id + '-' + name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'chapter';
  let id = base, i = 2;
  while (await get('SELECT 1 AS x FROM chapters WHERE id=?', id)) { id = base + '-' + i; i++; }
  await run('INSERT INTO chapters(id,subject_id,name,ord) VALUES(?,?,?,?)', id, subjectId, name, ord);
  return { id, subjectId, name };
});

/* SME — create a topic */
on('POST', '/api/topics', async (p, q, body) => {
  const c = await get('SELECT * FROM chapters WHERE id=?', body.chapterId);
  if (!c) return null;
  const name = String(body.name || '').trim();
  if (!name) return { error: 'name required' };
  const existing = await get('SELECT * FROM topics WHERE chapter_id=? AND lower(name)=lower(?)', body.chapterId, name);
  if (existing) return { id: existing.id, chapterId: existing.chapter_id, name: existing.name, existed: true };
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'topic';
  let id = base, i = 2;
  while (await get('SELECT 1 AS x FROM topics WHERE id=?', id)) { id = base + '-' + i; i++; }
  await run('INSERT INTO topics(id,chapter_id,name) VALUES(?,?,?)', id, body.chapterId, name);
  return { id, chapterId: body.chapterId, name };
});

/* SME — create index question */
on('POST', '/api/index-questions', async (p, q, body) => {
  const c = await get('SELECT * FROM chapters WHERE id=?', body.chapterId);
  const prefix = (await get('SELECT prefix FROM subjects WHERE id=?', c.subject_id)).prefix;
  const nextNum = 150 + await cnt('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM index_questions');
  const id = prefix + '-' + nextNum;
  await run('INSERT INTO index_questions(id,chapter_id,topic_id,stem,options_json,correct_key,concept,solution,key_points_json,note,note_source) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    id, body.chapterId, body.topicId, body.stem, JSON.stringify(body.options || []), body.correct, body.concept || '(concept)', body.solution || '',
    JSON.stringify(body.keyPoints || []), body.note || '', 'SME');
  if (body.flashcardFront || body.flashcardFileName)
    await run('INSERT INTO question_media(question_id,question_type,kind,flashcard_front,flashcard_back,file_name,file_type,file_url) VALUES(?,?,?,?,?,?,?,?)',
      id, 'index', body.flashcardFileName ? 'flashcard_file' : 'flashcard_text', body.flashcardFront || '', body.flashcardBack || '', body.flashcardFileName || '', body.flashcardFileType || '', body.flashcardFileUrl || '');
  if (body.videoName)
    await run('INSERT INTO question_media(question_id,question_type,kind,title,file_name,file_type,file_url) VALUES(?,?,?,?,?,?,?)', id, 'index', 'video', body.videoTitle || 'Video explanation', body.videoName, 'video', body.videoUrl || '');
  return { id };
});

/* SME — create bank question + run AI match */
on('POST', '/api/bank-questions', async (p, q, body) => {
  const num = await cnt('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM bank_questions');
  const id = 'B' + (num + 1) + '-' + Date.now().toString().slice(-4);
  const suggestions = await matchBank(body.chapterId, body.topics || [], body.stem || '');
  const noMatch = suggestions.length === 0 ? 1 : 0;
  await run('INSERT INTO bank_questions(id,chapter_id,topics_json,stem,options_json,correct_key,solution,review_status,no_match,solution_only) VALUES(?,?,?,?,?,?,?,?,?,?)',
    id, body.chapterId, JSON.stringify(body.topics || []), body.stem, JSON.stringify(body.options || []), body.correct || null, body.solution || '', 'pending', noMatch, 0);
  for (const m of suggestions) await run('INSERT INTO question_index_map(bank_question_id,index_question_id,score,status,rationale) VALUES(?,?,?,?,?)', id, m.indexId, m.score, m.status, m.rationale);
  return { id, suggestions, noMatch: !!noMatch };
});

/* SME — approve / remap / no-match / solution-only */
on('POST', '/api/bank-questions/:id/approve', async p => {
  await run("UPDATE question_index_map SET status='sme_approved' WHERE bank_question_id=?", p.id);
  await run("UPDATE bank_questions SET review_status='done', no_match=0 WHERE id=?", p.id);
  return bankRow(await get('SELECT * FROM bank_questions WHERE id=?', p.id));
});
on('POST', '/api/bank-questions/:id/remap', async (p, q, body) => {
  await run('DELETE FROM question_index_map WHERE bank_question_id=?', p.id);
  for (const iid of (body.indexIds || [])) {
    const iq = await get('SELECT concept FROM index_questions WHERE id=?', iid) || {};
    await run('INSERT INTO question_index_map(bank_question_id,index_question_id,score,status,rationale) VALUES(?,?,?,?,?)', p.id, iid, 1, 'manual', 'Manually mapped by SME to "' + iq.concept + '".');
  }
  await run("UPDATE bank_questions SET review_status='done', no_match=0 WHERE id=?", p.id);
  return bankRow(await get('SELECT * FROM bank_questions WHERE id=?', p.id));
});
on('POST', '/api/bank-questions/:id/no-match', async p => {
  await run('DELETE FROM question_index_map WHERE bank_question_id=?', p.id);
  await run("UPDATE bank_questions SET no_match=1, review_status='pending' WHERE id=?", p.id);
  return bankRow(await get('SELECT * FROM bank_questions WHERE id=?', p.id));
});
on('POST', '/api/bank-questions/:id/solution-only', async p => {
  await run('DELETE FROM question_index_map WHERE bank_question_id=?', p.id);
  await run("UPDATE bank_questions SET solution_only=1, no_match=0, review_status='done' WHERE id=?", p.id);
  return bankRow(await get('SELECT * FROM bank_questions WHERE id=?', p.id));
});

/* SME — dashboard stats */
on('GET', '/api/stats', async () => {
  const chapters = await all('SELECT * FROM chapters');
  let pending = 0, chaptersWithContent = 0;
  for (const c of chapters) {
    pending += await cnt("SELECT CAST(COUNT(*) AS INTEGER) AS c FROM bank_questions WHERE chapter_id=? AND review_status='pending'", c.id);
    if (await cnt('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM index_questions WHERE chapter_id=?', c.id) > 0) chaptersWithContent++;
  }
  return {
    subjects: await cnt('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM subjects'),
    chaptersWithContent,
    indexQuestions: await cnt('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM index_questions'),
    bankQuestions: await cnt('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM bank_questions'),
    pending, topics: await cnt('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM topics')
  };
});

/* ---------- serve an uploaded file from the database ---------- */
async function serveUpload(res, id) {
  try {
    const row = await get('SELECT data,file_type,mime FROM uploads WHERE id=?', id);
    if (!row) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const ct = row.mime || (row.file_type === 'pdf' ? 'application/pdf' : row.file_type === 'jpeg' ? 'image/jpeg' : row.file_type === 'png' ? 'image/png' : row.file_type === 'video' ? 'video/mp4' : 'application/octet-stream');
    const buf = Buffer.from(row.data || '', 'base64');
    res.writeHead(200, { 'Content-Type': ct }); res.end(buf);
  } catch (e) { res.writeHead(500); res.end('error'); }
}

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
  if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) return serveUpload(res, decodeURIComponent(url.pathname.slice('/uploads/'.length)));
  if (req.method === 'GET' && !url.pathname.startsWith('/api')) return serveStatic(res, url.pathname);

  const m = match(req.method, url.pathname);
  if (!m) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'not found' })); }

  let raw = '';
  req.on('data', c => raw += c);
  req.on('end', async () => {
    let body = {}; if (raw) { try { body = JSON.parse(raw); } catch (e) {} }
    try {
      const out = await m.handler(m.params, query, body);
      res.writeHead(out == null ? 404 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out == null ? { error: 'not found' } : out));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e && e.message || e) }));
    }
  });
});

/* ---------- startup ---------- */
(async () => {
  await db.init();
  const inserted = await db.seed();
  if (inserted) console.log('Seeded fresh database.');
  server.listen(PORT, () => console.log('IndexPrep API on http://localhost:' + PORT + '  [' + (db.usePg ? 'Postgres' : 'SQLite') + ']'));
})();
