(function () {
  const QUESTION_TYPE_LABELS = {
    text: "Short text",
    paragraph: "Paragraph",
    dropdown: "Dropdown",
  };
  const MOVEMENT_TAB_SLUG = "__deputy_movement__";
  // "Original fields" are the fixed fields built into every application/
  // log form (as opposed to the custom questions command staff adds).
  // These maps back the "Original Fields" editor in the Customize
  // Questions panel — command staff can reword any of them per
  // subdivision; the underlying field/validation never changes.
  const DEFAULT_FIELD_LABELS = {
    application: {
      characterName: "In-Game / Character Name",
      discordId: "Discord ID",
      badgeNumber: "Current Badge Number",
      rank: "Current Rank",
      whyJoin: "Why do you want to join this subdivision?",
      experience: "Relevant experience",
    },
    log: {
      characterName: "In-Game / Character Name",
      discordId: "Discord ID",
      badgeNumber: "Current Badge Number",
      rank: "Current Rank",
      hoursOnDuty: "Duration on Duty",
      summary: "Shift Summary",
    },
  };
  const FIELD_KEY_ORDER = {
    application: ["characterName", "discordId", "badgeNumber", "rank", "whyJoin", "experience"],
    log: ["characterName", "discordId", "badgeNumber", "rank", "hoursOnDuty", "summary"],
  };
  const FIELD_KEY_DISPLAY = {
    characterName: "Character Name field",
    discordId: "Discord ID field",
    badgeNumber: "Badge Number field",
    rank: "Rank field",
    whyJoin: '"Why join" question',
    experience: '"Experience" question',
    hoursOnDuty: '"Duration on Duty" question',
    summary: '"Summary" question',
  };

  let mySubdivisions = [];
  let activeSlug = null;
  let activeFormType = "application"; // "application" | "log"
  let activeInnerTab = "review"; // "review" | "customize"
  let questionLabelCache = {}; // `${slug}:${type}` -> { [questionId]: label }
  let movementInnerTabByScope = {}; // "global" | slug -> "generate" | "customize"
  let movementTemplatesCacheByScope = {}; // "global" | slug -> templates array
  let movementApprovedByScope = {}; // "global" | slug -> { mention: "<@id>" | "<@&id>" } | undefined
  let movementDiscordIdsByScope = {}; // "global" | slug -> string[] of stacked Discord IDs
let pendingHighlight = null; // id from a deep link (?div=&type=&id=), consumed once

  function el(id) {
    return document.getElementById(id);
  }
  function subInfo(slug) {
    const sub = (window.SUBDIVISIONS || []).find((s) => s.slug === slug);
    return sub || { slug, name: slug.toUpperCase(), short: slug.toUpperCase(), logOnly: false };
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

  // Same "D1's datetime('now') is UTC without a 'Z'" handling as
  // assets/leaderboards.js's formatDate. Used by the Roster panel's
  // "Last updated ... by ..." line (see content_meta).
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

  // ---------------------------------------------------------------------
  // Emergency Alert — a deliberately loud, single-purpose button for
  // subdivision heads to reach command staff's emergency contact
  // immediately over Discord DM, for situations that can't wait for a
  // normal channel post to be seen. Wired once at page load (the button
  // and modal are static markup in command-access.html, not re-rendered
  // by renderSubContent), and gated both here (button only shown once
  // mySubdivisions is known) and server-side (functions/api/admin/
  // emergency-alert.js re-checks the same "holds a subdivision command
  // role" requirement — this client-side check is a convenience, not the
  // actual authorization boundary).
  // ---------------------------------------------------------------------
  function setupEmergencyAlert() {
    const btn = el("ca-emergency-btn");
    const overlay = el("ca-emergency-overlay");
    const messageInput = el("ca-emergency-message");
    const confirmCheckbox = el("ca-emergency-confirm");
    const sendBtn = el("ca-emergency-send");
    const cancelBtn = el("ca-emergency-cancel");
    const statusEl = el("ca-emergency-status");
    if (!btn || !overlay || !messageInput || !confirmCheckbox || !sendBtn || !cancelBtn || !statusEl) return;

    function openModal() {
      messageInput.value = "";
      confirmCheckbox.checked = false;
      statusEl.textContent = "";
      sendBtn.disabled = false;
      overlay.style.display = "flex";
      messageInput.focus();
    }
    function closeModal() {
      overlay.style.display = "none";
    }

    btn.addEventListener("click", openModal);
    cancelBtn.addEventListener("click", closeModal);
    // Clicking the dimmed backdrop (not the modal card itself) closes it,
    // same convention as most modal dialogs.
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) closeModal();
    });
    overlay.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") closeModal();
    });

    sendBtn.addEventListener("click", async () => {
      const message = messageInput.value.trim();
      if (!message) {
        alert("Please describe the emergency before sending.");
        return;
      }
      if (!confirmCheckbox.checked) {
        alert("Please check the confirmation box before sending — this button is for genuine emergencies only.");
        return;
      }
      if (!confirm("Send this as an emergency alert? This immediately DMs command staff's emergency contact.")) {
        return;
      }
      sendBtn.disabled = true;
      statusEl.textContent = "Sending…";
      try {
        const res = await fetch("/api/admin/emergency-alert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data && data.ok) {
          statusEl.textContent = "Sent.";
          setTimeout(closeModal, 1200);
        } else {
          statusEl.textContent = (data && data.error) || "Couldn't send that. Please try again.";
          sendBtn.disabled = false;
        }
      } catch {
        statusEl.textContent = "Couldn't send that. Check your connection.";
        sendBtn.disabled = false;
      }
    });
  }

  async function init() {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
  const deepLinkParams = ["div", "type", "id"]
    .map((k) => (params.get(k) ? `${k}=${encodeURIComponent(params.get(k))}` : null))
    .filter(Boolean)
    .join("&");
  const loginLink = el("ca-login-link");
  if (loginLink && deepLinkParams) {
    loginLink.href = `/api/auth/login?returnTo=${encodeURIComponent(deepLinkParams)}`;
  }
    if (error) {
      const messages = {
        no_access: "You're logged into Discord, but you don't hold the Command Login role, so you can't access this dashboard.",
        missing_code: "Login didn't complete — please try again.",
        login_failed: "Something went wrong logging you in. Please try again in a moment.",
        access_denied: "Discord login was cancelled.",
        invalid_state: "Your login session expired or looked suspicious, so it was rejected for your safety — please try logging in again.",
      };
      const box = el("ca-error");
      box.textContent = messages[error] || `Login error: ${error}`;
      box.style.display = "block";
      // "no_access" means a real authorization check failed (logged in,
      // but missing the Command Login role) — play the access-denied
      // cue. Other errors are just login hiccups, not denials.
      if (window.BCSOEffects) {
        if (error === "no_access") window.BCSOEffects.playAuthDenied();
        else window.BCSOEffects.playError();
      }
    }

    let me;
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      me = await res.json();
    } catch {
      me = { loggedIn: false };
    }

    if (!me.loggedIn) {
      el("ca-login-gate").style.display = "block";
      el("ca-dashboard").style.display = "none";
      return;
    }

    el("ca-login-gate").style.display = "none";
    el("ca-dashboard").style.display = "block";
    // Command access just verified successfully — play the
    // authorization-granted cue.
    if (window.BCSOEffects) window.BCSOEffects.playAuthGranted();
    el("ca-whoami").textContent = `Logged in as ${me.username}`;
    // Logout used to be a plain <a href="/api/auth/logout"> GET link,
    // which meant any third-party page could force it via something as
    // simple as <img src="https://.../api/auth/logout"> -- the browser
    // still honors a Set-Cookie clearing the session from that response
    // even though SameSite=Lax stops the *original* cookie from being
    // sent cross-site. Logout is now POST-only (see logout.js) and
    // requires this in-page click, which a cross-origin <img>/<a> can't
    // trigger.
    const logoutBtn = el("ca-logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        logoutBtn.disabled = true;
        try {
          await fetch("/api/auth/logout", { method: "POST" });
        } catch {
          // Even if the request fails, still send them to the homepage --
          // worst case they're still logged in and can try again.
        }
        window.location.href = "index.html";
      });
    }
    mySubdivisions = me.subdivisions || [];

    if (!mySubdivisions.length) {
      el("ca-no-subs").style.display = "block";
    }
    // Emergency Alert is for subdivision heads specifically -- someone
    // with only High Command access and no subdivision command role
    // doesn't see the button, matching the server-side check.
    const emergencyBtn = el("ca-emergency-btn");
    if (emergencyBtn) emergencyBtn.style.display = mySubdivisions.length ? "" : "none";
    setupEmergencyAlert();

    // Deputy Movement is department-wide (anyone with Command Login can
    // use it), so the tabs — and a default tab to land on — always
    // render even if this person has no subdivision command role.
    renderSubTabs();
    const wantDiv = params.get("div");
  const wantType = params.get("type");
  const wantId = params.get("id");
  if (wantDiv && mySubdivisions.includes(wantDiv) && wantId) {
    activeSlug = wantDiv;
    activeFormType = wantType === "log" ? "log" : "application";
    activeInnerTab = "review";
    pendingHighlight = String(wantId);
  } else {
    activeSlug = mySubdivisions.length ? mySubdivisions[0] : MOVEMENT_TAB_SLUG;
  }
    renderSubContent();
  }

  function renderSubTabs() {
    const wrap = el("ca-sub-tabs");
    const subTabsHtml = mySubdivisions
      .map((slug) => {
        const info = subInfo(slug);
        return `<button type="button" class="ca-tab-btn" data-slug="${slug}">${escapeHtml(info.short)}</button>`;
      })
      .join("");
    const movementTabHtml = `<button type="button" class="ca-tab-btn" data-slug="${MOVEMENT_TAB_SLUG}">Deputy Movement</button>`;
    wrap.innerHTML = subTabsHtml + movementTabHtml;
    wrap.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeSlug = btn.dataset.slug;
        activeInnerTab = "review";
        // Reset the Applications/Activity Logs choice for the newly
        // selected subdivision instead of leaving whatever the
        // previous subdivision left behind (e.g. SRT is log-only and
        // forces "log" — without this, switching from SRT to a
        // subdivision that DOES have applications would silently land
        // on its Activity Logs tab, and — since the "Ranks" tab is
        // shown for one specific formType at a time — could leave the
        // person unable to find Ranks where they expected it).
        activeFormType = subInfo(activeSlug).logOnly ? "log" : "application";
        renderSubContent();
      });
    });
    updateActiveTabStyles();
  }

  function updateActiveTabStyles() {
    el("ca-sub-tabs")
      .querySelectorAll("button")
      .forEach((btn) => btn.classList.toggle("active", btn.dataset.slug === activeSlug));
  }

  function renderSubContent() {
    updateActiveTabStyles();
    const container = el("ca-sub-content");

    if (activeSlug === MOVEMENT_TAB_SLUG) {
      renderMovementTab(container, null);
      return;
    }

    const info = subInfo(activeSlug);
    const showApplications = !info.logOnly;
    if (!showApplications) activeFormType = "log";

    const innerTabsHtml = `
      <div class="ca-inner-tabs" id="ca-form-type-tabs" style="display:${activeInnerTab === "documents" ? "none" : ""};">
        ${showApplications ? `<button type="button" class="ca-inner-tab-btn" data-type="application">Applications</button>` : ""}
        <button type="button" class="ca-inner-tab-btn" data-type="log">Activity Logs</button>
      </div>
      <div class="ca-inner-tabs" id="ca-inner-tabs">
        <button type="button" class="ca-inner-tab-btn" data-tab="review">Pending Review</button>
        <button type="button" class="ca-inner-tab-btn" data-tab="customize">Customize Questions</button>
        <button type="button" class="ca-inner-tab-btn" data-tab="ranks">Ranks</button>
        <button type="button" class="ca-inner-tab-btn" data-tab="roster">Roster</button>
        <button type="button" class="ca-inner-tab-btn" data-tab="documents">Documents</button>
        <button type="button" class="ca-inner-tab-btn" data-tab="movements">Movement Templates</button>
        ${activeSlug !== "srt" ? `<button type="button" class="ca-inner-tab-btn" data-tab="leadership">Leadership</button>` : ""}
      </div>
      <div id="ca-panel"></div>
    `;
    container.innerHTML = innerTabsHtml;

    container.querySelectorAll("#ca-form-type-tabs button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.type === activeFormType);
      btn.addEventListener("click", () => {
        activeFormType = btn.dataset.type;
        renderSubContent();
      });
    });
    container.querySelectorAll("#ca-inner-tabs button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === activeInnerTab);
      btn.addEventListener("click", () => {
        activeInnerTab = btn.dataset.tab;
        renderSubContent();
      });
    });

    if (activeInnerTab === "review") {
      renderReviewPanel();
    } else if (activeInnerTab === "customize") {
      renderCustomizePanel();
    } else if (activeInnerTab === "ranks") {
      renderRanksPanel();
    } else if (activeInnerTab === "roster") {
      renderRosterPanel();
    } else if (activeInnerTab === "movements") {
      renderMovementTab(el("ca-panel"), activeSlug);
    } else if (activeInnerTab === "leadership") {
      renderLeadershipPanel();
    } else {
      renderDocumentsPanel();
    }
  }

  // ---------------------------------------------------------------------
  // Ranks — per-subdivision, ordered list of ranks. Powers the Activity
  // Log form's Rank dropdown, the Roster form's Rank dropdown, and the
  // sort order of this subdivision's public Roster (highest rank first)
  // — see functions/api/roster.js and functions/api/rank-options.js.
  // There's no public Ranks page anymore (removed) — this list is only
  // ever consumed by these dropdowns and the Roster sort.
  // ---------------------------------------------------------------------
  async function renderRanksPanel() {
    const panel = el("ca-panel");
    const rtdNote =
      "RTD's Activity Log rank dropdown starts out with 4 built-in options (RTD Assistant Field Trainer, RTD Field Trainer, RTD Operation lead, RTD Board of Directors +) that match the Master Roster sheet's Activation Log formulas. Add ranks here to replace that built-in list on RTD's Activity Log and Roster forms — if you do, make sure the wording still matches whatever the sheet's formulas expect (or update the sheet to match), since those formulas key off the exact rank text. Leave this empty to keep the built-in RTD list.";
    const otherNote = `Add the ranks deputies can pick from on ${subInfo(activeSlug).short}'s Activity Log and Roster forms. Order matters: drag rows to arrange these highest to lowest — it saves as soon as you drop, and this order is used to sort ${subInfo(activeSlug).short}'s Roster and controls what shows up in both Rank dropdowns. Leave this empty to keep the original free-text Rank fields (and manual Roster order).`;
    panel.innerHTML = `
      <div class="panel">
        <p class="ca-section-title">Rank Options</p>
        <p class="ca-muted">${activeSlug === "rtd" ? rtdNote : otherNote}</p>
        <div id="ca-rank-list">Loading…</div>
        <div class="ca-question-form" id="ca-add-rank-form"></div>
      </div>
    `;
    renderRankForm();
    await loadRankOptions();
  }

  async function loadRankOptions() {
    const list = el("ca-rank-list");
    const slug = activeSlug;
    try {
      const res = await fetch(`/api/admin/rank-options?div=${encodeURIComponent(slug)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("request failed");
      const data = await res.json();
      const options = data.options || [];
      if (!options.length) {
        list.innerHTML =
          slug === "rtd"
            ? `<p class="ca-muted">No custom ranks yet — RTD's form is using its built-in 4-option list.</p>`
            : `<p class="ca-muted">No rank options yet — the form is using the original free-text field.</p>`;
        return;
      }
      list.innerHTML = options
        .map(
          (o) => `
          <div class="ca-question-row ca-roster-row" data-rank-id="${o.id}" draggable="true">
            <div class="ca-roster-row-main">
              <span class="ca-drag-handle" title="Drag to reorder" aria-hidden="true">⠿</span>
              <div><strong>${escapeHtml(o.label)}</strong></div>
            </div>
            <div class="ca-actions">
              <button class="ca-btn-reject" data-rkaction="delete" data-rkid="${o.id}">Delete</button>
            </div>
          </div>
        `
        )
        .join("");
      list.querySelectorAll("[data-rkaction]").forEach((btn) => {
        btn.addEventListener("click", () => handleRankAction(btn.dataset.rkaction, options, btn.dataset.rkid));
      });
      setupRankDragReorder(list, options);
    } catch {
      list.innerHTML = `<p class="ca-muted">Couldn't load rank options. Try refreshing.</p>`;
    }
  }

  async function handleRankAction(action, options, id) {
    const o = options.find((x) => String(x.id) === String(id));
    if (!o) return;
    if (action === "delete") {
      if (!confirm(`Delete rank "${o.label}"?`)) return;
      const res = await fetch(`/api/admin/rank-options?id=${o.id}&div=${encodeURIComponent(activeSlug)}`, { method: "DELETE" });
      if (!res.ok) {
        alert("Couldn't delete that rank. Please try again.");
        return;
      }
      loadRankOptions();
      return;
    }
  }

  // Drag-and-drop reordering — same pattern as the Roster list's
  // setupRosterDragReorder above. Drag a rank by its ⠿ handle (or
  // anywhere on the row) and drop it on another rank to move it there;
  // saves immediately on drop (every option's sortOrder is rewritten to
  // its new position), then reloads from the server to confirm.
  let rankDragId = null;
  function setupRankDragReorder(list, options) {
    list.querySelectorAll(".ca-roster-row").forEach((row) => {
      row.addEventListener("dragstart", (ev) => {
        rankDragId = row.dataset.rankId;
        row.classList.add("ca-dragging");
        if (ev.dataTransfer) {
          ev.dataTransfer.effectAllowed = "move";
          try {
            ev.dataTransfer.setData("text/plain", row.dataset.rankId);
          } catch {}
        }
      });
      row.addEventListener("dragend", () => {
        rankDragId = null;
        list.querySelectorAll(".ca-roster-row").forEach((r) => {
          r.classList.remove("ca-dragging");
          r.classList.remove("ca-drag-over");
        });
      });
      row.addEventListener("dragover", (ev) => {
        if (!rankDragId || rankDragId === row.dataset.rankId) return;
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
        row.classList.add("ca-drag-over");
      });
      row.addEventListener("dragleave", () => {
        row.classList.remove("ca-drag-over");
      });
      row.addEventListener("drop", (ev) => {
        ev.preventDefault();
        row.classList.remove("ca-drag-over");
        if (!rankDragId || rankDragId === row.dataset.rankId) return;
        reorderRankOptions(options, rankDragId, row.dataset.rankId);
      });
    });
  }

  async function reorderRankOptions(options, draggedId, targetId) {
    const fromIdx = options.findIndex((x) => String(x.id) === String(draggedId));
    const toIdx = options.findIndex((x) => String(x.id) === String(targetId));
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = options.slice();
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    const list = el("ca-rank-list");
    list.style.opacity = "0.6";
    try {
      await Promise.all(reordered.map((o, i) => putRankOption({ ...o, sortOrder: i })));
    } finally {
      list.style.opacity = "";
      loadRankOptions();
    }
  }

  function putRankOption(o) {
    return fetch("/api/admin/rank-options", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: o.id, subdivisionSlug: activeSlug, label: o.label, sortOrder: o.sortOrder }),
    });
  }

  function renderRankForm() {
    const formBox = el("ca-add-rank-form");
    formBox.innerHTML = `
      <h4>Add a rank</h4>
      <div class="form-row">
        <label>Rank name</label>
        <input type="text" id="ca-rk-label" placeholder="e.g. Deputy Sheriff II" />
      </div>
      <div class="ca-actions">
        <button class="ca-btn-accept" id="ca-rk-save">Add rank</button>
      </div>
    `;
    const rkSaveBtn = el("ca-rk-save");
    rkSaveBtn.addEventListener("click", async () => {
      const label = el("ca-rk-label").value.trim();
      if (!label) {
        alert("Please enter a rank name.");
        return;
      }
      rkSaveBtn.disabled = true;
      try {
        const res = await fetch("/api/admin/rank-options", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subdivisionSlug: activeSlug, label, sortOrder: 9999 }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          alert((data && data.error) || "Couldn't add that rank. Please try again.");
          rkSaveBtn.disabled = false;
          return;
        }
      } catch {
        alert("Couldn't add that rank. Check your connection and try again.");
        rkSaveBtn.disabled = false;
        return;
      }
      renderRankForm();
      loadRankOptions();
    });
  }

  // ---------------------------------------------------------------------
  // Roster — every subdivision's own member roster (including SRT),
  // shown publicly on that subdivision's own Roster page
  // (roster.html?div=slug, linked from its Documents page). Each entry is
  // just a Rank + Badge Number (+ optional Notes) — Character Name,
  // Discord ID, and Department Status (Active / LOA / Inactive, etc.)
  // are resolved live from the Master Roster sheet by badge number, and
  // Hours / Activations / Activity are resolved live from that
  // subdivision's Activity Log submissions by badge number, both when
  // the public roster is loaded (see functions/api/roster.js), so
  // nothing here goes stale on its own.
  // ---------------------------------------------------------------------
  let rosterRankOptionsCache = {}; // slug -> string[] (for the Rank dropdown)

  async function renderRosterPanel() {
    const panel = el("ca-panel");
    panel.innerHTML = `
      <div class="panel">
        <p class="ca-section-title">${subInfo(activeSlug).short} Roster</p>
        <p class="ca-muted">Shown publicly on the ${subInfo(activeSlug).short} Roster page (linked from Documents). Add each member's Rank and Badge Number — their Character Name and Discord ID are pulled automatically from the Master Roster by badge number, so you never have to type or update those here. Drag rows to reorder, exactly how you want the roster to read top to bottom — it saves as soon as you drop.</p>
        <p class="ca-muted" id="ca-roster-last-updated"></p>
        <div id="ca-roster-list">Loading…</div>
        <div class="ca-question-form" id="ca-add-roster-form"></div>
      </div>
    `;
    renderRosterForm(null);
    await loadRosterEntries();
  }

  async function loadRankOptionsForRoster(slug) {
    if (rosterRankOptionsCache[slug]) return rosterRankOptionsCache[slug];
    try {
      const res = await fetch(`/api/admin/rank-options?div=${encodeURIComponent(slug)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("request failed");
      const data = await res.json();
      const labels = (data.options || []).map((o) => o.label);
      rosterRankOptionsCache[slug] = labels;
      return labels;
    } catch {
      return [];
    }
  }

  async function loadRosterEntries() {
    const list = el("ca-roster-list");
    const slug = activeSlug;
    try {
      const res = await fetch(`/api/admin/roster?div=${encodeURIComponent(slug)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("request failed");
      const data = await res.json();
      const entries = data.entries || [];
      const lastUpdatedEl = el("ca-roster-last-updated");
      if (lastUpdatedEl) {
        lastUpdatedEl.textContent =
          data.lastUpdated && data.lastUpdated.at
            ? `Last updated ${formatDate(data.lastUpdated.at)} by ${data.lastUpdated.by}.`
            : "";
      }
      if (!entries.length) {
        list.innerHTML = `<p class="ca-muted">No roster entries yet — add the first one below.</p>`;
        return;
      }
      list.innerHTML = entries
        .map(
          (e) => `
          <div class="ca-question-row ca-roster-row" data-entry-id="${e.id}" draggable="true">
            <div class="ca-roster-row-main">
              <span class="ca-drag-handle" title="Drag to reorder" aria-hidden="true">⠿</span>
              <div>
                <strong>${escapeHtml(e.rank || "(no rank set)")}</strong> &middot; Badge ${escapeHtml(e.badgeNumber)}
                ${e.notes ? `<div class="ca-question-meta">${escapeHtml(e.notes)}</div>` : ""}
              </div>
            </div>
            <div class="ca-actions">
              <button class="ca-btn-accept" data-rsaction="edit" data-rsid="${e.id}">Edit</button>
              <button class="ca-btn-reject" data-rsaction="delete" data-rsid="${e.id}">Delete</button>
            </div>
          </div>
        `
        )
        .join("");
      list.querySelectorAll("[data-rsaction]").forEach((btn) => {
        btn.addEventListener("click", () => handleRosterAction(btn.dataset.rsaction, entries, btn.dataset.rsid));
      });
      setupRosterDragReorder(list, entries);
    } catch {
      list.innerHTML = `<p class="ca-muted">Couldn't load the roster. Try refreshing.</p>`;
    }
  }

  async function handleRosterAction(action, entries, id) {
    const e = entries.find((x) => String(x.id) === String(id));
    if (!e) return;
    if (action === "delete") {
      if (!confirm(`Remove Badge ${e.badgeNumber} from the roster?`)) return;
      const res = await fetch(`/api/admin/roster?id=${e.id}&div=${encodeURIComponent(activeSlug)}`, { method: "DELETE" });
      if (!res.ok) {
        alert("Couldn't remove that roster entry. Please try again.");
        return;
      }
      loadRosterEntries();
      return;
    }
    if (action === "edit") {
      renderRosterForm(e);
      el("ca-add-roster-form").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
  }

  // Drag-and-drop reordering — replaces the old ↑/↓ buttons. Drag a row
  // by its ⠿ handle (or anywhere on the row) and drop it on another row
  // to move it there; the new order is saved immediately on drop (every
  // entry's sortOrder is rewritten to its new position), then the list
  // reloads from the server to confirm — no separate "Save order" step.
  let rosterDragId = null;
  function setupRosterDragReorder(list, entries) {
    list.querySelectorAll(".ca-roster-row").forEach((row) => {
      row.addEventListener("dragstart", (ev) => {
        rosterDragId = row.dataset.entryId;
        row.classList.add("ca-dragging");
        if (ev.dataTransfer) {
          ev.dataTransfer.effectAllowed = "move";
          try {
            ev.dataTransfer.setData("text/plain", row.dataset.entryId);
          } catch {}
        }
      });
      row.addEventListener("dragend", () => {
        rosterDragId = null;
        list.querySelectorAll(".ca-roster-row").forEach((r) => {
          r.classList.remove("ca-dragging");
          r.classList.remove("ca-drag-over");
        });
      });
      row.addEventListener("dragover", (ev) => {
        if (!rosterDragId || rosterDragId === row.dataset.entryId) return;
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
        row.classList.add("ca-drag-over");
      });
      row.addEventListener("dragleave", () => {
        row.classList.remove("ca-drag-over");
      });
      row.addEventListener("drop", (ev) => {
        ev.preventDefault();
        row.classList.remove("ca-drag-over");
        if (!rosterDragId || rosterDragId === row.dataset.entryId) return;
        reorderRosterEntries(entries, rosterDragId, row.dataset.entryId);
      });
    });
  }

  async function reorderRosterEntries(entries, draggedId, targetId) {
    const fromIdx = entries.findIndex((x) => String(x.id) === String(draggedId));
    const toIdx = entries.findIndex((x) => String(x.id) === String(targetId));
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = entries.slice();
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    const list = el("ca-roster-list");
    list.style.opacity = "0.6";
    try {
      await Promise.all(reordered.map((e, i) => putRosterEntry({ ...e, sortOrder: i })));
    } finally {
      list.style.opacity = "";
      loadRosterEntries();
    }
  }

  function putRosterEntry(e) {
    return fetch("/api/admin/roster", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: e.id,
        subdivisionSlug: activeSlug,
        rank: e.rank,
        badgeNumber: e.badgeNumber,
        notes: e.notes,
        sortOrder: e.sortOrder,
      }),
    });
  }

  // `editing` is null when adding a new entry, or an existing entry
  // object when editing one in place.
  async function renderRosterForm(editing) {
    const formBox = el("ca-add-roster-form");
    const rankOptions = await loadRankOptionsForRoster(activeSlug);
    // Real <select> once the subdivision has Ranks configured (Command
    // Access -> Ranks) — keeps roster entries matching an actual rank so
    // the public Roster sorts correctly. Falls back to free text if
    // nothing's configured yet, same as before. If an entry being edited
    // has a rank that's no longer in the list (renamed/removed since),
    // it's added as an extra option so saving doesn't silently blank it.
    const currentRank = editing ? (editing.rank || "") : "";
    const staleCurrentRank = currentRank && !rankOptions.includes(currentRank);
    const rankFieldHtml = rankOptions.length
      ? `<select id="ca-rs-rank">
          <option value="">— No rank set —</option>
          ${staleCurrentRank ? `<option value="${escapeHtml(currentRank)}" selected>${escapeHtml(currentRank)} (no longer in the list)</option>` : ""}
          ${rankOptions
            .map((r) => `<option value="${escapeHtml(r)}" ${currentRank === r ? "selected" : ""}>${escapeHtml(r)}</option>`)
            .join("")}
        </select>
        <span class="hint">Pick from ${subInfo(activeSlug).short}'s configured ranks (Command Access -> Ranks).${staleCurrentRank ? " This entry's current rank isn't in that list anymore — pick a new one to update it." : ""}</span>`
      : `<input type="text" id="ca-rs-rank" placeholder="e.g. Deputy Sheriff II" value="${escapeHtml(currentRank)}" />
        <span class="hint">${subInfo(activeSlug).short} doesn't have Ranks configured yet (Command Access -> Ranks) — free text for now.</span>`;
    formBox.innerHTML = `
      <h4>${editing ? `Edit Badge ${escapeHtml(editing.badgeNumber)}` : "Add a roster entry"}</h4>
      <div class="form-row">
        <label>Rank</label>
        ${rankFieldHtml}
      </div>
      <div class="form-row">
        <label>Badge Number *</label>
        <input type="text" id="ca-rs-badge" placeholder="e.g. 1042" value="${editing ? escapeHtml(editing.badgeNumber) : ""}" />
        <span class="hint">Must match their Badge Number on the Master Roster exactly — that's how their Name, Discord ID, and Department Status get filled in automatically. It's also matched against their Activity Log submissions for this subdivision to fill in Hours, Activations, and Activity.</span>
      </div>
      <div class="form-row">
        <label>Notes (optional)</label>
        <input type="text" id="ca-rs-notes" placeholder="e.g. FTO, Probationary — anything you want shown" value="${editing ? escapeHtml(editing.notes) : ""}" />
      </div>
      <div class="ca-actions">
        <button class="ca-btn-accept" id="ca-rs-save">${editing ? "Save changes" : "Add to roster"}</button>
        ${editing ? `<button class="ca-btn-delete" id="ca-rs-cancel">Cancel</button>` : ""}
        <span class="ca-muted" id="ca-rs-status"></span>
      </div>
    `;
    if (editing && el("ca-rs-cancel")) {
      el("ca-rs-cancel").addEventListener("click", () => renderRosterForm(null));
    }
    el("ca-rs-save").addEventListener("click", async () => {
      const badgeNumber = el("ca-rs-badge").value.trim();
      if (!badgeNumber) {
        alert("Please enter a Badge Number.");
        return;
      }
      const payload = {
        subdivisionSlug: activeSlug,
        rank: el("ca-rs-rank").value.trim(),
        badgeNumber,
        notes: el("ca-rs-notes").value.trim(),
      };
      const statusEl = el("ca-rs-status");
      statusEl.textContent = "Saving…";
      try {
        const res = await fetch("/api/admin/roster", {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editing ? { ...payload, id: editing.id, sortOrder: editing.sortOrder } : payload),
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data && data.ok) {
          renderRosterForm(null);
          loadRosterEntries();
        } else {
          statusEl.textContent = (data && data.error) || "Failed to save.";
        }
      } catch {
        statusEl.textContent = "Failed to save. Check your connection.";
      }
    });
  }

  // ---------------------------------------------------------------------
  // Pending review
  // ---------------------------------------------------------------------
  async function renderReviewPanel() {
    const panel = el("ca-panel");
  const defaultStatus = pendingHighlight ? "" : "pending";
    panel.innerHTML = `
      <div class="panel">
        <label for="ca-status-filter">Show:</label>
        <select id="ca-status-filter">
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </select>
        <div id="ca-submission-list" style="margin-top:1rem;">Loading…</div>
      </div>
    `;
    const select = el("ca-status-filter");
  select.value = defaultStatus;
    select.addEventListener("change", () => loadSubmissions(select.value));
    await loadSubmissions(defaultStatus);
  }

  async function loadQuestionLabels(slug, type) {
    const cacheKey = `${slug}:${type}`;
    if (questionLabelCache[cacheKey]) return questionLabelCache[cacheKey];
    try {
      const res = await fetch(`/api/admin/questions?div=${encodeURIComponent(slug)}&type=${type}`, { cache: "no-store" });
      const data = await res.json();
      const map = {};
      (data.questions || []).forEach((q) => (map[q.id] = q.label));
      questionLabelCache[cacheKey] = map;
      return map;
    } catch {
      return {};
    }
  }

  // Submissions list used to hard-cap at whatever the server's own LIMIT
  // was (200), with nothing past that reachable from the dashboard at
  // all. Now paginated: loadSubmissions(status) loads/replaces page 1 as
  // before, and a "Load more" button (appended when the server reports
  // hasMore) fetches the next page and appends it instead of re-fetching
  // everything from the start.
  async function fetchSubmissionsPage(slug, type, status, offset) {
    const url = `/api/admin/submissions?div=${encodeURIComponent(slug)}&type=${type}${status ? `&status=${status}` : ""}&offset=${offset}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("request failed");
    return res.json();
  }

  // Guards the "Load more" button against a stale response landing after
  // the list has moved on to a different status filter / subdivision /
  // form type -- without this, a "Load more" fetch that was still in
  // flight when the filter changed would append its (now wrong-filter)
  // results onto the freshly-loaded list once it finally resolved.
  // loadSubmissions() bumps this every time it starts a fresh load; any
  // in-flight "Load more" click checks its captured seq against the
  // current value before touching the DOM.
  let submissionsSeq = 0;

  function wireSubmissionActions(list, slug, status) {
    list.querySelectorAll("[data-action]").forEach((btn) => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = "1";
      btn.addEventListener("click", () => handleSubmissionAction(btn.dataset.action, btn.dataset.id, slug, status));
    });
  }

  function renderLoadMoreButton(list, slug, type, status, nextOffset, seq) {
    const old = list.parentElement.querySelector(".ca-load-more");
    if (old) old.remove();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ca-btn-accept ca-load-more";
    btn.style.marginTop = "1rem";
    btn.textContent = "Load more";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Loading…";
      try {
        const data = await fetchSubmissionsPage(slug, type, status, nextOffset);
        if (seq !== submissionsSeq) return; // filter/subdivision changed while this was in flight
        const labels = await loadQuestionLabels(slug, type);
        if (seq !== submissionsSeq) return;
        const html = (data.submissions || []).map((s) => renderSubmissionCard(s, labels)).join("");
        list.insertAdjacentHTML("beforeend", html);
        wireSubmissionActions(list, slug, status);
        if (data.hasMore) {
          renderLoadMoreButton(list, slug, type, status, data.nextOffset, seq);
        } else {
          btn.remove();
        }
      } catch {
        if (seq !== submissionsSeq) return;
        btn.disabled = false;
        btn.textContent = "Couldn't load more — try again";
      }
    });
    list.insertAdjacentElement("afterend", btn);
  }

  async function loadSubmissions(status) {
    const list = el("ca-submission-list");
    if (!list) return;
    const seq = ++submissionsSeq;
    list.innerHTML = "Loading…";
    const existingLoadMore = list.parentElement.querySelector(".ca-load-more");
    if (existingLoadMore) existingLoadMore.remove();
    const slug = activeSlug;
    const type = activeFormType;
  const highlightId = pendingHighlight;
    try {
      const data = await fetchSubmissionsPage(slug, type, status, 0);
      if (seq !== submissionsSeq) return;
      const labels = await loadQuestionLabels(slug, type);
      if (seq !== submissionsSeq) return;
      if (!data.submissions || !data.submissions.length) {
        list.innerHTML = `<p class="ca-muted">Nothing here.</p>`;
        pendingHighlight = null;
      return;
      }
      list.innerHTML = data.submissions.map((s) => renderSubmissionCard(s, labels)).join("");
      wireSubmissionActions(list, slug, status);
      if (data.hasMore) {
        renderLoadMoreButton(list, slug, type, status, data.nextOffset, seq);
      }
    if (highlightId) {
      const card = list.querySelector(`[data-subid="${highlightId}"]`);
      if (card) {
        card.classList.add("ca-highlight");
        card.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      pendingHighlight = null;
    }
    } catch {
      if (seq !== submissionsSeq) return;
      list.innerHTML = `<p class="ca-muted">Couldn't load submissions. Try refreshing.</p>`;
    }
  }

  function renderSubmissionCard(s, labels) {
    const core = s.coreFields || {};
    const coreEntries =
      s.formType === "application"
        ? [
            ["Why join?", core.whyJoin],
            ["Experience", core.experience],
          ]
        : [
            ["Duration", core.durationDisplay || core.hoursOnDuty],
            ["Summary", core.summary],
          ];
    const answerEntries = Object.entries(s.answers || {}).map(([qid, val]) => [labels[qid] || `Question ${qid}`, val]);
    const allFields = [
      ["Character", s.characterName],
      ["Discord ID", s.discordId],
      ["Badge", s.badgeNumber],
      ["Rank", s.rank],
      ...coreEntries,
      ...answerEntries,
    ];
    const actions =
      s.status === "pending"
        ? `<button class="ca-btn-accept" data-action="accept" data-id="${s.id}">Accept</button>
           <button class="ca-btn-reject" data-action="reject" data-id="${s.id}">Reject</button>
           <button class="ca-btn-delete" data-action="delete" data-id="${s.id}">Delete</button>`
        : `<button class="ca-btn-delete" data-action="delete" data-id="${s.id}">Delete</button>`;
    const decidedNote =
      s.status !== "pending" && s.decidedBy
        ? `<div class="ca-question-meta">${s.status === "accepted" ? "Approved" : "Rejected"} by ${escapeHtml(s.decidedBy)}</div>`
        : "";
    return `
      <div class="ca-submission-card" data-subid="${s.id}">
        <strong>${escapeHtml(s.characterName)}</strong>
        <span class="ca-status ${s.status}">${s.status}</span>
        ${decidedNote}
        <div class="ca-submission-fields">
          ${allFields
            .filter(([, v]) => v !== undefined && v !== null && v !== "")
            .map(([label, val]) => `<div><div class="label">${escapeHtml(label)}</div>${escapeHtml(val)}</div>`)
            .join("")}
        </div>
        <div class="ca-actions">${actions}</div>
      </div>
    `;
  }

  async function handleSubmissionAction(action, id, slug, status) {
    // Neither branch used to check res.ok -- a failed delete/decide
    // (session expired, someone else already decided it, a network hiccup)
    // silently fell through to loadSubmissions() as if it had worked, with
    // no indication to whoever clicked the button that nothing actually
    // happened.
    if (action === "delete") {
      if (!confirm("Delete this submission permanently? This can't be undone.")) return;
      const res = await fetch(`/api/admin/submissions?id=${id}&div=${encodeURIComponent(slug)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert((data && data.error) || "Couldn't delete that submission. Please try again.");
        return;
      }
    } else {
      const res = await fetch("/api/admin/submissions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: Number(id), subdivisionSlug: slug, status: action === "accept" ? "accepted" : "rejected" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert((data && data.error) || "Couldn't save that decision. Please try again.");
        // Refresh anyway -- e.g. a 409 means someone else already decided
        // this one (see the status='pending' guard on the server), so the
        // list should still pick up its real current status.
        loadSubmissions(status);
        return;
      }
    }
    loadSubmissions(status);
  }

  // ---------------------------------------------------------------------
  // Question customizer
  // ---------------------------------------------------------------------
  async function renderCustomizePanel() {
    const panel = el("ca-panel");
    panel.innerHTML = `
      <div class="panel">
        <p class="ca-section-title">Original Fields</p>
        <p class="ca-muted">These are the fixed fields built into every ${activeFormType === "application" ? "application" : "activity log"} form. Reword any of them for this subdivision — the underlying field, validation, and roster auto-fill all keep working exactly as before.</p>
        <div id="ca-field-labels">Loading…</div>
        <p class="ca-section-title">Custom Questions</p>
        <p class="ca-muted">These extra questions appear underneath the standard fields (Discord ID, Character Name, Badge, Rank) on this subdivision's ${activeFormType === "application" ? "application" : "activity log"} form.</p>
        <div id="ca-question-list">Loading…</div>
        <div class="ca-question-form" id="ca-add-question-form"></div>
      </div>
    `;
    renderQuestionForm(null);
    await Promise.all([loadFieldLabels(), loadQuestions()]);
  }

  async function loadFieldLabels() {
    const box = el("ca-field-labels");
    const slug = activeSlug;
    const type = activeFormType;
    try {
      const res = await fetch(`/api/admin/field-labels?div=${encodeURIComponent(slug)}&type=${type}`, { cache: "no-store" });
      if (!res.ok) throw new Error("request failed");
      const data = await res.json();
      const overrides = data.labels || {};
      box.innerHTML = FIELD_KEY_ORDER[type].map((fieldKey) => renderFieldLabelRow(fieldKey, overrides[fieldKey])).join("");
      box.querySelectorAll("[data-flaction]").forEach((btn) => {
        btn.addEventListener("click", () => handleFieldLabelAction(btn.dataset.flaction, btn.dataset.field, btn));
      });
    } catch {
      box.innerHTML = `<p class="ca-muted">Couldn't load original fields. Try refreshing.</p>`;
    }
  }

  function renderFieldLabelRow(fieldKey, overrideValue) {
    const current = overrideValue || DEFAULT_FIELD_LABELS[activeFormType][fieldKey];
    const isOverridden = !!overrideValue;
    return `
      <div class="ca-question-row">
        <div style="flex:1; min-width:220px;">
          <div class="ca-question-meta">${FIELD_KEY_DISPLAY[fieldKey]}</div>
          <input type="text" id="ca-fl-${fieldKey}" value="${escapeHtml(current)}" />
        </div>
        <div class="ca-actions">
          <button class="ca-btn-accept" data-flaction="save" data-field="${fieldKey}">Save</button>
          ${isOverridden ? `<button class="ca-btn-delete" data-flaction="reset" data-field="${fieldKey}">Reset to default</button>` : ""}
        </div>
      </div>
    `;
  }

  async function handleFieldLabelAction(action, fieldKey, btn) {
    const slug = activeSlug;
    const type = activeFormType;
    if (action === "reset") {
      if (!confirm(`Reset "${FIELD_KEY_DISPLAY[fieldKey]}" back to its default wording?`)) return;
      if (btn) btn.disabled = true;
      try {
        const res = await fetch(
          `/api/admin/field-labels?div=${encodeURIComponent(slug)}&type=${type}&field=${encodeURIComponent(fieldKey)}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          alert("Couldn't reset that field. Please try again.");
          if (btn) btn.disabled = false;
          return;
        }
      } catch {
        alert("Couldn't reset that field. Check your connection and try again.");
        if (btn) btn.disabled = false;
        return;
      }
      loadFieldLabels();
      return;
    }
    if (action === "save") {
      const input = el(`ca-fl-${fieldKey}`);
      const label = input.value.trim();
      if (!label) {
        alert("Please enter a label.");
        return;
      }
      if (btn) btn.disabled = true;
      try {
        const res = await fetch("/api/admin/field-labels", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subdivisionSlug: slug, formType: type, fieldKey, label }),
        });
        if (!res.ok) {
          alert("Couldn't save that label. Please try again.");
          if (btn) btn.disabled = false;
          return;
        }
      } catch {
        alert("Couldn't save that label. Check your connection and try again.");
        if (btn) btn.disabled = false;
        return;
      }
      loadFieldLabels();
    }
  }

  async function loadQuestions() {
    const list = el("ca-question-list");
    const slug = activeSlug;
    const type = activeFormType;
    try {
      const res = await fetch(`/api/admin/questions?div=${encodeURIComponent(slug)}&type=${type}`, { cache: "no-store" });
      if (!res.ok) throw new Error("request failed");
      const data = await res.json();
      questionLabelCache[`${slug}:${type}`] = {};
      (data.questions || []).forEach((q) => (questionLabelCache[`${slug}:${type}`][q.id] = q.label));
      if (!data.questions || !data.questions.length) {
        list.innerHTML = `<p class="ca-muted">No custom questions yet.</p>`;
        return;
      }
      list.innerHTML = data.questions.map((q, i) => renderQuestionRow(q, i, data.questions.length)).join("");
      list.querySelectorAll("[data-qaction]").forEach((btn) => {
        btn.addEventListener("click", () => handleQuestionAction(btn.dataset.qaction, data.questions, btn.dataset.qid));
      });
    } catch {
      list.innerHTML = `<p class="ca-muted">Couldn't load questions. Try refreshing.</p>`;
    }
  }

  function renderQuestionRow(q, index, total) {
    const optionsHtml = q.questionType === "dropdown"
      ? q.options.map((o) => `<span class="ca-option-chip">${escapeHtml(o)}</span>`).join("")
      : "";
    return `
      <div class="ca-question-row">
        <div>
          <strong>${escapeHtml(q.label)}</strong>
          <div class="ca-question-meta">${QUESTION_TYPE_LABELS[q.questionType] || q.questionType} · ${q.required ? "Required" : "Optional"}</div>
          ${optionsHtml ? `<div>${optionsHtml}</div>` : ""}
        </div>
        <div class="ca-actions">
          <button class="ca-btn-delete" data-qaction="up" data-qid="${q.id}" ${index === 0 ? "disabled" : ""}>↑</button>
          <button class="ca-btn-delete" data-qaction="down" data-qid="${q.id}" ${index === total - 1 ? "disabled" : ""}>↓</button>
          <button class="ca-btn-delete" data-qaction="edit" data-qid="${q.id}">Edit</button>
          <button class="ca-btn-reject" data-qaction="delete" data-qid="${q.id}">Delete</button>
        </div>
      </div>
    `;
  }

  async function handleQuestionAction(action, questions, qid) {
    const q = questions.find((x) => String(x.id) === String(qid));
    if (!q) return;
    if (action === "delete") {
      if (!confirm(`Delete question "${q.label}"? This can't be undone.`)) return;
      const res = await fetch(`/api/admin/questions?id=${q.id}&div=${encodeURIComponent(activeSlug)}`, { method: "DELETE" });
      if (!res.ok) {
        alert("Couldn't delete that question. Please try again.");
        return;
      }
      loadQuestions();
      return;
    }
    if (action === "edit") {
      renderQuestionForm(q);
      return;
    }
    if (action === "up" || action === "down") {
      const idx = questions.findIndex((x) => String(x.id) === String(qid));
      const swapIdx = action === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= questions.length) return;
      const other = questions[swapIdx];
      const aOrder = q.sortOrder;
      const bOrder = other.sortOrder;
      await Promise.all([
        putQuestion({ ...q, sortOrder: bOrder }),
        putQuestion({ ...other, sortOrder: aOrder }),
      ]);
      loadQuestions();
    }
  }

  async function putQuestion(q) {
    return fetch("/api/admin/questions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: q.id,
        subdivisionSlug: activeSlug,
        label: q.label,
        questionType: q.questionType,
        options: q.options,
        required: q.required,
        sortOrder: q.sortOrder,
      }),
    });
  }

  function renderQuestionForm(editing) {
    const formBox = el("ca-add-question-form");
    const isEdit = !!editing;
    formBox.innerHTML = `
      <h4>${isEdit ? "Edit question" : "Add a question"}</h4>
      <div class="form-row">
        <label>Question text</label>
        <input type="text" id="ca-q-label" value="${escapeHtml(editing?.label || "")}" placeholder="e.g. Preferred callsign" />
      </div>
      <div class="form-row">
        <label>Type</label>
        <select id="ca-q-type">
          <option value="text" ${editing?.questionType === "text" ? "selected" : ""}>Short text</option>
          <option value="paragraph" ${editing?.questionType === "paragraph" ? "selected" : ""}>Paragraph</option>
          <option value="dropdown" ${editing?.questionType === "dropdown" ? "selected" : ""}>Dropdown</option>
        </select>
      </div>
      <div id="ca-q-options" style="display:${editing?.questionType === "dropdown" ? "block" : "none"};">
        <label>Dropdown options</label>
        <div id="ca-q-option-rows"></div>
        <button type="button" class="ca-btn-delete" id="ca-q-add-option">+ Add option</button>
      </div>
      <div class="form-row">
        <label><input type="checkbox" id="ca-q-required" ${editing?.required !== false ? "checked" : ""} /> Required</label>
      </div>
      <div class="ca-actions">
        <button class="ca-btn-accept" id="ca-q-save">${isEdit ? "Save changes" : "Add question"}</button>
        ${isEdit ? `<button class="ca-btn-delete" id="ca-q-cancel">Cancel</button>` : ""}
      </div>
    `;

    const optionRows = el("ca-q-option-rows");
    function addOptionRow(value) {
      const row = document.createElement("div");
      row.className = "ca-option-list-row";
      row.innerHTML = `<input type="text" value="${escapeHtml(value || "")}" placeholder="Option text" /><button type="button" class="ca-btn-delete">✕</button>`;
      row.querySelector("button").addEventListener("click", () => row.remove());
      optionRows.appendChild(row);
    }
    (editing?.options && editing.options.length ? editing.options : [""]).forEach(addOptionRow);

    el("ca-q-type").addEventListener("change", (e) => {
      el("ca-q-options").style.display = e.target.value === "dropdown" ? "block" : "none";
    });
    el("ca-q-add-option").addEventListener("click", () => addOptionRow(""));
    if (isEdit) {
      el("ca-q-cancel").addEventListener("click", () => renderQuestionForm(null));
    }
    const qSaveBtn = el("ca-q-save");
    qSaveBtn.addEventListener("click", async () => {
      const label = el("ca-q-label").value.trim();
      const questionType = el("ca-q-type").value;
      const required = el("ca-q-required").checked;
      const options = Array.from(optionRows.querySelectorAll("input"))
        .map((i) => i.value.trim())
        .filter(Boolean);
      if (!label) {
        alert("Please enter the question text.");
        return;
      }
      if (questionType === "dropdown" && !options.length) {
        alert("Add at least one dropdown option.");
        return;
      }
      const payload = {
        subdivisionSlug: activeSlug,
        formType: activeFormType,
        label,
        questionType,
        options,
        required,
      };
      qSaveBtn.disabled = true;
      try {
        const res = isEdit
          ? await putQuestion({ ...payload, id: editing.id, sortOrder: editing.sortOrder })
          : await fetch("/api/admin/questions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...payload, sortOrder: 9999 }),
            });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          alert((data && data.error) || "Couldn't save that question. Please try again.");
          qSaveBtn.disabled = false;
          return;
        }
      } catch {
        alert("Couldn't save that question. Check your connection and try again.");
        qSaveBtn.disabled = false;
        return;
      }
      renderQuestionForm(null);
      loadQuestions();
    });
  }

  // ---------------------------------------------------------------------
