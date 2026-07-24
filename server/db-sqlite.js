'use strict';
/* SQLite backend (local development). Wraps Node's synchronous node:sqlite
   in an async interface so the server code is identical to the Postgres path. */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.INDEXPREP_DB || path.join(__dirname, 'indexprep.db');
const db = new DatabaseSync(DB_PATH);

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
CREATE TABLE IF NOT EXISTS question_index_map (id INTEGER PRIMARY KEY AUTOINCREMENT, bank_question_id TEXT NOT NULL,
  index_question_id TEXT NOT NULL, score REAL, status TEXT DEFAULT 'ai_suggested', rationale TEXT);
CREATE TABLE IF NOT EXISTS question_media (id INTEGER PRIMARY KEY AUTOINCREMENT, question_id TEXT NOT NULL,
  question_type TEXT NOT NULL, kind TEXT NOT NULL, flashcard_front TEXT, flashcard_back TEXT,
  file_name TEXT, file_type TEXT, file_url TEXT, title TEXT, duration TEXT);
CREATE TABLE IF NOT EXISTS students (id TEXT PRIMARY KEY, name TEXT, email TEXT, role TEXT DEFAULT 'student');
CREATE TABLE IF NOT EXISTS attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL, question_id TEXT NOT NULL,
  question_type TEXT NOT NULL, section TEXT NOT NULL, chapter_id TEXT NOT NULL, topics_json TEXT, index_ids_json TEXT,
  is_correct INTEGER NOT NULL, chosen_key TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS chapter_progress (student_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
  index_completed INTEGER DEFAULT 0, completed_at TEXT, PRIMARY KEY(student_id, chapter_id));
CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL, chapter_id TEXT,
  question_id TEXT, concept TEXT, note TEXT, source TEXT, key_points_json TEXT,
  created_at TEXT DEFAULT (datetime('now')), UNIQUE(student_id, question_id));
CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, name TEXT, mime TEXT, file_type TEXT, data TEXT,
  created_at TEXT DEFAULT (datetime('now')));
`;

const DROP_ALL = `
DROP TABLE IF EXISTS uploads; DROP TABLE IF EXISTS notes; DROP TABLE IF EXISTS chapter_progress;
DROP TABLE IF EXISTS attempts; DROP TABLE IF EXISTS students; DROP TABLE IF EXISTS question_media;
DROP TABLE IF EXISTS question_index_map; DROP TABLE IF EXISTS bank_questions; DROP TABLE IF EXISTS index_questions;
DROP TABLE IF EXISTS topics; DROP TABLE IF EXISTS chapters; DROP TABLE IF EXISTS subjects; DROP TABLE IF EXISTS courses;
`;

function ensureCol(table, col, decl) {
  const cols = db.prepare('PRAGMA table_info(' + table + ')').all();
  if (!cols.some(c => c.name === col)) db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + col + ' ' + decl);
}
async function init() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_meta (k TEXT PRIMARY KEY, v TEXT);');
  const row = db.prepare('SELECT v FROM schema_meta WHERE k=?').get('version');
  if (!row || row.v !== SCHEMA_VERSION) {
    db.exec(DROP_ALL);
    db.exec(SCHEMA);
    db.prepare('INSERT INTO schema_meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run('version', SCHEMA_VERSION);
  } else {
    db.exec(SCHEMA);
  }
  // additive, non-destructive migrations (safe to run every boot)
  ensureCol('bank_questions', 'key_points_json', 'TEXT');
}
async function all(sql, ...p) { return db.prepare(sql).all(...p); }
async function get(sql, ...p) { return db.prepare(sql).get(...p); }
async function run(sql, ...p) { return db.prepare(sql).run(...p); }

module.exports = { all, get, run, init };
