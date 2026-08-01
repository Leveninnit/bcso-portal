/**
 * Powers leaderboards.html — public, no login required (same visibility
 * as the Applications/Activity Log/Documents pages).
 *
 * Fetches GET /api/leaderboard?div=&period= and renders:
 *  - a subdivision switcher (Global + every subdivision, including SRT)
 *  - an All-Time / This Month toggle
 *  - two side-by-side rankings (total hours, activity count)
 *  - the individual activity-log entries for the current view
 *  - a client-side search box filtering by character name or badge #
 *    (no refetch needed — just re-renders from the already-loaded data)
 */

let currentDiv = "all";
let currentPeriod = "all";
let currentData = { leaderboard: { byHours: [], byCount: [] }, log: [] };

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function escapeHtml(str) {
  return (str ?? "").toString().replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function subShort(slug) {
  const sub = (window.SUBDIVISIONS || []).find((s) => s.slug === slug);
  return sub ? sub.short : (slug || "").toUpperCase();
}

function formatHours(h) {
  const n = Number(h) || 0;
  return (Math.round(n * 100) / 100).toString();
}

function formatDate(createdAt) {
  if (!createdAt) return "";
  // D1's datetime('now') gives "YYYY-MM-DD HH:MM:SS" in UTC.
  const iso = createdAt.includes("T") ? createdAt : createdAt.replace(" ", "T") + "Z";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return createdAt;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function matchesSearch(entry, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    (entry.characterName || "").toLowerCase().includes(q) ||
    (entry.badgeNumber || "").toLowerCase().includes(q)
  );
}

function rankBadge(i) {
  if (i === 0) return '<span class="lb-medal lb-medal-1">🥇</span>';
  if (i === 1) return '<span class="lb-medal lb-medal-2">🥈</span>';
  if (i === 2) return '<span class="lb-medal lb-medal-3">🥉</span>';
  return `<span class="lb-rank-num">#${i + 1}</span>`;
}

function renderPeopleList(containerId, people, metricKey, metricSuffix, query) {
  const el = document.getElementById(containerId);
  const filtered = people.filter((p) => matchesSearch(p, query));
  if (!filtered.length) {
    el.innerHTML = `<p class="lb-empty">No activity logged yet for this view.</p>`;
    return;
  }
  el.innerHTML = filtered
    .map((p, i) => {
      const value = metricKey === "hours" ? formatHours(p.hours) : p.count;
      return `
        <div class="lb-row">
          ${rankBadge(i)}
          <span class="lb-name">${escapeHtml(p.characterName)}</span>
          <span class="lb-badge-num">#${escapeHtml(p.badgeNumber)}</span>
          ${currentDiv === "all" ? `<span class="lb-sub-tag">${escapeHtml(subShort(p.subdivisionSlug))}</span>` : ""}
          <span class="lb-value">${value}${metricSuffix}</span>
        </div>`;
    })
    .join("");
}

function renderLogList(query) {
  const el = document.getElementById("lb-log-list");
  const entries = currentData.log.filter((e) => matchesSearch(e, query));
  if (!entries.length) {
    el.innerHTML = `<p class="lb-empty">No activity logs to show for this view.</p>`;
    return;
  }
  el.innerHTML = entries
    .map(
      (e) => `
        <div class="panel lb-log-entry">
          <div class="lb-log-head">
            <strong>${escapeHtml(e.characterName)}</strong>
            <span class="lb-badge-num">#${escapeHtml(e.badgeNumber)}</span>
            ${currentDiv === "all" ? `<span class="lb-sub-tag">${escapeHtml(subShort(e.subdivisionSlug))}</span>` : ""}
            <span class="lb-log-hours">${formatHours(e.hours)}h</span>
            <span class="lb-log-date">${escapeHtml(formatDate(e.createdAt))}</span>
          </div>
          ${e.summary ? `<p class="lb-log-summary">${escapeHtml(e.summary)}</p>` : ""}
        </div>`
    )
    .join("");
}

function renderAll() {
  const query = document.getElementById("lb-search").value.trim();
  renderPeopleList("lb-hours-list", currentData.leaderboard.byHours, "hours", "h", query);
  renderPeopleList("lb-count-list", currentData.leaderboard.byCount, "count", "", query);
  renderLogList(query);
}

async function loadLeaderboard() {
  const statusEl = document.getElementById("lb-status");
  statusEl.textContent = "Loading…";
  try {
    const params = new URLSearchParams();
    if (currentDiv !== "all") params.set("div", currentDiv);
    params.set("period", currentPeriod);
    const res = await fetch(`/api/leaderboard?${params.toString()}`, { cache: "no-store" });
    const data = await res.json().catch(() => null);
    currentData = data && data.leaderboard ? data : { leaderboard: { byHours: [], byCount: [] }, log: [] };
    statusEl.textContent = "";
  } catch {
    currentData = { leaderboard: { byHours: [], byCount: [] }, log: [] };
    statusEl.textContent = "Couldn't load the leaderboard right now. Try refreshing.";
  }
  renderAll();
}

function renderDivTabs() {
  const subs = window.SUBDIVISIONS || [];
  const tabsEl = document.getElementById("lb-div-tabs");
  const tabs = [{ slug: "all", short: "Global" }, ...subs.map((s) => ({ slug: s.slug, short: s.short }))];
  tabsEl.innerHTML = tabs
    .map(
      (t) =>
        `<button type="button" class="lb-tab${t.slug === currentDiv ? " active" : ""}" data-div="${escapeHtml(t.slug)}">${escapeHtml(t.short)}</button>`
    )
    .join("");
  tabsEl.querySelectorAll(".lb-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.div === currentDiv) return;
      currentDiv = btn.dataset.div;
      tabsEl.querySelectorAll(".lb-tab").forEach((b) => b.classList.toggle("active", b === btn));
      updateTitle();
      loadLeaderboard();
    });
  });
}

function updateTitle() {
  const label = currentDiv === "all" ? "Global" : subShort(currentDiv);
  document.getElementById("lb-title").textContent =
    currentDiv === "all" ? "Leaderboards — Global" : `Leaderboards — ${label}`;
}

function wirePeriodToggle() {
  const toggleEl = document.getElementById("lb-period-toggle");
  toggleEl.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.period === currentPeriod) return;
      currentPeriod = btn.dataset.period;
      toggleEl.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
      loadLeaderboard();
    });
  });
}

function wireSearch() {
  document.getElementById("lb-search").addEventListener("input", () => renderAll());
}

document.addEventListener("DOMContentLoaded", () => {
  const wantDiv = (getQueryParam("div") || "all").toLowerCase();
  const validDiv =
    wantDiv === "all" || (window.SUBDIVISIONS || []).some((s) => s.slug === wantDiv);
  currentDiv = validDiv ? wantDiv : "all";

  renderDivTabs();
  updateTitle();
  wirePeriodToggle();
  wireSearch();
  loadLeaderboard();
});
