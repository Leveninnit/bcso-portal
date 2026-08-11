/**
 * Powers sop-admin.html — client for editing the on-site Standard
 * Operating Procedure text.
 *
 * Requires High Command access. Access is enforced entirely server-side
 * by /api/admin/sop (401 if not signed in, 403 if signed in without High
 * Command) — this page just reflects those responses, same pattern as
 * assets/home-admin.js.
 */

// Same "D1's datetime('now') is UTC without a 'Z'" handling as
// assets/leaderboards.js's formatDate.
function formatDate(value) {
  if (!value) return "";
  const iso = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function loadAdmin() {
  const statusEl = document.getElementById("sop-admin-status");
  const deniedEl = document.getElementById("sop-admin-denied");
  const bodyEl = document.getElementById("sop-admin-body");
  const lastUpdatedEl = document.getElementById("sop-admin-last-updated");
  statusEl.textContent = "Loading…";
  try {
    const res = await fetch("/api/admin/sop", { cache: "no-store" });
    if (res.status === 401 || res.status === 403) {
      statusEl.textContent = "";
      deniedEl.style.display = "";
      bodyEl.style.display = "none";
      return;
    }
    // Same reasoning as home-admin.js's loadAdmin: don't fall through to
    // an empty-string default on a failed/invalid response, or a hiccup
    // here could render an empty, ready-to-save editor right over the
    // real saved SOP text.
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    const data = await res.json().catch(() => null);
    if (!data) throw new Error("Invalid response body");
    statusEl.textContent = "";
    bodyEl.style.display = "";
    document.getElementById("sop-admin-text").value = data.text || "";
    lastUpdatedEl.textContent =
      data.lastUpdated && data.lastUpdated.at
        ? `Last updated ${formatDate(data.lastUpdated.at)} by ${data.lastUpdated.by}.`
        : "Never edited on the site yet.";

    const saveBtn = document.getElementById("sop-admin-save");
    saveBtn.addEventListener("click", async () => {
      const saveStatus = document.getElementById("sop-admin-save-status");
      saveStatus.textContent = "Saving…";
      saveBtn.disabled = true;
      try {
        const putRes = await fetch("/api/admin/sop", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: document.getElementById("sop-admin-text").value }),
        });
        const putData = await putRes.json().catch(() => null);
        if (putRes.ok && putData && putData.ok) {
          saveStatus.textContent = "Saved.";
          lastUpdatedEl.textContent = "Last updated just now.";
        } else {
          saveStatus.textContent = (putData && putData.error) || "Failed to save.";
        }
      } catch {
        saveStatus.textContent = "Failed to save. Check your connection.";
      } finally {
        saveBtn.disabled = false;
      }
      setTimeout(() => (saveStatus.textContent = ""), 3000);
    });
  } catch {
    statusEl.textContent = "Couldn't load right now. Try refreshing.";
  }
}

document.addEventListener("DOMContentLoaded", loadAdmin);
