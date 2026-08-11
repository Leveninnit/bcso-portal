/**
 * Powers leaderboards.html — public, no login required (same visibility
 * as the Applications/Activity Log/Documents pages).
 *
 * Fetches GET /api/leaderboard?div=&period= and renders:
 *  - a subdivision switcher (Global + every subdivision, including SRT)
 *  - an All-Time / This Month toggle
 *  - two side-by-side individual rankings (total hours, activity count),
 *    each shown as a top-3 podium with the rest as a ranked list below
 *  - a "Top Subdivisions" board (Global view only) ranking subdivisions
 *    themselves rather than individual deputies
 *  - the individual activity-log entries for the current view
 *  - a client-side search box filtering by character name or badge #
 *    (no refetch needed — just re-renders from the already-loaded data)
 */

let currentDiv = "all";
let currentPeriod = "all";
let currentData = {
  leaderboard: { byHours: [], byCount: [] },
  subdivisions: { byHours: [], byCount: [] },
  log: [],
};
// Bumped on every loadLeaderboard() call; a response only gets applied if
// it's still the most recent request by the time it comes back. Without
// this, rapidly clicking through tabs/periods could let an earlier,
// slower response land *after* a later, faster one and overwrite it with
// stale data -- the board would end up showing the wrong tab's numbers.
let requestSeq = 0;

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

