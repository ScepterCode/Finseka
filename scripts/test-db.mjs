#!/usr/bin/env node
// Runs every migration and then every supabase/tests/*.test.sql file against a fresh,
// throwaway Postgres database, and drops it afterwards.
//
//   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres npm run test:db
//   ... npm run test:db -- 19     # only test files whose name contains "19"
//
// TEST_DATABASE_URL must point at a plain Postgres server you can create databases on.
// It refuses Supabase addresses, so it can never touch a real project.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const adminUrl = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@localhost:5432/postgres";

if (/supabase\.(co|com)/i.test(adminUrl)) {
  console.error(
    "Refusing to run database tests against a Supabase address. Use a local or CI Postgres.",
  );
  process.exit(2);
}

const dbName = `finseka_test_${process.pid}`;
const dbUrl = new URL(adminUrl);
dbUrl.pathname = `/${dbName}`;

function psql(url, args, input) {
  return spawnSync("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], {
    input,
    encoding: "utf8",
    // Our SQL files are UTF-8; without this, psql on Windows reads them in the console code page.
    env: { ...process.env, PGCLIENTENCODING: "UTF8" },
  });
}

function must(result, what) {
  if (result.status !== 0) {
    console.error(`\n✗ ${what}\n${(result.stderr || result.stdout || "").trim()}`);
    return false;
  }
  return true;
}

const posix = (p) => p.split(path.sep).join("/");
const migrationsDir = path.join(root, "supabase", "migrations");
const testsDir = path.join(root, "supabase", "tests");
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const tests = readdirSync(testsDir)
  .filter((f) => f.endsWith(".test.sql"))
  // Optional: only test files whose name contains this text, e.g. `npm run test:db -- 19`.
  .filter((f) => !process.argv[2] || f.includes(process.argv[2]))
  .sort();

if (!must(psql(adminUrl, ["-c", `CREATE DATABASE ${dbName}`]), "create test database"))
  process.exit(1);

let failed = false;
try {
  if (
    !must(psql(dbUrl.href, ["-f", path.join(testsDir, "supabase_stub.sql")]), "Supabase stand-in")
  ) {
    failed = true;
  }
  for (const m of failed ? [] : migrations) {
    if (!must(psql(dbUrl.href, ["-1", "-f", path.join(migrationsDir, m)]), `migration ${m}`)) {
      failed = true;
      break;
    }
  }
  if (!failed) console.log(`✓ ${migrations.length} migrations applied`);

  for (const t of failed ? [] : tests) {
    // Each test file runs in its own transaction and is rolled back, so files cannot
    // affect one another.
    const script = `BEGIN;\n\\i '${posix(path.join(testsDir, t))}'\nROLLBACK;\n`;
    const r = psql(dbUrl.href, [], script);
    const checks = (r.stderr.match(/NOTICE:\s+ok /g) ?? []).length;
    if (r.status !== 0) {
      failed = true;
      const failure = r.stderr.split("\n").find((l) => l.includes("FAIL") || l.includes("ERROR"));
      console.error(
        `✗ ${t} (after ${checks} passing checks)\n  ${failure?.trim() ?? r.stderr.trim()}`,
      );
    } else {
      console.log(`✓ ${t} — ${checks} checks`);
    }
  }
} finally {
  psql(adminUrl, ["-c", `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`]);
}

process.exit(failed ? 1 : 0);
