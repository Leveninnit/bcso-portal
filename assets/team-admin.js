/**
 * Powers team-admin.html — client for editing the Meet the Team roster.
 *
 * Requires the "High Command" Discord role. Access is enforced entirely
 * server-side by /api/admin/team (401 if not signed in, 403 if signed in
 * without the role) -- this page just reflects those responses; it never
 * trusts the client alone to decide who can edit.
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

function subdivisionOptions(selected) {
  const subs = window.SUBDIVISIONS || [];
  const blank = `<option value=""${selected ? "" : " selected"}>— None —</option>`;
  return (
    blank +
    subs
      .map(
        (s) =>
          `<option value="${escapeHtml(s.slug)}"${s.slug === selected ? " selected" : ""}>${escapeHtml(s.name || s.short)}</option>`
      )
      .join("")
  );
}

function renderSlots(roster) {
  const grid = document.getElementById("team-admin-grid");
  const bySlot = new Map(roster.map((r) => [r.slot_number, r]));
  const cards = [];

  for (let slot = 1; slot <= 5; slot++) {
    const r = bySlot.get(slot) || {};
    cards.push(`
      <div class="panel team-admin-card" data-slot="${slot}">
        <h2>Slot ${slot}</h2>
        <label>Character Name
          <input type="text" class="ta-name" value="${escapeHtml(r.character_name)}" maxlength="100" />
        </label>
        <label>Rank / Title
          <input type="text" class="ta-rank" value="${escapeHtml(r.rank_title)}" maxlength="100" />
        </label>
        <label>Subdivision
          <select class="ta-sub">${subdivisionOptions(r.subdivision_slug)}</select>
        </label>
        <label>Bio
          <textarea class="ta-bio" maxlength="1000" rows="3">${escapeHtml(r.bio)}</textarea>
        </label>
        <label>Photo URL
          <input type="text" class="ta-photo" value="${escapeHtml(r.photo_url)}" maxlength="500" placeholder="https://…" />
        </label>
        <button type="button" class="btn btn-gold ta-save">Save Slot ${slot}</button>
        <span class="ta-save-status"></span>
      </div>`);
  }

  grid.innerHTML = cards.join("");

  grid.querySelectorAll(".team-admin-card").forEach((card) => {
    const slot = Number(card.dataset.slot);
    const saveBtn = card.querySelector(".ta-save");
    const statusEl = card.querySelector(".ta-save-status");

    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      statusEl.textContent = "Saving…";
      const payload = {
        slotNumber: slot,
        characterName: card.querySelector(".ta-name").value.trim(),
        rankTitle: card.querySelector(".ta-rank").value.trim(),
        subdivisionSlug: card.querySelector(".ta-sub").value,
        bio: card.querySelector(".ta-bio").value.trim(),
        photoUrl: card.querySelector(".ta-photo").value.trim(),
      };
      try {
        const res = await fetch("/api/admin/team", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data && data.ok) {
          statusEl.textContent = "Saved.";
        } else {
          statusEl.textContent = (data && data.error) || "Failed to save.";
        }
      } catch {
        statusEl.textContent = "Failed to save. Check your connection.";
      }
      saveBtn.disabled = false;
      setTimeout(() => {
        statusEl.textContent = "";
      }, 3000);
    });
  });
}

async function loadAdmin() {
  const statusEl = document.getElementById("team-admin-status");
  const deniedEl = document.getElementById("team-admin-denied");
  const gridEl = document.getElementById("team-admin-grid");
  statusEl.textContent = "Loading…";
  try {
    const res = await fetch("/api/admin/team", { cache: "no-store" });
    if (res.status === 401 || res.status === 403) {
      statusEl.textContent = "";
      deniedEl.style.display = "";
      gridEl.style.display = "none";
      return;
    }
    // A server error here used to fall through to the same rendering path
    // as "you're allowed in, and the roster happens to be empty" -- so a
    // 500 rendered 5 blank, perfectly saveable cards. Someone hitting
    // "Save Slot" on one without noticing would then overwrite that
    // slot's real data with blanks. Refuse to render editable (and
    // save-able) fields at all when the load itself didn't actually
    // succeed.
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    const data = await res.json().catch(() => null);
    if (!data) throw new Error("Invalid response body");
    statusEl.textContent = "";
    renderSlots(data.roster || []);
  } catch {
    statusEl.textContent = "Couldn't load the roster right now — try refreshing before making changes.";
    gridEl.style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", loadAdmin);