function subFullName(slug) {
  const sub = (window.SUBDIVISIONS || []).find((s) => s.slug === slug);
  return sub ? sub.name || sub.short : (slug || "Unknown").toUpperCase();
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

const MEDALS = ["🥇", "🥈", "🥉"];

function rankBadge(i) {
  if (i === 0) return '<span class="lb-medal lb-medal-1">🥇</span>';
  if (i === 1) return '<span class="lb-medal lb-medal-2">🥈</span>';
  if (i === 2) return '<span class="lb-medal lb-medal-3">🥉</span>';
  return `<span class="lb-rank-num">#${i + 1}</span>`;
}

// Podium visual order is 2nd - 1st - 3rd (classic podium layout), with the
// 1st-place block taller. `entries` is already sorted best-first; this
// renders whichever of the top 3 actually exist (1 or 2 entries still work).
function renderPodium(entries, metricKey, metricSuffix, showSubTag, nameField, badgeField, subField) {
  const order = [1, 0, 2].filter((i) => i < entries.length);
  return `<div class="lb-podium lb-podium-count-${entries.length}">
    ${order
      .map((i) => {
        const p = entries[i];
        const value = metricKey === "hours" ? formatHours(p.hours) : p.count;
        const name = nameField ? escapeHtml(p[nameField]) : "";
        const badge = badgeField && p[badgeField] ? `<span class="lb-podium-badge">#${escapeHtml(p[badgeField])}</span>` : "";
        const subTag =
          showSubTag && p.subdivisionSlug
            ? `<span class="lb-sub-tag">${escapeHtml(subShort(p.subdivisionSlug))}</span>`
            : "";
        const label = nameField ? name : subShort(p[subField]);
        return `
        <div class="lb-podium-item lb-podium-place-${i + 1}">
          <div class="lb-podium-medal">${MEDALS[i]}</div>
          <div class="lb-podium-stand">
            <div class="lb-podium-rank">#${i + 1}</div>
            <div class="lb-podium-name">${escapeHtml(label)}</div>
            ${badge}
            ${subTag}
            <div class="lb-podium-value">${value}${metricSuffix}</div>
          </div>
        </div>`;
      })
      .join("")}
  </div>`;
}

function renderPeopleList(containerId, people, metricKey, metricSuffix, query) {
  const el = document.getElementById(containerId);
  const filtered = people.filter((p) => matchesSearch(p, query));
  if (!filtered.length) {
    el.innerHTML = `<p class="lb-empty">No activity logged yet for this view.</p>`;
    return;
  }

  // Individual (person) entries never show a subdivision tag, even in the
  // Global view — that tag only makes sense on the "Top Subdivisions"
  // board, where subdivisions themselves (not people) are being ranked.
  const podium = renderPodium(filtered.slice(0, 3), metricKey, metricSuffix, false, "characterName", "badgeNumber", null);
  const rest = filtered.slice(3);
  const restHtml = rest.length
    ? `<div class="lb-list">
        ${rest
          .map((p, i) => {
            const value = metricKey === "hours" ? formatHours(p.hours) : p.count;
            return `
            <div class="lb-row">
              ${rankBadge(i + 3)}
              <span class="lb-name">${escapeHtml(p.characterName)}</span>
              <span class="lb-badge-num">#${escapeHtml(p.badgeNumber)}</span>
              <span class="lb-value">${value}${metricSuffix}</span>
            </div>`;
          })
          .join("")}
      </div>`
    : "";

  el.innerHTML = podium + restHtml;
}

function renderSubdivisionList(containerId, subs, metricKey, metricSuffix) {
  const el = document.getElementById(containerId);
  if (!subs.length) {
    el.innerHTML = `<p class="lb-empty">No activity logged yet.</p>`;
    return;
  }

  const podium = renderPodium(subs.slice(0, 3), metricKey, metricSuffix, false, null, null, "subdivisionSlug");
  const rest = subs.slice(3);
  const restHtml = rest.length
    ? `<div class="lb-list">
        ${rest
          .map((s, i) => {
            const value = metricKey === "hours" ? formatHours(s.hours) : s.count;
            return `
            <div class="lb-row">
              ${rankBadge(i + 3)}
              <span class="lb-name">${escapeHtml(subShort(s.subdivisionSlug))}</span>
              <span class="lb-value">${value}${metricSuffix}</span>
            </div>`;
          })
          .join("")}
      </div>`
    : "";

  el.innerHTML = podium + restHtml;
}

function renderLogList(query) {
  const el = document.getElementById("lb-log-list");
  const entries = currentData.log.filter((e) => matchesSearch(e, query));
  if (!entries.length) {
    el.innerHTML = `<p class="lb-empty">No activity logs to show for this view.</p>`;
    return;
  }
  // Same rule as the person leaderboards above: individual entries don't
  // get a subdivision tag, even in the Global view.
  el.innerHTML = entries
    .map(
      (e) => `
        <div class="panel lb-log-entry">
          <div class="lb-log-head">
            <strong>${escapeHtml(e.characterName)}</strong>
            <span class="lb-badge-num">#${escapeHtml(e.badgeNumber)}</span>
            <span class="lb-log-hours">${formatHours(e.hours)}h</span>
            <span class="lb-log-date">${escapeHtml(formatDate(e.createdAt))}</span>
          </div>
        </div>`
    )
    .join("");
}

function renderSubdivisionsSection() {
  const section = document.getElementById("lb-subdivisions-section");
  if (currentDiv !== "all") {
    section.style.display = "none";
    return;
  }
  section.style.display = "";
  renderSubdivisionList("lb-sub-hours-list", currentData.subdivisions.byHours, "hours", "h");
  renderSubdivisionList("lb-sub-count-list", currentData.subdivisions.byCount, "count", "");
}

function renderAll() {
  const query = document.getElementById("lb-search").value.trim();
  renderPeopleList("lb-hours-list", currentData.leaderboard.byHours, "hours", "h", query);
  renderPeopleList("lb-count-list", currentData.leaderboard.byCount, "count", "", query);
  renderSubdivisionsSection();
  renderLogList(query);
}

// D1 stores created_at in UTC (datetime('now')). Without this, "This
// Month" was always a UTC calendar month, so anyone west of UTC could
// see a log from their own last few hours of the month missing (already
// counted as "next month" by the server's clock), or vice versa for
// anyone east of UTC. Converts the viewer's own local calendar month
// into its UTC-equivalent boundaries, in the same "YYYY-MM-DD HH:MM:SS"
// shape D1's created_at column uses, so the server can filter by it
// directly (see functions/api/leaderboard.js's DATETIME_RE).
function localMonthBoundsUtc() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0);
  const fmt = (d) => d.toISOString().slice(0, 19).replace("T", " ");
  return { start: fmt(start), end: fmt(end) };
}

async function loadLeaderboard() {
  const statusEl = document.getElementById("lb-status");
  statusEl.textContent = "Loading…";
  const mySeq = ++requestSeq;
  try {
    const params = new URLSearchParams();
    if (currentDiv !== "all") params.set("div", currentDiv);
    params.set("period", currentPeriod);
    if (currentPeriod === "month") {
      const { start, end } = localMonthBoundsUtc();
      params.set("monthStart", start);
      params.set("monthEnd", end);
    }
    const res = await fetch(`/api/leaderboard?${params.toString()}`, { cache: "no-store" });
    // A failed request used to fall through to the exact same fallback as
    // a genuinely empty leaderboard (no data yet), silently clearing the
    // status message as if it had succeeded. Now it's treated as a real
    // error instead.
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    const data = await res.json().catch(() => null);
    if (!data || !data.leaderboard) throw new Error("Invalid response body");
    if (mySeq !== requestSeq) return; // a newer request has since started; drop this stale response
    currentData = {
      leaderboard: data.leaderboard,
      subdivisions: data.subdivisions || { byHours: [], byCount: [] },
      log: data.log || [],
    };
    statusEl.textContent = "";
  } catch {
    if (mySeq !== requestSeq) return;
    currentData = { leaderboard: { byHours: [], byCount: [] }, subdivisions: { byHours: [], byCount: [] }, log: [] };
    statusEl.textContent = "Couldn't load the leaderboard right now. Try refreshing.";
  }
  if (mySeq !== requestSeq) return;
  renderAll();
}

// Reflects the current div/period in the URL (?div=&period=) via
// pushState, so the back/forward buttons step through tab/period changes
// and a link to a specific view (e.g. shared in Discord) opens on that
// same view instead of always resetting to Global/All-Time.
function syncUrlState() {
  const params = new URLSearchParams(window.location.search);
  if (currentDiv === "all") params.delete("div");
  else params.set("div", currentDiv);
  if (currentPeriod === "all") params.delete("period");
  else params.set("period", currentPeriod);
  const query = params.toString();
  const newUrl = window.location.pathname + (query ? `?${query}` : "");
  if (newUrl !== window.location.pathname + window.location.search) {
    window.history.pushState({ div: currentDiv, period: currentPeriod }, "", newUrl);
  }
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
      syncUrlState();
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
      syncUrlState();
      loadLeaderboard();
    });
  });
}

function wireSearch() {
  document.getElementById("lb-search").addEventListener("input", () => renderAll());
}

// Sets the div/period tabs to whatever the URL says (defaulting to
// Global/All-Time) and re-renders/re-fetches to match -- shared between
// the initial page load and the browser's back/forward navigation.
function applyStateFromUrl() {
  const wantDiv = (getQueryParam("div") || "all").toLowerCase();
  const validDiv = wantDiv === "all" || (window.SUBDIVISIONS || []).some((s) => s.slug === wantDiv);
  currentDiv = validDiv ? wantDiv : "all";
  const wantPeriod = (getQueryParam("period") || "all").toLowerCase();
  currentPeriod = wantPeriod === "month" ? "month" : "all";

  document.querySelectorAll("#lb-div-tabs .lb-tab").forEach((b) => b.classList.toggle("active", b.dataset.div === currentDiv));
  document
    .querySelectorAll("#lb-period-toggle button")
    .forEach((b) => b.classList.toggle("active", b.dataset.period === currentPeriod));
  updateTitle();
}

document.addEventListener("DOMContentLoaded", () => {
  applyStateFromUrl();
  renderDivTabs();
  updateTitle();
  wirePeriodToggle();
  wireSearch();
  loadLeaderboard();
});

window.addEventListener("popstate", () => {
  applyStateFromUrl();
  loadLeaderboard();
});
