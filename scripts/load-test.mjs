#!/usr/bin/env node
// Load test: builds a throwaway database with every migration, fills it with 10,000
// organizations plus one very large one (scripts/load-test/seed.sql), then times what each
// page asks the database for (scripts/load-test/bench.sql). The database is dropped afterwards.
//
//   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres npm run test:load
//
// Options:
//   --compare 20260930090000   load without that migration (and later ones), time the pages,
//                              apply the rest to the loaded data (timed), then time them again
//   --keep                     keep the database afterwards (its name is printed)
//   --reuse <database>         skip loading; time the pages on a database kept earlier
//
// Loading takes about half an hour. Like test:db, it refuses Supabase addresses.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const adminUrl = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@localhost:5432/postgres";
if (/supabase\.(co|com)/i.test(adminUrl)) {
  console.error("Refusing to run the load test against a Supabase address. Use a local Postgres.");
  process.exit(2);
}

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] ?? "");
};
const compare = arg("--compare");
const reuse = arg("--reuse");
const keep = process.argv.includes("--keep") || Boolean(reuse);

const dbName = reuse || `finseka_load_${process.pid}`;
const dbUrl = new URL(adminUrl);
dbUrl.pathname = `/${dbName}`;

function psql(url, args) {
  const r = spawnSync("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || "psql failed").trim());
  return r;
}

const dir = (...p) => path.join(root, ...p);
const seconds = (t) => `${Math.round((Date.now() - t) / 1000)} s`;
const migrations = readdirSync(dir("supabase", "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

function migrate(list) {
  for (const m of list) psql(dbUrl.href, ["-1", "-f", dir("supabase", "migrations", m)]);
}

function bench(title) {
  console.log(`\n== ${title}`);
  const r = psql(dbUrl.href, ["-f", dir("scripts", "load-test", "bench.sql")]);
  for (const line of r.stderr.split(/\r?\n/)) {
    const m = line.match(/NOTICE:\s+(.*)$/);
    if (m) console.log(m[1]);
  }
}

if (!reuse) psql(adminUrl, ["-c", `CREATE DATABASE ${dbName}`]);
let failed = false;
try {
  if (!reuse) {
    const first = compare ? migrations.filter((m) => m < compare) : migrations;
    psql(dbUrl.href, ["-f", dir("supabase", "tests", "supabase_stub.sql")]);
    migrate(first);
    console.log(`${first.length} migrations applied (last: ${first.at(-1)})`);

    const t = Date.now();
    console.log(psql(dbUrl.href, ["-f", dir("scripts", "load-test", "seed.sql")]).stdout.trim());
    console.log(`loaded in ${seconds(t)}`);
  }

  if (compare && !reuse) {
    bench(`before ${compare}`);
    const rest = migrations.filter((m) => m >= compare);
    const t = Date.now();
    migrate(rest);
    psql(dbUrl.href, ["-c", "ANALYZE"]);
    console.log(`\napplied ${rest.join(", ")} to the loaded data in ${seconds(t)}`);
    bench("after");
  } else {
    bench("timings");
  }
} catch (e) {
  failed = true;
  console.error(`\n✗ ${e.message}`);
} finally {
  if (keep) console.log(`\nkept database ${dbName}`);
  else psql(adminUrl, ["-c", `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`]);
}
process.exit(failed ? 1 : 0);
