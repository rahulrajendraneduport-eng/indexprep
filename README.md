# IndexPrep — Backend (Phase 2a)

The real backend for the IndexPrep learning platform: a database + REST API that both
front-ends (student app and SME console) talk to.

Built with **zero dependencies** — just Node's built-in HTTP server and built-in SQLite —
so it runs anywhere with a modern Node, no `npm install` required.

> SQLite is used as a local stand-in for Postgres. The SQL and schema are the same, so
> moving to Postgres later is a near drop-in change (swap the DB driver in `server/db.js`).

## Requirements

- Node.js **v22 or newer** (needs the built-in `node:sqlite` module).

## Run it

```bash
cd server
node server.js
```

You should see:

```
Seeded fresh database.
IndexPrep API on http://localhost:4000
```

Then open **http://localhost:4000** in your browser — the server hosts the front-ends too:

- **http://localhost:4000/student.html** — the student app (wired to the live API)
- **http://localhost:4000/sme.html** — the SME console (wired to the live API)

The first run creates and seeds `server/indexprep.db` (one chapter — Rotational Motion —
fully populated, matching the prototypes). Delete that file to reset to a clean seed.
Change the port with `PORT=5000 node server.js`.

## What's wired (Phase 2b + 2c)

**Both front-ends now read and write the real database — no mock data left.**

The **student app**: choosing a chapter, the Index-Questions gate, every attempt, the
auto-saved notes, weak areas, and all feedback come from the API. Log in is a fixed demo
student (`stu-demo`); real auth is Phase 5. Refresh mid-way and your progress/notes are
still there, because they live in SQLite, not the browser.

The **SME console**: adding index questions, building the question bank, the AI concept
match, and approve / re-map / no-match all write to the same database. Anything an SME
saves is **immediately live for students** — e.g. a new index question created in the
console appears in the student app's chapter on the next load. That shared database is the
whole point of the two-app design.

Real auth/roles and deployment are Phase 5; the live Claude matching is Phase 4.

## What the API does

The backend is **authoritative** — it decides correctness, enforces the Index-Questions
gate, stores every attempt, and builds the feedback the student sees. The front-end never
decides these things.

### Content (read)
| Method & path | Returns |
|---|---|
| `GET /api/subjects` | all subjects |
| `GET /api/chapters?subject=phy` | chapters (with index/bank counts) |
| `GET /api/chapters/:id` | chapter + its topics |
| `GET /api/chapters/:id/index-questions` | index questions (with key points + media) |
| `GET /api/chapters/:id/bank-questions` | bank questions (with their mappings) |
| `GET /api/chapters/:id/review-queue` | bank questions still pending SME review |
| `GET /api/index-questions/:id` | one index question |

### Student
| Method & path | Purpose |
|---|---|
| `POST /api/attempts` | log an answer → server returns correct/wrong, solution, and feedback (mapped index questions for bank questions; key points + note for index questions) |
| `GET /api/progress/:studentId/:chapterId` | is the chapter unlocked? |
| `POST /api/progress/complete-index` | mark index section done (refused unless all index questions attempted) |
| `GET /api/notes/:studentId` | saved notes (auto-saved when an index question is missed) |
| `GET /api/weak-areas/:studentId/:chapterId` | weak concepts computed from attempt history |

### SME / admin
| Method & path | Purpose |
|---|---|
| `POST /api/index-questions` | create an index question (+ key points, note, flashcard, video) |
| `POST /api/bank-questions` | create a bank question → runs AI concept-match, returns suggestions |
| `POST /api/bank-questions/:id/approve` | approve the suggested mapping |
| `POST /api/bank-questions/:id/remap` | manually map to chosen index question(s) |
| `POST /api/bank-questions/:id/no-match` | flag "no match — a new index question is needed" |

## Files

- `server/db.js` — schema, seed data, and query helpers.
- `server/server.js` — the HTTP API and all routes.

## Next (Phase 2b / 2c)

Wire the student app and SME console to this API (replace their in-memory mock data with
`fetch()` calls to these endpoints).