// Documents — lets a subdivision's command staff manage the documents
// shown on that subdivision's own Documents page (documents.html?div=slug),
// linked from the Master Documents page's subdivision grid.
// ---------------------------------------------------------------------
async function renderDocumentsPanel() {
  const panel = el("ca-panel");
  panel.innerHTML = `
    <div class="panel">
      <p class="ca-section-title">Subdivision Documents</p>
      <p class="ca-muted">These show up on this subdivision's own Documents page, linked from the Master Documents page. Visible to everyone, not just command staff.</p>
      <div id="ca-document-list">Loading…</div>
      <div class="ca-question-form" id="ca-add-document-form"></div>
    </div>
  `;
  renderDocumentForm(null);
  await loadDocuments();
}

async function loadDocuments() {
  const list = el("ca-document-list");
  const slug = activeSlug;
  try {
    const res = await fetch(`/api/admin/documents?div=${encodeURIComponent(slug)}`, { cache: "no-store" });
    if (!res.ok) throw new Error("request failed");
    const data = await res.json();
    if (!data.documents || !data.documents.length) {
      list.innerHTML = `<p class="ca-muted">No documents yet.</p>`;
      return;
    }
    list.innerHTML = data.documents.map((d, i) => renderDocumentRow(d, i, data.documents.length)).join("");
    list.querySelectorAll("[data-daction]").forEach((btn) => {
      btn.addEventListener("click", () => handleDocumentAction(btn.dataset.daction, data.documents, btn.dataset.did));
    });
  } catch {
    list.innerHTML = `<p class="ca-muted">Couldn't load documents. Try refreshing.</p>`;
  }
}

