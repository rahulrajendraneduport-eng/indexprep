'use strict';
/* PostgreSQL backend (production on Render/Supabase). Same async interface as db-sqlite.
   Converts "?" placeholders to Postgres "$1, $2, …" so the server code is shared. */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const SCHEMA_VERSION = '2';   // bump to force a rebuild of the schema (course-first model)

const SCHEMA = `
CREATE TABLE IF NOT EXISTS courses (id TEXT PRIMARY KEY, name TEXT NOT NULL, ord INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS subjects (id TEXT PRIMARY KEY, course_id TEXT NOT NULL, name TEXT NOT NULL, prefix TEXT NOT NULL, ord INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS chapters (id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, name TEXT NOT NULL, ord INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS topics (id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS index_questions (id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL, topic_id TEXT NOT NULL,
  stem TEXT NOT NULL, options_json TEXT NOT NULL, correct_key TEXT NOT NULL, concept TEXT, solution TEXT,
  key_points_json TEXT, note TEXT, note_source TEXT, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS bank_questions (id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL, topics_json TEXT NOT NULL,
  stem TEXT NOT NULL, options_json TEXT, correct_key TEXT, solution TEXT, difficulty TEXT DEFAULT 'Medium',
  review_status TEXT DEFAULT 'pending', no_match INTEGER DEFAULT 0, solution_only INTEGER DEFAULT 0, key_points_json TEXT);
CREATE TABLE IF NOT EXISTS question_index_map (id SERIAL PRIMARY KEY, bank_question_id TEXT NOT NULL,
  index_question_id TEXT NOT NULL, score REAL, status TEXT DEFAULT 'ai_suggested', rationale TEXT);
CREATE TABLE IF NOT EXISTS question_media (id SERIAL PRIMARY KEY, question_id TEXT NOT NULL,
  question_type TEXT NOT NULL, kind TEXT NOT NULL, flashcard_front TEXT, flashcard_back TEXT,
  file_name TEXT, file_type TEXT, file_url TEXT, title TEXT, duration TEXT);
CREATE TABLE IF NOT EXISTS students (id TEXT PRIMARY KEY, name TEXT, email TEXT, role TEXT DEFAULT 'student');
CREATE TABLE IF NOT EXISTS attempts (id SERIAL PRIMARY KEY, student_id TEXT NOT NULL, question_id TEXT NOT NULL,
  question_type TEXT NOT NULL, section TEXT NOT NULL, chapter_id TEXT NOT NULL, topics_json TEXT, index_ids_json TEXT,
  is_correct INTEGER NOT NULL, chosen_key TEXT, created_at TIMESTAMP DEFAULT now());
CREATE TABLE IF NOT EXISTS chapter_progress (student_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
  index_completed INTEGER DEFAULT 0, completed_at TIMESTAMP, PRIMARY KEY(student_id, chapter_id));
CREATE TABLE IF NOT EXISTS notes (id SERIAL PRIMARY KEY, student_id TEXT NOT NULL, chapter_id TEXT,
  question_id TEXT, concept TEXT, note TEXT, source TEXT, key_points_json TEXT,
  created_at TIMESTAMP DEFAULT now(), UNIQUE(student_id, question_id));
CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, name TEXT, mime TEXT, file_type TEXT, data TEXT,
  created_at TIMESTAMP DEFAULT now());
`;

const DROP_ALL = `
DROP TABLE IF EXISTS uploads; DROP TABLE IF EXISTS notes; DROP TABLE IF EXISTS chapter_progress;
DROP TABLE IF EXISTS attempts; DROP TABLE IF EXISTS students; DROP TABLE IF EXISTS question_media;
DROP TABLE IF EXISTS question_index_map; DROP TABLE IF EXISTS bank_questions; DROP TABLE IF EXISTS index_questions;
DROP TABLE IF EXISTS topics; DROP TABLE IF EXISTS chapters; DROP TABLE IF EXISTS subjects; DROP TABLE IF EXISTS courses;
`;

function conv(sql) { let i = 0; return sql.replace(/\?/g, () => '$' + (++i)); }
async function init() {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_meta (k TEXT PRIMARY KEY, v TEXT)');
  const r = await pool.query('SELECT v FROM schema_meta WHERE k=$1', ['version']);
  const cur = r.rows[0] ? r.rows[0].v : null;
  if (cur !== SCHEMA_VERSION) {
    await pool.query(DROP_ALL);
    await pool.query(SCHEMA);
    await pool.query("INSERT INTO schema_meta(k,v) VALUES('version',$1) ON CONFLICT(k) DO UPDATE SET v=excluded.v", [SCHEMA_VERSION]);
  } else {
    await pool.query(SCHEMA);
  }
  // additive, non-destructive migrations (safe to run every boot)
  await pool.query('ALTER TABLE bank_questions ADD COLUMN IF NOT EXISTS key_points_json TEXT');
}
async function all(sql, ...p) { const r = await pool.query(conv(sql), p); return r.rows; }
async function get(sql, ...p) { const r = await pool.query(conv(sql), p); return r.rows[0]; }
async function run(sql, ...p) { return pool.query(conv(sql), p); }

module.exports = { all, get, run, init };
