/**
 * Powers team.html — public, no login required (same visibility as the
 * Applications/Activity Log/Documents/Leaderboards pages).
 *
 * Fetches GET /api/team and renders the 5 High Command slots. A slot
 * with no character name saved yet renders as "Position Vacant" so the
 * page always shows exactly 5 cards regardless of how many are filled.
 */

function escapeHtml(str) {
  return (str ?? "").toString().replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function subFullName(slug) {
  const sub = (window.SUBDIVISIONS || []).find((s) => s.slug === slug);
  return sub ? sub.name || sub.short : "";
}

function renderRoster(roster) {
  const grid = document.getElementById("team-grid");
  const bySlot = new Map(roster.map((r) => [r.slot_number, r]));
  const cards = [];

  for (let slot = 1; slot <= 5; slot++) {
    const r = bySlot.get(slot);
    const filled = r && r.character_name;

    if (filled) {
      const sub = subFullName(r.subdivision_slug);
      const photo = r.photo_url
        ? `<img src="${escapeHtml(r.photo_url)}" alt="${escapeHtml(r.character_name)}" />`
        : `<div class="team-photo-fallback">${escapeHtml((r.character_name || "?").charAt(0).toUpperCase())}</div>`;
      cards.push(`
        <div class="team-card">
          <div class="team-photo">${photo}</div>
          <div class="team-slot-tag">Slot ${slot}</div>
          <h2 class="team-name">${escapeHtml(r.character_name)}</h2>
          ${r.rank_title ? `<div class="team-rank">${escapeHtml(r.rank_title)}</div>` : ""}
          ${sub ? `<div class="team-sub">${escapeHtml(sub)}</div>` : ""}
          ${r.bio ? `<p class="team-bio">${escapeHtml(r.bio)}</p>` : ""}
        </div>`);
    } else {
      cards.push(`
        <div class="team-card team-card-vacant">
          <div class="team-photo team-photo-vacant">★</div>
          <div class="team-slot-tag">Slot ${slot}</div>
          <h2 class="team-name team-name-vacant">Position Vacant</h2>
        </div>`);
    }
  }

  grid.innerHTML = cards.join("");
}

async function loadTeam() {
  const statusEl = document.getElementById("team-status");
  statusEl.textContent = "Loading…";
  try {
    const res = await fetch("/api/team", { cache: "no-store" });
    const data = await res.json().catch(() => null);
    renderRoster((data && data.roster) || []);
    statusEl.textContent = "";
  } catch {
    renderRoster([]);
    statusEl.textContent = "Couldn't load the roster right now. Try refreshing.";
  }
}

document.addEventListener("DOMContentLoaded", loadTeam);
