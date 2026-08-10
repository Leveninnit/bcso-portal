(function () {
  function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }
  function findSubdivision(slug) {
    return (window.SUBDIVISIONS || []).find((s) => s.slug === slug);
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

  // Extra per-subdivision questions configured by command staff on the
  // Command Access dashboard — rendered beneath the fixed fields above.
  // See assets/command-access.js for the customizer that manages these.
  function renderCustomQuestionField(q) {
    const requiredAttr = q.required ? "required" : "";
    const requiredMark = q.required ? " *" : "";
    const labelHtml = `<label for="cq-${q.id}">${escapeHtml(q.label)}${requiredMark}</label>`;
    if (q.questionType === "paragraph") {
      return `<div class="form-row">${labelHtml}<textarea id="cq-${q.id}" data-qid="${q.id}" ${requiredAttr}></textarea></div>`;
    }
    if (q.questionType === "dropdown") {
      const options = (q.options || [])
        .map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`)
        .join("");
      return `<div class="form-row">${labelHtml}<select id="cq-${q.id}" data-qid="${q.id}" ${requiredAttr}><option value="">Select…</option>${options}</select></div>`;
    }
    return `<div class="form-row">${labelHtml}<input type="text" id="cq-${q.id}" data-qid="${q.id}" ${requiredAttr} /></div>`;
  }
  // If command staff have configured Rank options for this subdivision
  // (Command Access -> Activity Logs -> Ranks), swap the free-text Rank
  // field for a dropdown built from those options. Otherwise the
  // original text field stays exactly as it always has.
  async function setupRankField(slug) {
    const textInput = document.getElementById("rank");
    const select = document.getElementById("rank-select");
    if (!slug || slug === "general" || slug === "rtd") return; // RTD uses its own dedicated rank dropdown
    try {
      const res = await fetch(`/api/rank-options?div=${encodeURIComponent(slug)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      const options = data.options || [];
      if (!options.length) return;
      select.innerHTML =
        `<option value="">Select…</option>` +
        options.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("");
      textInput.style.display = "none";
      textInput.required = false;
      select.style.display = "";
      select.required = true;
    } catch {
      // Custom rank options are an enhancement — if they fail to load,
      // just keep the original free-text field.
    }
  }

  async function renderCustomQuestions(slug) {
    const container = document.getElementById("custom-questions");
    if (!container) return;
    container.innerHTML = "";
    if (!slug || slug === "general") return;
    try {
      const res = await fetch(`/api/questions?div=${encodeURIComponent(slug)}&type=log`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      const questions = data.questions || [];
      if (!questions.length) return;
      container.innerHTML = questions.map(renderCustomQuestionField).join("");
    } catch {
      // Custom questions are optional extras — if they fail to load, just
      // skip them rather than blocking the whole form.
    }
  }

  // Command staff can reword the fixed fields (Character Name, Discord
  // ID, Badge Number, Rank, "Hours on Duty", "Shift Summary") per
  // subdivision from the Command Access dashboard's "Original Fields"
  // section. This fetches any overrides and swaps in the custom
  // wording — if nothing's overridden, or the request fails, the
  // fields just keep the wording already in the HTML.
  async function applyFieldLabelOverrides(slug) {
    if (!slug || slug === "general") return;
    try {
      const res = await fetch(`/api/field-labels?div=${encodeURIComponent(slug)}&type=log`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      const labels = data.labels || {};
      Object.keys(labels).forEach((fieldKey) => {
        const label = document.querySelector(`label[for="${fieldKey}"]`);
        if (label) label.textContent = `${labels[fieldKey]} *`;
      });
    } catch {
      // Label overrides are a convenience — ignore failures quietly.
    }
  }

  function collectCustomAnswers() {
    const answers = {};
    document.querySelectorAll("#custom-questions [data-qid]").forEach((el) => {
      const val = typeof el.value === "string" ? el.value.trim() : el.value;
      if (val) answers[el.dataset.qid] = val;
    });
    return answers;
  }

  // ------------------------------------------------------------------
  // RTD-only branching fields (mirrors the "BCSO | RTD | Activation
  // Form" Google Form: Role -> Assist / Host / Supervise sections).
  // ------------------------------------------------------------------
  function isRtdSlug(slug) {
    return slug === "rtd";
  }

  function setRtdMode(isRtd) {
    document.getElementById("rtd-fields").style.display = isRtd ? "" : "none";
    document.getElementById("generic-rank-row").style.display = isRtd ? "none" : "";
    const genericRank = document.getElementById("rank");
    const rtdRank = document.getElementById("rtdRank");
    const rtdRole = document.getElementById("rtdRole");
    genericRank.required = !isRtd;
    rtdRank.required = isRtd;
    rtdRole.required = isRtd;
    if (isRtd) {
      updateRtdBranch();
    }
  }

  function updateRtdBranch() {
    const role = document.getElementById("rtdRole").value; // "assist" | "host" | "supervise" | ""
    const panels = { assist: "rtd-assist", host: "rtd-host", supervise: "rtd-supervise" };
    Object.entries(panels).forEach(([key, id]) => {
      const el = document.getElementById(id);
      const active = role === key;
      el.style.display = active ? "" : "none";
      // Only require fields inside the currently-active branch. Cadet
      // #2-4 stay optional even inside the Host branch (they mirror
      // the Form's "(If Present)" questions).
      el.querySelectorAll("input, select").forEach((field) => {
        const isOptionalField = /^cadet[234]/.test(field.id) || /Notes$/.test(field.id);
        field.required = active && !isOptionalField;
      });
    });
  }

  function collectRtdFields() {
    const val = (id) => (document.getElementById(id).value || "").trim();
    const role = val("rtdRole");
    const cadet = (n) => ({
      badge: val(`cadet${n}Badge`),
      discordId: val(`cadet${n}Discord`),
      result: val(`cadet${n}Result`),
      notes: val(`cadet${n}Notes`),
    });
    return {
      role,
      assistType: role === "assist" ? val("assistType") : "",
      ftoBadge: role === "assist" ? val("ftoBadge") : "",
      ftoDiscordId: role === "assist" ? val("ftoDiscordId") : "",
      hostType: role === "host" ? val("hostType") : "",
      cadets: role === "host" ? [1, 2, 3, 4].map(cadet) : [],
      superviseType: role === "supervise" ? val("superviseType") : "",
      supervisedBadge: role === "supervise" ? val("supervisedBadge") : "",
      supervisedDiscordId: role === "supervise" ? val("supervisedDiscordId") : "",
    };
  }

  function initPage() {
    const slug = getQueryParam("div");
    const sub = findSubdivision(slug);
    const titleEl = document.getElementById("sub-title");
    const descEl = document.getElementById("sub-description");
    const crumbEl = document.getElementById("crumb-sub");
    if (sub) {
      titleEl.textContent = sub.name + " Activity Log";
      descEl.textContent = "Log your shift activity for the " + sub.name + ".";
      crumbEl.textContent = sub.name;
      document.title = sub.name + " Activity Log — BCSO";
      document.getElementById("subdivisionSlug").value = sub.slug;
      document.getElementById("subdivisionName").value = sub.name;
    } else {
      titleEl.textContent = "General Activity Log";
      descEl.textContent =
        "No specific subdivision was selected, so this will be logged as a general activity entry.";
      crumbEl.textContent = "General";
      document.getElementById("subdivisionSlug").value = "general";
      document.getElementById("subdivisionName").value = "General";
    }
    document.getElementById("formLoadedAt").value = Date.now().toString();
    const slugValue = document.getElementById("subdivisionSlug").value;
    renderCustomQuestions(slugValue);
    applyFieldLabelOverrides(slugValue);
    setupRankField(slugValue);

    setRtdMode(isRtdSlug(slugValue));
    document.getElementById("rtdRole").addEventListener("change", updateRtdBranch);
  }

  function showAlert(el, message) {
    if (message) el.textContent = message;
    el.classList.add("show");
  }
  function hideAlert(el) {
    el.classList.remove("show");
  }

  // Auto-fill character name / badge / rank from the Master Roster when
  // the Discord ID field loses focus. This is a convenience only — any
  // failure (roster not configured, no match, network error) just
  // leaves the fields as-is for manual entry.
  async function handleDiscordIdBlur() {
    const discordId = document.getElementById("discordId").value.trim();
    const note = document.getElementById("autofill-note");
    note.style.display = "none";
    if (!discordId) return;
    try {
      const res = await fetch("/api/roster-lookup?discordId=" + encodeURIComponent(discordId));
      const data = await res.json().catch(() => ({}));
      if (data.found) {
        if (data.name) document.getElementById("characterName").value = data.name;
        if (data.badgeNumber) document.getElementById("badgeNumber").value = data.badgeNumber;
        if (data.rank) {
          const slug = document.getElementById("subdivisionSlug").value;
          if (isRtdSlug(slug)) {
            const rtdRank = document.getElementById("rtdRank");
            const match = Array.from(rtdRank.options).find(
              (o) => o.value.toLowerCase() === data.rank.toLowerCase()
            );
            if (match) rtdRank.value = match.value;
          } else {
            document.getElementById("rank").value = data.rank;
          }
        }
        note.textContent = "✓ Auto-filled from Master Roster";
        note.style.color = "var(--success)";
        note.style.display = "inline";
      }
    } catch {
      // Roster lookup is a convenience — ignore failures quietly.
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const form = document.getElementById("log-form");
    const submitBtn = document.getElementById("submit-btn");
    const errorEl = document.getElementById("form-error");
    const successEl = document.getElementById("form-success");
    hideAlert(errorEl);
    hideAlert(successEl);

    // Honeypot: if this hidden field got filled in, silently treat as bot
    // and pretend success, but never actually send it anywhere.
    const honeypot = document.getElementById("website").value;

    const slug = document.getElementById("subdivisionSlug").value;
    const rtd = isRtdSlug(slug);
    const rankSelect = document.getElementById("rank-select");
    const usingRankDropdown = rankSelect && rankSelect.style.display !== "none";
    const rank = rtd
      ? document.getElementById("rtdRank").value.trim()
      : usingRankDropdown
      ? rankSelect.value.trim()
      : document.getElementById("rank").value.trim();

    const payload = {
      characterName: document.getElementById("characterName").value.trim(),
      discordId: document.getElementById("discordId").value.trim(),
      badgeNumber: document.getElementById("badgeNumber").value.trim(),
      rank,
      durationHours: document.getElementById("hoursOnDuty").value.trim(),
      durationMinutes: document.getElementById("durationMinutes").value.trim(),
      durationSeconds: document.getElementById("durationSeconds").value.trim(),
      summary: document.getElementById("summary").value.trim(),
      subdivisionSlug: slug,
      subdivisionName: document.getElementById("subdivisionName").value,
      formLoadedAt: document.getElementById("formLoadedAt").value,
      website: honeypot,
      answers: collectCustomAnswers(),
    };
    if (rtd) {
      payload.rtd = collectRtdFields();
    }

    if (honeypot) {
      // Pretend it worked so bots don't learn anything, but don't call the API.
      form.reset();
      showAlert(successEl);
      return;
    }

    if (rtd && !payload.rtd.role) {
      showAlert(errorEl, "Please select your role during this activation.");
      return;
    }

    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.innerHTML = '<span class="spinner"></span> Submitting…';
    try {
      const res = await fetch("/api/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showAlert(errorEl, data.error || "Something went wrong. Please try again.");
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
        return;
      }
      form.reset();
      setRtdMode(rtd);
      showAlert(successEl);
      submitBtn.textContent = originalText;
    } catch {
      showAlert(errorEl, "Could not reach the server. Please check your connection and try again.");
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initPage();
    document.getElementById("discordId").addEventListener("blur", handleDiscordIdBlur);
    document.getElementById("log-form").addEventListener("submit", handleSubmit);
  });
})();

