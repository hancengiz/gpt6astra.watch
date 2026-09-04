import assert from "node:assert/strict";
import test from "node:test";

import { statusForView, totalsForView, VIEW_MODES } from "./public/view_modes.js";

const summary = {
  totals: {
    lit: 2,
    reported: 1,
    rumored: 1,
    reports: 7,
    waiting: 6,
    monitoring: 5,
  },
  countries: {
    TR: { status: "live", web: 3, watcher: 0, waiting: 2 },
    GE: { status: "live", web: 0, watcher: 2, waiting: 4 },
    DE: { status: "reported", web: 1, watcher: 1, waiting: 0 },
  },
};

test("view modes are explicit and mutually exclusive", () => {
  assert.deepEqual([...VIEW_MODES], ["all", "got", "waiting", "script"]);
});

test("got and script views calculate their own rollout state", () => {
  assert.equal(statusForView(summary.countries.TR, "got"), "live");
  assert.equal(statusForView(summary.countries.GE, "got"), "none");
  assert.equal(statusForView(summary.countries.GE, "script"), "live");
  assert.equal(statusForView(summary.countries.TR, "script"), "none");

  assert.deepEqual(
    { lit: totalsForView(summary, "got").lit, reports: totalsForView(summary, "got").reports },
    { lit: 1, reports: 4 },
  );
  assert.deepEqual(
    {
      lit: totalsForView(summary, "script").lit,
      reports: totalsForView(summary, "script").reports,
      monitoring: totalsForView(summary, "script").monitoring,
    },
    { lit: 1, reports: 3, monitoring: 5 },
  );
});

test("waiting view keeps waiting people but never lights countries", () => {
  assert.equal(statusForView(summary.countries.TR, "waiting"), "none");
  assert.deepEqual(
    {
      lit: totalsForView(summary, "waiting").lit,
      reports: totalsForView(summary, "waiting").reports,
      waiting: totalsForView(summary, "waiting").waiting,
      monitoring: totalsForView(summary, "waiting").monitoring,
    },
    { lit: 0, reports: 0, waiting: 6, monitoring: 0 },
  );
});
