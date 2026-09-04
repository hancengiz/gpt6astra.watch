import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import worker from "./public/_worker.js";

class D1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new D1Statement(this.database, this.sql, values);
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return {
      results: [],
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }

  async executeForBatch() {
    return /^\s*(SELECT|WITH|PRAGMA)\b/i.test(this.sql)
      ? this.all()
      : this.run();
  }
}

class TestD1 {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.database.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  }

  prepare(sql) {
    return new D1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.executeForBatch());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

const envFor = (db) => ({ DB: db, IP_HASH_SECRET: "unit-test-secret" });

async function api(db, method, path, {
  ip = "203.0.113.10", cookie, body, country, locationHeaders = {},
} = {}) {
  const headers = { "cf-connecting-ip": ip, ...locationHeaders };
  if (cookie) headers.cookie = cookie;
  if (country) headers["cf-ipcountry"] = country;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await worker.fetch(new Request(`https://example.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), envFor(db));
  return { response, data: await response.json() };
}

function cookieFrom(response) {
  return response.headers.get("set-cookie")?.split(";", 1)[0] || null;
}

test("country catalog covers every ISO country plus Kosovo", async () => {
  const db = new TestD1();
  const catalog = await api(db, "GET", "/api/countries");
  assert.equal(catalog.response.status, 200);

  const codes = catalog.data.countries.map(({ code }) => code).sort();
  assert.equal(codes.length, 250);
  assert.equal(new Set(codes).size, 250);
  assert.equal(
    createHash("sha256").update(codes.join(" ")).digest("hex"),
    // Exact sorted set of ISO 3166-1 alpha-2 codes plus XK.
    "cb94090b5b8042af48119d4e74a12024bff15561c077e3e718fb520e6f1f511b",
  );
  for (const code of ["GE", "PE", "PY", "AI", "AX", "RE", "XK"]) {
    assert.ok(codes.includes(code), `${code} must be selectable`);
  }
  assert.ok(catalog.data.countries.every(({ code, name }) => /^[A-Z]{2}$/.test(code) && name));
});

test("location detection accepts Georgia and blocks unknown edge codes", async () => {
  const db = new TestD1();
  const georgia = await api(db, "GET", "/api/location", { country: "GE" });
  assert.deepEqual(georgia.data, {
    country: "GE",
    name: "Georgia",
    detected: true,
  });

  for (const country of ["XX", "T1"]) {
    const unknown = await api(db, "GET", "/api/location", { country });
    assert.deepEqual(unknown.data, {
      country: null,
      name: null,
      detected: false,
    });
  }
});

test("Crimea and Sevastopol location hints are normalized to Ukraine", async () => {
  const db = new TestD1();
  const locations = [
    { "cf-ipcountry": "RU", "cf-region": "Autonomous Republic of Crimea" },
    { "cf-ipcountry": "RU", "cf-city": "Sevastopol" },
    {
      "cf-ipcountry": "RU", "cf-latitude": "44.95", "cf-longitude": "34.10",
    },
    { "cf-ipcountry": "RU", "cf-region-code": "RU-CR" },
  ];
  for (const locationHeaders of locations) {
    const result = await api(db, "GET", "/api/location", { locationHeaders });
    assert.deepEqual(result.data, {
      country: "UA",
      name: "Ukraine",
      detected: true,
      normalized: "crimea-ukraine",
    });
  }

  const moscow = await api(db, "GET", "/api/location", {
    locationHeaders: {
      "cf-ipcountry": "RU", "cf-city": "Moscow",
      "cf-latitude": "55.7558", "cf-longitude": "37.6173",
    },
  });
  assert.deepEqual(moscow.data, {
    country: "RU",
    name: "Russia",
    detected: true,
  });
});

test("waiting vote converts exactly once and can return to waiting", async () => {
  const db = new TestD1();

  const first = await api(db, "PUT", "/api/vote", {
    body: { country: "TR", vote: "waiting", nickname: "" },
  });
  assert.equal(first.response.status, 200);
  assert.equal(first.data.vote, "waiting");
  assert.equal(first.data.waiting, 1);
  assert.equal(first.data.reports, 0);
  const cookie = cookieFrom(first.response);
  assert.ok(cookie);

  const restored = await api(db, "GET", "/api/vote?country=TR", {
    cookie,
    ip: "198.51.100.44",
  });
  assert.deepEqual(
    { vote: restored.data.vote, can_manage: restored.data.can_manage },
    { vote: "waiting", can_manage: true },
  );

  const converted = await api(db, "PUT", "/api/vote", {
    cookie,
    ip: "198.51.100.44",
    body: { country: "TR", vote: "available", nickname: "" },
  });
  assert.equal(converted.data.converted, true);
  assert.equal(converted.data.vote, "available");
  assert.equal(converted.data.waiting, 0);
  assert.equal(converted.data.web, 1);
  assert.equal(converted.data.reports, 1);

  const duplicate = await api(db, "PUT", "/api/vote", {
    cookie,
    body: { country: "TR", vote: "available", nickname: "" },
  });
  assert.equal(duplicate.data.deduped, true);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS n FROM reports").get().n, 1);

  const feed = await api(db, "GET", "/api/feed");
  assert.equal(feed.data.events.length, 1);
  assert.equal(feed.data.events[0].country, "TR");

  const blocked = await api(db, "PUT", "/api/vote", {
    ip: "203.0.113.10",
    body: { country: "TR", vote: "waiting", nickname: "" },
  });
  assert.equal(blocked.data.network_claimed, true);
  assert.equal(blocked.data.can_manage, false);

  const corrected = await api(db, "PUT", "/api/vote", {
    cookie,
    body: { country: "TR", vote: "waiting", nickname: "" },
  });
  assert.equal(corrected.data.converted_back, true);
  assert.equal(corrected.data.vote, "waiting");
  assert.equal(corrected.data.waiting, 1);
  assert.equal(corrected.data.reports, 0);

  const removed = await api(db, "DELETE", "/api/vote", {
    cookie,
    body: { country: "TR" },
  });
  assert.equal(removed.data.removed, true);
  assert.equal(removed.data.vote, null);
  assert.match(removed.response.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS n FROM waiting_votes").get().n, 0);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS n FROM report_claims").get().n, 0);
});

test("legacy report routes remain operational", async () => {
  const db = new TestD1();
  const created = await api(db, "POST", "/api/report", {
    body: { country: "DE", nickname: "" },
  });
  assert.equal(created.response.status, 200);
  assert.equal(created.data.vote, "available");
  assert.equal(created.data.web, 1);
  const cookie = cookieFrom(created.response);

  const removed = await api(db, "DELETE", "/api/report", {
    cookie,
    body: { country: "DE" },
  });
  assert.equal(removed.response.status, 200);
  assert.equal(removed.data.removed, true);
  assert.equal(removed.data.reverted_to_waiting, false);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS n FROM reports").get().n, 0);
});

test("legacy undo restores a converted waiting vote", async () => {
  const db = new TestD1();
  const waiting = await api(db, "PUT", "/api/vote", {
    body: { country: "FR", vote: "waiting", nickname: "" },
  });
  const cookie = cookieFrom(waiting.response);
  await api(db, "PUT", "/api/vote", {
    cookie,
    body: { country: "FR", vote: "available", nickname: "" },
  });

  const undone = await api(db, "DELETE", "/api/report", {
    cookie,
    body: { country: "FR" },
  });
  assert.equal(undone.response.status, 200);
  assert.equal(undone.data.reverted_to_waiting, true);
  assert.equal(undone.data.vote, "waiting");
  assert.equal(undone.response.headers.get("set-cookie"), null);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS n FROM reports").get().n, 0);
  assert.equal(
    db.database.prepare(
      "SELECT COUNT(*) AS n FROM waiting_votes WHERE converted_at IS NULL"
    ).get().n,
    1,
  );
});

test("waiting votes never affect positive rollout thresholds", async () => {
  const db = new TestD1();
  for (let index = 1; index <= 3; index++) {
    const result = await api(db, "PUT", "/api/vote", {
      ip: `203.0.113.${index}`,
      body: { country: "GB", vote: "waiting", nickname: "" },
    });
    assert.equal(result.response.status, 200);
  }
  const summary = await api(db, "GET", "/api/summary");
  assert.equal(summary.data.countries.GB.waiting, 3);
  assert.equal(summary.data.countries.GB.status, "none");
  assert.equal(summary.data.totals.lit, 0);
  assert.equal(summary.data.totals.reports, 0);
});

test("successful account checks count as waiting until access arrives", async () => {
  const db = new TestD1();
  const watcher = {
    country: "UA",
    watcher_id: "verified-watcher-1234567890",
    mode: "account",
    nickname: "",
  };

  const heartbeat = await api(db, "POST", "/api/watchers", {
    body: { ...watcher, event: "heartbeat" },
  });
  assert.equal(heartbeat.response.status, 200);
  assert.equal(heartbeat.data.waiting_confirmed, false);
  assert.equal(heartbeat.data.waiting_in_country, 0);

  const waiting = await api(db, "POST", "/api/watchers", {
    body: { ...watcher, event: "waiting" },
  });
  assert.equal(waiting.response.status, 200);
  assert.equal(waiting.data.waiting_confirmed, true);
  assert.equal(waiting.data.waiting_in_country, 1);
  assert.equal(waiting.data.watcher_waiting_in_country, 1);

  let summary = await api(db, "GET", "/api/summary");
  assert.equal(summary.data.countries.UA.status, "none");
  assert.equal(summary.data.countries.UA.waiting, 1);
  assert.equal(summary.data.countries.UA.waiting_watcher, 1);
  assert.equal(summary.data.totals.reports, 0);

  const access = await api(db, "POST", "/api/watchers", {
    body: { ...watcher, event: "access" },
  });
  assert.equal(access.response.status, 200);
  assert.equal(access.data.monitoring, false);
  assert.equal(access.data.waiting_confirmed, false);

  summary = await api(db, "GET", "/api/summary");
  assert.equal(summary.data.countries.UA.waiting, 0);
  assert.equal(summary.data.countries.UA.waiting_watcher, 0);
  assert.equal(summary.data.countries.UA.watcher, 1);
  assert.equal(summary.data.countries.UA.reports, 1);
});

test("manual and watcher waiting responses from one network are deduplicated", async () => {
  const db = new TestD1();
  const ip = "198.51.100.77";
  await api(db, "PUT", "/api/vote", {
    ip,
    body: { country: "GE", vote: "waiting", nickname: "" },
  });
  await api(db, "POST", "/api/watchers", {
    ip,
    body: {
      country: "GE",
      watcher_id: "same-network-watcher-123456",
      event: "waiting",
      mode: "account",
      nickname: "",
    },
  });

  const summary = await api(db, "GET", "/api/summary");
  assert.equal(summary.data.countries.GE.waiting, 1);
  assert.equal(summary.data.countries.GE.waiting_web, 1);
  assert.equal(summary.data.countries.GE.waiting_watcher, 1);
  assert.equal(summary.data.totals.waiting, 1);
});

test("region watchers cannot claim account-level waiting", async () => {
  const db = new TestD1();
  const result = await api(db, "POST", "/api/watchers", {
    body: {
      country: "TR",
      watcher_id: "region-watcher-123456789012",
      event: "waiting",
      mode: "region",
      nickname: "",
    },
  });
  assert.equal(result.response.status, 400);
  assert.match(result.data.error, /account mode/);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS n FROM watchers").get().n, 0);
});
