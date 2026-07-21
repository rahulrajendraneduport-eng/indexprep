'use strict';
/* PostgreSQL backend (production on Render). Same async interface as db-sqlite.
   Converts "?" placeholders to Postgres "$1, $2, …" so the server code is shared. */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS subjects (id TEXT PRIMARY KEY, name TEXT NOT NULL, prefix TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapters (id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, name TEXT NOT NULL, ord INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS topics (id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS index_questions (id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL, topic_id TEXT NOT NULL,
  stem TEXT NOT NULL, options_json TEXT NOT NULL, correct_key TEXT NOT NULL, concept TEXT, solution TEXT,
  key_points_json TEXT, note TEXT, note_source TEXT, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS bank_questions (id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL, topics_json TEXT NOT NULL,
  stem TEXT NOT NULL, options_json TEXT, correct_key TEXT, solution TEXT, difficulty TEXT DEFAULT 'Medium',
  review_status TEXT DEFAULT 'pending', no_match INTEGER DEFAULT 0, solution_only INTEGER DEFAULT 0);
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

function conv(sql) { let i = 0; return sql.replace(/\?/g, () => '$' + (++i)); }
async function init() { await pool.query(SCHEMA); }
async function all(sql, ...p) { const r = await pool.query(conv(sql), p); return r.rows; }
async function get(sql, ...p) { const r = await pool.query(conv(sql), p); return r.rows[0]; }
async function run(sql, ...p) { return pool.query(conv(sql), p); }

module.exports = { all, get, run, init };