function renderDocumentRow(d, index, total) {
  return `
    <div class="ca-question-row">
      <div>
        <strong>${escapeHtml(d.name)}</strong>
        <div class="ca-question-meta">${d.description ? escapeHtml(d.description) : "No description"}</div>
        <div><a href="${escapeHtml(d.url)}" target="_blank" rel="noopener">${escapeHtml(d.url)}</a></div>
      </div>
      <div class="ca-actions">
        <button class="ca-btn-delete" data-daction="up" data-did="${d.id}" ${index === 0 ? "disabled" : ""}>↑</button>
        <button class="ca-btn-delete" data-daction="down" data-did="${d.id}" ${index === total - 1 ? "disabled" : ""}>↓</button>
        <button class="ca-btn-delete" data-daction="edit" data-did="${d.id}">Edit</button>
        <button class="ca-btn-reject" data-daction="delete" data-did="${d.id}">Delete</button>
      </div>
    </div>
  `;
}

async function handleDocumentAction(action, documents, did) {
  const d = documents.find((x) => String(x.id) === String(did));
  if (!d) return;
  if (action === "delete") {
    if (!confirm(`Delete document "${d.name}"? This can't be undone.`)) return;
    const res = await fetch(`/api/admin/documents?id=${d.id}&div=${encodeURIComponent(activeSlug)}`, { method: "DELETE" });
    if (!res.ok) {
      alert("Couldn't delete that document. Please try again.");
      return;
    }
    loadDocuments();
    return;
  }
  if (action === "edit") {
    renderDocumentForm(d);
    return;
  }
  if (action === "up" || action === "down") {
    const idx = documents.findIndex((x) => String(x.id) === String(did));
    const swapIdx = action === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= documents.length) return;
    const other = documents[swapIdx];
    const aOrder = d.sortOrder;
    const bOrder = other.sortOrder;
    await Promise.all([
      putDocument({ ...d, sortOrder: bOrder }),
      putDocument({ ...other, sortOrder: aOrder }),
    ]);
    loadDocuments();
  }
}

