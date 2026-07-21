'use strict';
/* Database selector: uses Postgres when DATABASE_URL is set (production on
   Render), otherwise the built-in SQLite (local development). Both expose the
   same async interface: all(), get(), run(), init(), seed(). */
const { seedData } = require('./seed');

const usePg = !!process.env.DATABASE_URL;
const impl = usePg ? require('./db-pg') : require('./db-sqlite');   // conditional require: node:sqlite is never loaded in production

async function seed() { return seedData(impl); }

module.exports = { all: impl.all, get: impl.get, run: impl.run, init: impl.init, seed, usePg };
