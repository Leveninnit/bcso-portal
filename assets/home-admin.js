/**
 * Powers home-admin.html — client for editing the homepage's Deputy of
 * the Week/Month and Patrol Photos sections.
 *
 * Requires High Command access. Access is enforced entirely server-side
 * by /api/admin/site-content (401 if not signed in, 403 if signed in
 * without High Command) — this page just reflects those responses.
 */

// Same escaping team-admin.js uses -- needed here for the same reason:
// renderPhotoRows below builds HTML via template string and assigns it
// through innerHTML, so any unescaped value (a saved photo caption/URL
// containing a `"` or `<`) could break out of its attribute and inject
// live markup/script into this admin page.
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

const MAX_PHOTOS = 8;

function renderPhotoRows(photos) {
  const grid = document.getElementById("hoa-photos-grid");
  const rows = [];
  for (let i = 0; i < MAX_PHOTOS; i++) {
    const p = photos[i] || {};
    rows.push(`
      <div class="panel team-admin-card" data-photo-index="${i}">
        <h2>Photo ${i + 1}</h2>
        <label>Image URL<input type="text" class="hoa-photo-url" value="${escapeHtml(p.url || "")}" maxlength="500" placeholder="https://…" /></label>
        <label>Caption<input type="text" class="hoa-photo-caption" value="${escapeHtml(p.caption || "")}" maxlength="200" /></label>
      </div>
    `);
  }
  grid.innerHTML = rows.join("");
}

function collectPhotos() {
  const photos = [];
  document.querySelectorAll("#hoa-photos-grid [data-photo-index]").forEach((card) => {
    const url = card.querySelector(".hoa-photo-url").value.trim();
    const caption = card.querySelector(".hoa-photo-caption").value.trim();
    if (url) photos.push({ url, caption });
  });
  return photos;
}

function fillDeputyForm(prefix, deputy) {
  const d = deputy || {};
  document.getElementById(`hoa-${prefix}-name`).value = d.characterName || "";
  document.getElementById(`hoa-${prefix}-rank`).value = d.rankTitle || "";
  document.getElementById(`hoa-${prefix}-sub`).innerHTML = subdivisionOptions(d.subdivisionSlug || "");
  document.getElementById(`hoa-${prefix}-blurb`).value = d.blurb || "";
  document.getElementById(`hoa-${prefix}-photo`).value = d.photoUrl || "";
}

function collectDeputy(prefix) {
  return {
    characterName: document.getElementById(`hoa-${prefix}-name`).value.trim(),
    rankTitle: document.getElementById(`hoa-${prefix}-rank`).value.trim(),
    subdivisionSlug: document.getElementById(`hoa-${prefix}-sub`).value,
    blurb: document.getElementById(`hoa-${prefix}-blurb`).value.trim(),
    photoUrl: document.getElementById(`hoa-${prefix}-photo`).value.trim(),
  };
}

async function loadAdmin() {
  const statusEl = document.getElementById("home-admin-status");
  const deniedEl = document.getElementById("home-admin-denied");
  const bodyEl = document.getElementById("home-admin-body");
  statusEl.textContent = "Loading…";
  try {
    const res = await fetch("/api/admin/site-content", { cache: "no-store" });
    if (res.status === 401 || res.status === 403) {
      statusEl.textContent = "";
      deniedEl.style.display = "";
      bodyEl.style.display = "none";
      return;
    }
    // See team-admin.js's loadAdmin for why this can't just fall through
    // to an empty-object fallback on failure -- that used to render fully
    // editable, blank fields ready to save right over the real saved
    // content on the next hiccup.
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    const data = await res.json().catch(() => null);
    if (!data) throw new Error("Invalid response body");
    statusEl.textContent = "";
    bodyEl.style.display = "";
    fillDeputyForm("week", data.deputyOfWeek);
    fillDeputyForm("month", data.deputyOfMonth);
    renderPhotoRows(data.patrolPhotos || []);

    document.getElementById("hoa-save").addEventListener("click", async () => {
      const saveStatus = document.getElementById("hoa-save-status");
      saveStatus.textContent = "Saving…";
      const payload = {
        deputyOfWeek: collectDeputy("week"),
        deputyOfMonth: collectDeputy("month"),
        patrolPhotos: collectPhotos(),
      };
      try {
        const putRes = await fetch("/api/admin/site-content", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const putData = await putRes.json().catch(() => null);
        saveStatus.textContent = putRes.ok && putData && putData.ok ? "Saved." : (putData && putData.error) || "Failed to save.";
      } catch {
        saveStatus.textContent = "Failed to save. Check your connection.";
      }
      setTimeout(() => (saveStatus.textContent = ""), 3000);
    });
  } catch {
    statusEl.textContent = "Couldn't load right now. Try refreshing.";
  }
}

document.addEventListener("DOMContentLoaded", loadAdmin);