function putDocument(d) {
  return fetch("/api/admin/documents", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: d.id,
      subdivisionSlug: activeSlug,
      name: d.name,
      description: d.description,
      url: d.url,
      sortOrder: d.sortOrder,
    }),
  });
}

function renderDocumentForm(editing) {
  const formBox = el("ca-add-document-form");
  const isEdit = !!editing;
  formBox.innerHTML = `
    <h4>${isEdit ? "Edit document" : "Add a document"}</h4>
    <div class="form-row">
      <label>Document name</label>
      <input type="text" id="ca-d-name" value="${escapeHtml(editing?.name || "")}" placeholder="e.g. Field Training Manual" />
    </div>
    <div class="form-row">
      <label>Description (optional)</label>
      <input type="text" id="ca-d-description" value="${escapeHtml(editing?.description || "")}" placeholder="Short description" />
    </div>
    <div class="form-row">
      <label>Link URL</label>
      <input type="text" id="ca-d-url" value="${escapeHtml(editing?.url || "")}" placeholder="https://..." />
    </div>
    <div class="ca-actions">
      <button class="ca-btn-accept" id="ca-d-save">${isEdit ? "Save changes" : "Add document"}</button>
      ${isEdit ? `<button class="ca-btn-delete" id="ca-d-cancel">Cancel</button>` : ""}
    </div>
  `;

  if (isEdit) {
    el("ca-d-cancel").addEventListener("click", () => renderDocumentForm(null));
  }
  const dSaveBtn = el("ca-d-save");
  dSaveBtn.addEventListener("click", async () => {
    const name = el("ca-d-name").value.trim();
    const description = el("ca-d-description").value.trim();
    const url = el("ca-d-url").value.trim();
    if (!name) {
      alert("Please enter the document name.");
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      alert("Please enter a valid link starting with http:// or https://");
      return;
    }
    const payload = {
      subdivisionSlug: activeSlug,
      name,
      description,
      url,
    };
    dSaveBtn.disabled = true;
    try {
      const res = isEdit
        ? await putDocument({ ...payload, id: editing.id, sortOrder: editing.sortOrder })
        : await fetch("/api/admin/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, sortOrder: 9999 }),
          });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert((data && data.error) || "Couldn't save that document. Please try again.");
        dSaveBtn.disabled = false;
        return;
      }
    } catch {
      alert("Couldn't save that document. Check your connection and try again.");
      dSaveBtn.disabled = false;
      return;
    }
    renderDocumentForm(null);
    loadDocuments();
  });
}

