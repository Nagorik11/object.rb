import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import worker from "../worker.js";

const origin = "https://object-rd.example.test";
const photo = "data:image/jpeg;base64,/9j/2Q==";

class D1Fixture {
  constructor() {
    this.db = new DatabaseSync(":memory:");
    this.db.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE users (id TEXT PRIMARY KEY, handle TEXT UNIQUE, display_name TEXT,
      email TEXT, locale TEXT, timezone TEXT, status TEXT, profile TEXT, meta TEXT,
      created_at TEXT, updated_at TEXT);`);
    this.db.exec(readFileSync(new URL("../migrations/0001_visitor_sessions.sql", import.meta.url), "utf8"));
  }
  prepare(sql) {
    const statement = this.db.prepare(sql);
    return { bind: (...args) => ({
      first: async () => statement.get(...args) || null,
      run: async () => ({ meta: { changes: statement.run(...args).changes } })
    }) };
  }
  async batch(statements) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.db.exec("COMMIT");
      return results;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}

function register(db, data = {}, cookie = "", ip = "192.0.2.1") {
  return worker.fetch(new Request(origin + "/api/visitors", {
    method: "POST", headers: { "Origin": origin, "Content-Type": "application/json", "Cookie": cookie, "CF-Connecting-IP": ip },
    body: JSON.stringify({ name: "Ana", photo, consent: true, ...data })
  }), { SHARED_DB: db });
}

function getMe(db, cookie = "") {
  return worker.fetch(new Request(origin + "/api/me", { headers: { Cookie: cookie } }), { SHARED_DB: db });
}

test("a visitor receives a database UUID, photo, limited role, and opaque cookie", async () => {
  const db = new D1Fixture();
  const response = await register(db, { id: "existing-id", roles: ["admin"] });
  assert.equal(response.status, 201);
  const user = (await response.json()).user;
  assert.match(user.id, /^[0-9a-f-]{36}$/);
  assert.equal(user.accessLevel, "Visitante");
  assert.equal(user.photo, photo);
  const row = db.db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
  assert.equal(row.display_name, "Ana");
  assert.deepEqual(JSON.parse(row.profile).roles, ["visitor"]);
  const cookie = response.headers.get("Set-Cookie");
  for (const flag of ["HttpOnly", "Secure", "SameSite=Lax"]) assert.ok(cookie.includes(flag));
  const token = cookie.split(";")[0].split("=")[1];
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.notEqual(db.db.prepare("SELECT token_hash FROM rd_visitor_sessions").get().token_hash, token);
  assert.deepEqual((await (await getMe(db, cookie.split(";")[0])).json()).user, user);
  db.db.close();
});

test("a name never grants access to an existing account", async () => {
  const db = new D1Fixture();
  const existingId = "11111111-2222-4333-8444-555555555555";
  db.db.prepare("INSERT INTO users (id, display_name, handle, status, profile) VALUES (?, ?, ?, ?, ?)")
    .run(existingId, "Ana", "existing-ana", "active", '{"roles":["admin"]}');
  const user = (await (await register(db, { name: "Ana" })).json()).user;
  assert.notEqual(user.id, existingId);
  assert.equal(user.accessLevel, "Visitante");
  assert.equal((await (await getMe(db, "user_id=" + existingId)).json()).user, null);
  db.db.close();
});

test("anonymous, forged and revoked sessions cannot read a profile", async () => {
  const db = new D1Fixture();
  assert.equal((await (await getMe(db)).json()).user, null);
  assert.equal((await (await getMe(db, "__Host-rd-visitor=" + "a".repeat(64))).json()).user, null);
  const response = await register(db);
  const cookie = response.headers.get("Set-Cookie").split(";")[0];
  const logout = await worker.fetch(new Request(origin + "/api/visitor/logout", {
    method: "POST", headers: { Origin: origin, Cookie: cookie }
  }), { SHARED_DB: db });
  assert.equal(logout.status, 200);
  assert.equal((await (await getMe(db, cookie)).json()).user, null);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 1);
  db.db.close();
});

test("expired sessions and inactive users cannot retrieve a profile", async () => {
  const db = new D1Fixture();
  const response = await register(db);
  const cookie = response.headers.get("Set-Cookie").split(";")[0];
  db.db.exec("UPDATE users SET status = 'inactive'");
  assert.equal((await (await getMe(db,cookie)).json()).user,null);
  db.db.exec("UPDATE users SET status = 'active'; UPDATE rd_visitor_sessions SET expires_at = 1");
  assert.equal((await (await getMe(db,cookie)).json()).user,null);
  db.db.close();
});

test("migration can run again without changing existing users", () => {
  const db = new D1Fixture();
  db.db.prepare("INSERT INTO users (id, display_name) VALUES (?, ?)").run("old-user","Existing");
  db.db.exec(readFileSync(new URL("../migrations/0001_visitor_sessions.sql",import.meta.url),"utf8"));
  assert.equal(db.db.prepare("SELECT display_name FROM users WHERE id = 'old-user'").get().display_name,"Existing");
  db.db.close();
});

test("registration requires a name, consent and a bounded JPEG", async () => {
  const db = new D1Fixture();
  for (const invalid of [{name:"A"}, {name:"<script>"}, {name:"A".repeat(81)}, {consent:false}, {photo:"data:image/svg+xml;base64,PHN2Zz4="}, {photo:"data:image/jpeg;base64,YWJj"}]) {
    assert.equal((await register(db, invalid)).status, 422);
  }
  assert.equal((await register(db, {photo:"x".repeat(121000)})).status, 413);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 0);
  db.db.close();
});

test("cross-origin writes, wrong methods and malformed JSON are rejected", async () => {
  const db = new D1Fixture();
  const request = (headers, body="{}") => new Request(origin+"/api/visitors", {method:"POST",headers,body});
  assert.equal((await worker.fetch(request({Origin:"https://other.test"}), {SHARED_DB:db})).status,403);
  assert.equal((await worker.fetch(request({Origin:origin,"Content-Type":"text/plain"}), {SHARED_DB:db})).status,415);
  assert.equal((await worker.fetch(request({Origin:origin,"Content-Type":"application/json"},"bad"), {SHARED_DB:db})).status,400);
  assert.equal((await worker.fetch(new Request(origin+"/api/visitors"),{SHARED_DB:db})).status,405);
  db.db.close();
});

test("five registrations per IP per hour, including after signing out", async () => {
  const db = new D1Fixture();
  for(let i=0;i<5;i++) {
    const response = await register(db);
    assert.equal(response.status,201);
    await worker.fetch(new Request(origin+"/api/visitor/logout", {
      method:"POST", headers:{Origin:origin,Cookie:response.headers.get("Set-Cookie").split(";")[0]}
    }),{SHARED_DB:db});
  }
  assert.equal((await register(db)).status,429);
  assert.equal((await register(db,{},"","192.0.2.2")).status,201);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM users").get().n,6);
  db.db.close();
});

test("existing visitor cannot accidentally create a second account", async () => {
  const db = new D1Fixture();
  const first = await register(db);
  assert.equal((await register(db,{},first.headers.get("Set-Cookie").split(";")[0])).status,409);
  db.db.close();
});

test("missing binding or migration returns an actionable error, never a fake UUID", async () => {
  assert.equal((await worker.fetch(new Request(origin+"/api/me"),{})).status,503);
  const db = new D1Fixture();
  db.db.exec("DROP TABLE rd_visitor_sessions");
  assert.equal((await register(db)).status,503);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM users").get().n,0);
  db.db.close();
});

test("failure to save a session rolls back the newly inserted user", async () => {
  const db = new D1Fixture();
  db.db.exec("CREATE TRIGGER reject_session BEFORE INSERT ON rd_visitor_sessions BEGIN SELECT RAISE(ABORT, 'session failed'); END;");
  assert.equal((await register(db)).status,503);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM users").get().n,0);
  db.db.close();
});

test("Worker serves the registration UI and valid client scripts", async () => {
  const html = await (await worker.fetch(new Request(origin),{})).text();
  assert.match(html,/UUID de usuario/);
  assert.match(html,/Activar cámara/);
  assert.match(html,/visitor-consent/);
  assert.doesNotMatch(html,/rd-object-browser-id-v1/);
  new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  const script = await worker.fetch(new Request(origin+"/visitor.js"),{});
  assert.equal(script.status,200);
  new vm.Script(await script.text());
});
