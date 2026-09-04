export const VIEW_MODES = new Set(["all", "got", "waiting", "script"]);

export function statusForView(data = {}, mode = "all") {
  if (mode === "all") return data.status || "none";
  if (mode === "waiting") return "none";

  const count = mode === "script" ? (data.watcher ?? 0) : (data.web ?? 0);
  const liveThreshold = mode === "script" ? 2 : 3;
  if (count >= liveThreshold) return "live";
  if (count === 2) return "reported";
  if (count === 1) return "rumored";
  return "none";
}

export function totalsForView(summary, mode = "all") {
  if (mode === "all") return summary.totals;
  if (mode === "waiting") {
    return {
      ...summary.totals,
      lit: 0,
      reported: 0,
      rumored: 0,
      reports: 0,
      monitoring: 0,
    };
  }

  const key = mode === "script" ? "watcher" : "web";
  const liveThreshold = mode === "script" ? 2 : 3;
  let lit = 0;
  let reports = 0;
  for (const country of Object.values(summary.countries)) {
    reports += country[key] ?? 0;
    if ((country[key] ?? 0) >= liveThreshold) lit++;
  }
  return {
    ...summary.totals,
    lit,
    reports,
    waiting: 0,
    monitoring: mode === "script" ? summary.totals.monitoring : 0,
  };
}