// ---------------------------------------------------------------------
  // Leadership — per-subdivision "Meet the Team", shown on that
  // subdivision's Apply page (e.g. OCD-01/02/03). Not available for SRT
  // (no tab is rendered for it — see renderSubContent).
  // ---------------------------------------------------------------------
  const LEADERSHIP_MAX_SLOTS = { teu: 3, ocd: 3, rtd: 3, nred: 1 };

  async function renderLeadershipPanel() {
    const panel = el("ca-panel");
    const maxSlots = LEADERSHIP_MAX_SLOTS[activeSlug];
    if (!maxSlots) {
      panel.innerHTML = `<div class="panel"><p class="ca-muted">This subdivision doesn't have a leadership directory.</p></div>`;
      return;
    }
    panel.innerHTML = `
      <div class="panel">
        <p class="ca-section-title">${subInfo(activeSlug).short} Command Staff</p>
        <p class="ca-muted">Shown on the ${subInfo(activeSlug).short} Apply page as ${subInfo(activeSlug).short}-01${maxSlots > 1 ? `, -02, up to -0${maxSlots}` : ""}. Leave a slot's name blank to hide it.</p>
        <div id="ca-leadership-grid" class="ca-leadership-grid">Loading…</div>
      </div>
    `;
    try {
      const res = await fetch(`/api/admin/leadership?div=${encodeURIComponent(activeSlug)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("request failed");
      const data = await res.json();
      renderLeadershipSlots(data.leadership || [], maxSlots);
    } catch {
      el("ca-leadership-grid").innerHTML = `<p class="ca-muted">Couldn't load. Try refreshing.</p>`;
    }
  }

  function renderLeadershipSlots(rows, maxSlots) {
    const grid = el("ca-leadership-grid");
    const bySlot = new Map(rows.map((r) => [r.slot_number, r]));
    const cards = [];
    for (let slot = 1; slot <= maxSlots; slot++) {
      const r = bySlot.get(slot) || {};
      cards.push(`
        <div class="ca-question-form" data-slot="${slot}">
          <h4>${subInfo(activeSlug).short}-0${slot}</h4>
          <div class="form-row">
            <label>Character Name</label>
            <input type="text" class="ca-ld-name" value="${escapeHtml(r.character_name)}" maxlength="100" />
          </div>
          <div class="form-row">
            <label>Rank / Title</label>
            <input type="text" class="ca-ld-rank" value="${escapeHtml(r.rank_title)}" maxlength="100" />
          </div>
          <div class="form-row">
            <label>Bio</label>
            <textarea class="ca-ld-bio" maxlength="1000" rows="2">${escapeHtml(r.bio)}</textarea>
          </div>
          <div class="form-row">
            <label>Photo URL</label>
            <input type="text" class="ca-ld-photo" value="${escapeHtml(r.photo_url)}" maxlength="500" placeholder="https://…" />
          </div>
          <div class="ca-actions">
            <button class="ca-btn-accept ca-ld-save">Save ${subInfo(activeSlug).short}-0${slot}</button>
            <span class="ca-ld-status ca-muted"></span>
          </div>
        </div>
      `);
    }
    grid.innerHTML = cards.join("");
    grid.querySelectorAll("[data-slot]").forEach((card) => {
      const slot = Number(card.dataset.slot);
      card.querySelector(".ca-ld-save").addEventListener("click", async () => {
        const statusEl = card.querySelector(".ca-ld-status");
        statusEl.textContent = "Saving…";
        const payload = {
          subdivisionSlug: activeSlug,
          slotNumber: slot,
          characterName: card.querySelector(".ca-ld-name").value.trim(),
          rankTitle: card.querySelector(".ca-ld-rank").value.trim(),
          bio: card.querySelector(".ca-ld-bio").value.trim(),
          photoUrl: card.querySelector(".ca-ld-photo").value.trim(),
        };
        try {
          const res = await fetch("/api/admin/leadership", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await res.json().catch(() => null);
          statusEl.textContent = res.ok && data && data.ok ? "Saved." : (data && data.error) || "Failed to save.";
        } catch {
          statusEl.textContent = "Failed to save. Check your connection.";
        }
        setTimeout(() => (statusEl.textContent = ""), 3000);
      });
    });
  }

// ---------------------------------------------------------------------
  // Deputy Movement — department-wide copy-paste generator + templates
  // ---------------------------------------------------------------------
  // `scope` is null for the department-wide "Deputy Movement" tab, or a
  // subdivision slug for that subdivision's own "Movement Templates" tab
  // (Command Access -> that subdivision -> Movement Templates). Both
  // reuse the exact same Generate/Customize UI — the only difference is
  // which templates the API returns and which get created.
  function renderMovementTab(container, scope) {
    const key = scope || "global";
    if (!movementInnerTabByScope[key]) movementInnerTabByScope[key] = "generate";
    container.innerHTML = `
      <div class="ca-inner-tabs" id="ca-movement-tabs">
        <button type="button" class="ca-inner-tab-btn" data-tab="generate">Generate</button>
        <button type="button" class="ca-inner-tab-btn" data-tab="customize">Customize Templates</button>
      </div>
      <div id="ca-movement-panel"></div>
    `;
    container.querySelectorAll("#ca-movement-tabs button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === movementInnerTabByScope[key]);
      btn.addEventListener("click", () => {
        movementInnerTabByScope[key] = btn.dataset.tab;
        renderMovementTab(container, scope);
      });
    });
    if (movementInnerTabByScope[key] === "generate") {
      renderMovementGenerate(scope);
    } else {
      renderMovementCustomize(scope);
    }
  }

  function todayAmerican() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);
    return `${mm}/${dd}/${yy}`;
  }

  async function fetchMovementTemplates(scope, force) {
    const key = scope || "global";
    if (movementTemplatesCacheByScope[key] && !force) return movementTemplatesCacheByScope[key];
    try {
      const qs = scope ? `?div=${encodeURIComponent(scope)}` : "";
      const res = await fetch(`/api/admin/movement-templates${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error("request failed");
      const data = await res.json();
      movementTemplatesCacheByScope[key] = data.templates || [];
    } catch {
      movementTemplatesCacheByScope[key] = [];
    }
    return movementTemplatesCacheByScope[key];
  }

  async function renderMovementGenerate(scope) {
    const key = scope || "global";
    const panel = el("ca-movement-panel");
    const approved = movementApprovedByScope[key];
    panel.innerHTML = `
      <div class="panel">
        <p class="ca-muted">Add the deputy's Discord ID and a date, add any extra text if needed, then copy whichever message applies straight into the movements channel.</p>
        <div class="form-row">
          <label for="ca-mv-discord-id">Discord ID(s)</label>
          <p class="ca-muted" style="margin:0 0 0.5rem;">Add one or more deputies' Discord IDs — each one gets its own line in the messages below, so you can process several people at once with the same movement.</p>
          <div class="ca-movement-row" style="margin-bottom:0.35rem;">
            <input type="text" id="ca-mv-discord-id" placeholder="e.g. 123456789012345678" style="flex:1;min-width:220px;" />
            <button type="button" class="ca-btn-accept" id="ca-mv-discord-add">Add Discord ID</button>
          </div>
          <div id="ca-mv-discord-list" class="ca-mv-chip-list"></div>
        </div>
        <div class="form-row">
          <label for="ca-mv-date">Date</label>
          <input type="text" id="ca-mv-date" value="${todayAmerican()}" placeholder="MM/DD/YY" />
        </div>
        <div class="form-row">
          <label for="ca-mv-notes">Additional text (optional)</label>
          <input type="text" id="ca-mv-notes" placeholder="e.g. reason, notes, extra context to include in the message" />
        </div>
        <div class="form-row">
          <label>Approved By</label>
          <p class="ca-muted" style="margin:0 0 0.5rem;">Enter the ID of whoever is approving this — either a person's Discord ID or a role ID — and pick which one it is, then add it to the messages below.</p>
          <div class="ca-movement-row" style="margin-bottom:0.35rem;">
            <input type="text" id="ca-mv-approved-id" placeholder="e.g. 123456789012345678" style="flex:1;min-width:220px;" />
            <select id="ca-mv-approved-type">
              <option value="person">Person</option>
              <option value="role">Role</option>
            </select>
            <button type="button" class="ca-btn-accept" id="ca-mv-approved-add">Add Approved By</button>
            ${approved ? `<button type="button" class="ca-btn-delete" id="ca-mv-approved-clear">Clear</button>` : ""}
          </div>
          <p class="ca-muted" id="ca-mv-approved-status">${approved ? `Currently added: ${escapeHtml(approved.mention)}` : "Not added yet — messages below won't include an Approved By line until you add one."}</p>
        </div>
        <div id="ca-mv-templates">Loading…</div>
      </div>
    `;
    el("ca-mv-date").addEventListener("input", () => renderMovementResults(scope));
    el("ca-mv-notes").addEventListener("input", () => renderMovementResults(scope));
    el("ca-mv-discord-add").addEventListener("click", () => addMovementDiscordId(scope));
    el("ca-mv-discord-id").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addMovementDiscordId(scope);
      }
    });
    el("ca-mv-approved-add").addEventListener("click", () => {
      const id = el("ca-mv-approved-id").value.trim();
      const type = el("ca-mv-approved-type").value;
      if (!/^\d{5,25}$/.test(id)) {
        alert("Enter a valid numeric Discord ID for the approver (person or role).");
        return;
      }
      movementApprovedByScope[key] = { mention: type === "role" ? `<@&${id}>` : `<@${id}>` };
      updateApprovedByUI(scope);
      renderMovementResults(scope);
    });
    updateApprovedByUI(scope);
    updateDiscordIdsUI(scope);
    await renderMovementResults(scope);
  }

  // Adds whatever's in the Discord ID field to this scope's stacked list
  // (skipping duplicates), clears the field for the next entry, and
  // refreshes the chip list + generated messages — without rebuilding
  // the whole Generate panel (which would wipe Date/Notes/Approved By).
  function addMovementDiscordId(scope) {
    const key = scope || "global";
    const input = el("ca-mv-discord-id");
    const id = input.value.trim();
    if (!/^\d{5,25}$/.test(id)) {
      alert("Enter a valid numeric Discord ID.");
      return;
    }
    if (!movementDiscordIdsByScope[key]) movementDiscordIdsByScope[key] = [];
    if (!movementDiscordIdsByScope[key].includes(id)) {
      movementDiscordIdsByScope[key].push(id);
    }
    input.value = "";
    input.focus();
    updateDiscordIdsUI(scope);
    renderMovementResults(scope);
  }
  function removeMovementDiscordId(scope, id) {
    const key = scope || "global";
    movementDiscordIdsByScope[key] = (movementDiscordIdsByScope[key] || []).filter((x) => x !== id);
    updateDiscordIdsUI(scope);
    renderMovementResults(scope);
  }
  // Updates just the stacked-Discord-ID chip list, without rebuilding
  // the whole Generate panel.
  function updateDiscordIdsUI(scope) {
    const key = scope || "global";
    const ids = movementDiscordIdsByScope[key] || [];
    const list = el("ca-mv-discord-list");
    if (!list) return;
    list.innerHTML = ids.length
      ? ids
          .map(
            (id) => `
        <span class="ca-id-chip">
          ${escapeHtml(id)}
          <button type="button" class="ca-chip-remove" data-remove-discord-id="${escapeHtml(id)}" aria-label="Remove ${escapeHtml(id)}">&times;</button>
        </span>
      `
          )
          .join("")
      : `<p class="ca-muted" style="margin:0;">No Discord IDs added yet — messages below won't have anyone to ping until you add at least one.</p>`;
    list.querySelectorAll("[data-remove-discord-id]").forEach((btn) => {
      btn.addEventListener("click", () => removeMovementDiscordId(scope, btn.dataset.removeDiscordId));
    });
  }

  // Updates just the Approved By status line + Clear button, without
  // rebuilding the whole Generate panel (which would wipe whatever the
  // user already typed into the Discord ID / Date / Notes fields).
  function updateApprovedByUI(scope) {
    const key = scope || "global";
    const approved = movementApprovedByScope[key];
    const status = el("ca-mv-approved-status");
    if (status) {
      status.textContent = approved
        ? `Currently added: ${approved.mention}`
        : "Not added yet — messages below won't include an Approved By line until you add one.";
    }
    let clearBtn = el("ca-mv-approved-clear");
    const row = el("ca-mv-approved-add")?.parentElement;
    if (approved && !clearBtn && row) {
      clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "ca-btn-delete";
      clearBtn.id = "ca-mv-approved-clear";
      clearBtn.textContent = "Clear";
      row.appendChild(clearBtn);
    }
    if (!approved && clearBtn) {
      clearBtn.remove();
      clearBtn = null;
    }
    if (clearBtn) {
      clearBtn.onclick = () => {
        delete movementApprovedByScope[key];
        updateApprovedByUI(scope);
        renderMovementResults(scope);
      };
    }
  }

  async function renderMovementResults(scope) {
    const box = el("ca-mv-templates");
    if (!box) return;
    const key = scope || "global";
    const templates = await fetchMovementTemplates(scope);
    const discordIds = movementDiscordIdsByScope[key] || [];
    const date = el("ca-mv-date")?.value.trim() || todayAmerican();
    const notes = el("ca-mv-notes")?.value.trim();
    const approved = movementApprovedByScope[key];
    if (!templates.length) {
      box.innerHTML = `<p class="ca-muted">No templates yet — add one under "Customize Templates".</p>`;
      return;
    }
    box.innerHTML = templates
      .map((t) => {
        // Each entry in t.roleIds is either a numeric Discord role ID
        // (pinged as <@&id>) or a plain word/phrase (included as-is) —
        // see renderMovementTemplateForm. Fixed segment order after
        // that: the movement itself, then who approved it, then any
        // one-off notes, then the date — the date always goes last,
        // notes always sit right before it. Every stacked Discord ID
        // gets its own line, in the order they were added, so several
        // deputies can be moved with one copy-paste.
        const pings = t.roleIds.map((r) => (/^\d{5,25}$/.test(r) ? `<@&${r}>` : r));
        const movementPart = pings.join(" & ");
        const lines = discordIds.map((discordId) => {
          const segments = [`<@${discordId}> → ${movementPart}`];
          if (approved) segments.push(`Approved by: ${approved.mention}`);
          if (notes) segments.push(notes);
          segments.push(date);
          return segments.join(" | ");
        });
        const text = lines.join("\n");
        const scopeTag = t.subdivisionSlug ? ` <span class="ca-question-meta">(${escapeHtml(t.subdivisionSlug.toUpperCase())})</span>` : "";
        return `
          <div class="ca-movement-row">
            <div class="ca-movement-name">${escapeHtml(t.name)}${scopeTag}</div>
            <textarea class="ca-movement-output" readonly rows="${Math.max(1, lines.length)}" placeholder="Add a Discord ID above">${escapeHtml(text)}</textarea>
            <button type="button" class="ca-btn-accept" data-copy-for="${t.id}" ${discordIds.length ? "" : "disabled"}>Copy</button>
          </div>
        `;
      })
      .join("");
    box.querySelectorAll("[data-copy-for]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = btn.closest(".ca-movement-row");
        const value = row.querySelector(".ca-movement-output").value;
        if (!value) return;
        try {
          await navigator.clipboard.writeText(value);
          const original = btn.textContent;
          btn.textContent = "Copied!";
          setTimeout(() => (btn.textContent = original), 1200);
        } catch {
          alert("Couldn't copy automatically — select the text in the box and copy it manually.");
        }
      });
    });
  }

  async function renderMovementCustomize(scope) {
    const panel = el("ca-movement-panel");
    panel.innerHTML = `
      <div class="panel">
        <p class="ca-muted">${
          scope
            ? `Templates you add here only show up on ${escapeHtml(subInfo(scope).short)}'s own tabs, alongside the department-wide templates below. Anyone with ${escapeHtml(subInfo(scope).short)} command access can manage these.`
            : "Add, edit, or remove the department-wide templates available on the Generate tab. Each template pings one or more Discord roles — anyone with the Command Login role can manage these."
        }</p>
        <div id="ca-mv-template-list">Loading…</div>
        <div class="ca-question-form" id="ca-mv-template-form"></div>
      </div>
    `;
    renderMovementTemplateForm(null, scope);
    await loadMovementTemplateList(scope);
  }

  async function loadMovementTemplateList(scope) {
    const list = el("ca-mv-template-list");
    try {
      const templates = await fetchMovementTemplates(scope, true);
      if (!templates.length) {
        list.innerHTML = `<p class="ca-muted">No templates yet.</p>`;
        return;
      }
      list.innerHTML = templates
        .map(
          (t) => `
          <div class="ca-question-row">
            <div>
              <strong>${escapeHtml(t.name)}</strong>
              <span class="ca-option-chip">${t.subdivisionSlug ? escapeHtml(t.subdivisionSlug.toUpperCase()) : "Department-wide"}</span>
              <div class="ca-question-meta">${t.roleIds.map((r) => escapeHtml(r)).join(", ")}</div>
            </div>
            <div class="ca-actions">
              <button class="ca-btn-delete" data-mvaction="edit" data-mvid="${t.id}">Edit</button>
              <button class="ca-btn-reject" data-mvaction="delete" data-mvid="${t.id}">Delete</button>
            </div>
          </div>
        `
        )
        .join("");
      list.querySelectorAll("[data-mvaction]").forEach((btn) => {
        btn.addEventListener("click", () => handleMovementTemplateAction(btn.dataset.mvaction, templates, btn.dataset.mvid, scope));
      });
    } catch {
      list.innerHTML = `<p class="ca-muted">Couldn't load templates. Try refreshing.</p>`;
    }
  }

  async function handleMovementTemplateAction(action, templates, id, scope) {
    const t = templates.find((x) => String(x.id) === String(id));
    if (!t) return;
    if (action === "delete") {
      if (!confirm(`Delete template "${t.name}"? This can't be undone.`)) return;
      const res = await fetch(`/api/admin/movement-templates?id=${t.id}${scope ? `&div=${encodeURIComponent(scope)}` : ""}`, { method: "DELETE" });
      if (!res.ok) {
        alert("Couldn't delete that template. Please try again.");
        return;
      }
      movementTemplatesCacheByScope = {};
      await loadMovementTemplateList(scope);
      return;
    }
    if (action === "edit") {
      renderMovementTemplateForm(t, scope);
    }
  }

  function renderMovementTemplateForm(editing, scope) {
    const formBox = el("ca-mv-template-form");
    const isEdit = !!editing;
    formBox.innerHTML = `
      <h4>${isEdit ? "Edit template" : "Add a template"}</h4>
      <div class="form-row">
        <label>Template name</label>
        <input type="text" id="ca-mv-t-name" value="${escapeHtml(editing?.name || "")}" placeholder="e.g. Suspending" />
      </div>
      <div class="form-row">
        <label>Role ID(s) or words to include</label>
        <input type="text" id="ca-mv-t-roles" value="${escapeHtml((editing?.roleIds || []).join(", "))}" placeholder="e.g. 1283145857176440923, is being suspended pending investigation, 1285706620374093854" />
        <p class="ca-muted" style="margin-top:0.35rem;">Separate entries with commas. Numeric Discord role IDs get pinged (In Discord, enable Developer Mode, then right-click a role → Copy Role ID) — anything else is included as plain text, in the order you list it.</p>
      </div>
      <div class="ca-actions">
        <button class="ca-btn-accept" id="ca-mv-t-save">${isEdit ? "Save changes" : "Add template"}</button>
        ${isEdit ? `<button class="ca-btn-delete" id="ca-mv-t-cancel">Cancel</button>` : ""}
      </div>
    `;
    if (isEdit) {
      el("ca-mv-t-cancel").addEventListener("click", () => renderMovementTemplateForm(null, scope));
    }
    const mvSaveBtn = el("ca-mv-t-save");
    mvSaveBtn.addEventListener("click", async () => {
      const name = el("ca-mv-t-name").value.trim();
      const roleIds = el("ca-mv-t-roles")
        .value.split(",")
        .map((r) => r.trim())
        .filter(Boolean);
      if (!name) {
        alert("Please enter a template name.");
        return;
      }
      if (!roleIds.length) {
        alert("Enter at least one role ID or word, separated by commas.");
        return;
      }
      const payload = { name, roleIds };
      if (scope) payload.subdivisionSlug = scope;
      mvSaveBtn.disabled = true;
      try {
        const res = await fetch("/api/admin/movement-templates", {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isEdit ? { ...payload, id: editing.id, sortOrder: editing.sortOrder } : { ...payload, sortOrder: 9999 }
          ),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          alert((data && data.error) || "Couldn't save that template. Please try again.");
          mvSaveBtn.disabled = false;
          return;
        }
      } catch {
        alert("Couldn't save that template. Check your connection and try again.");
        mvSaveBtn.disabled = false;
        return;
      }
      movementTemplatesCacheByScope = {};
      renderMovementTemplateForm(null, scope);
      await loadMovementTemplateList(scope);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
