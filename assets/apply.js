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
  async function renderCustomQuestions(slug) {
    const container = document.getElementById("custom-questions");
    if (!container) return;
    container.innerHTML = "";
    if (!slug || slug === "general") return;
    try {
      const res = await fetch(`/api/questions?div=${encodeURIComponent(slug)}&type=application`, {
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
  // ID, Badge Number, Rank, "Why do you want to join?", "Relevant
  // experience") per subdivision from the Command Access dashboard's
  // "Original Fields" section. This fetches any overrides and swaps in
  // the custom wording — if nothing's overridden, or the request fails,
  // the fields just keep the wording already in the HTML.
  async function applyFieldLabelOverrides(slug) {
    if (!slug || slug === "general") return;
    try {
      const res = await fetch(`/api/field-labels?div=${encodeURIComponent(slug)}&type=application`, {
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
  // Shows the subdivision's Command Staff directory (e.g. OCD-01/02/03),
  // configured by that subdivision's own command staff on the Command
  // Access dashboard. SRT never has one (no public applications). Hides
  // itself entirely if nothing's been filled in yet.
  async function renderLeadership(slug) {
    const panel = document.getElementById("leadership-panel");
    const grid = document.getElementById("leadership-grid");
    if (!panel || !slug || slug === "general" || slug === "srt") return;
    try {
      const res = await fetch(`/api/leadership?div=${encodeURIComponent(slug)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      const staff = (data.leadership || []).filter((s) => s.character_name);
      if (!staff.length) return;
      const sub = findSubdivision(slug);
      const short = sub ? sub.short : slug.toUpperCase();
      grid.innerHTML = staff
        .map(
          (s) => `
          <div class="leadership-card">
            ${s.photo_url ? `<img src="${escapeHtml(s.photo_url)}" alt="${escapeHtml(s.character_name)}" />` : `<div class="leadership-photo-placeholder">${escapeHtml(short)}-0${s.slot_number}</div>`}
            <div class="leadership-name">${escapeHtml(s.character_name)}</div>
            <div class="leadership-rank">${escapeHtml(s.rank_title || `${short}-0${s.slot_number}`)}</div>
            ${s.bio ? `<div class="leadership-bio">${escapeHtml(s.bio)}</div>` : ""}
          </div>
        `
        )
        .join("");
      panel.style.display = "block";
    } catch {
      // Leadership listing is a nice-to-have — ignore failures quietly.
    }
  }

  function initPage() {
    const slug = getQueryParam("div");
    const sub = findSubdivision(slug);
    const titleEl = document.getElementById("sub-title");
    const descEl = document.getElementById("sub-description");
    const crumbEl = document.getElementById("crumb-sub");
    const reqPanel = document.getElementById("requirements-panel");
    const reqList = document.getElementById("requirements-list");
    if (sub) {
      titleEl.textContent = sub.name + " Application";
      descEl.textContent = sub.description;
      crumbEl.textContent = sub.name;
      document.title = sub.name + " Application — BCSO";
      if (sub.requirements && sub.requirements.length) {
        reqList.innerHTML = sub.requirements.map((r) => `<li>${r}</li>`).join("");
        reqPanel.style.display = "block";
      }
      document.getElementById("subdivisionSlug").value = sub.slug;
      document.getElementById("subdivisionName").value = sub.name;
    } else {
      // No/invalid subdivision in the URL — fall back to a general application.
      titleEl.textContent = "General Application";
      descEl.textContent =
        "No specific subdivision was selected, so this will be submitted as a general application. Command staff will follow up about placement.";
      crumbEl.textContent = "General Application";
      document.getElementById("subdivisionSlug").value = "general";
      document.getElementById("subdivisionName").value = "General Application";
    }
    document.getElementById("formLoadedAt").value = Date.now().toString();
    const slugValue = document.getElementById("subdivisionSlug").value;
    renderCustomQuestions(slugValue);
    applyFieldLabelOverrides(slugValue);
    renderLeadership(slugValue);
  }
  function showAlert(el, message) {
    if (message) el.textContent = message;
    el.classList.add("show");
    if (window.BCSOEffects) {
      if (el.id === "form-success") window.BCSOEffects.playSuccess();
      else if (el.id === "form-error") window.BCSOEffects.playError();
    }
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
    if (note) note.style.display = "none";
    if (!discordId) return;
    try {
      const res = await fetch("/api/roster-lookup?discordId=" + encodeURIComponent(discordId));
      const data = await res.json().catch(() => ({}));
      if (data.found) {
        if (data.name) document.getElementById("characterName").value = data.name;
        if (data.badgeNumber) document.getElementById("badgeNumber").value = data.badgeNumber;
        if (data.rank) document.getElementById("rank").value = data.rank;
        if (note) {
          note.textContent = "✓ Auto-filled from Master Roster";
          note.style.color = "var(--success)";
          note.style.display = "inline";
        }
      }
    } catch {
      // Roster lookup is a convenience — ignore failures quietly.
    }
  }
  async function handleSubmit(e) {
    e.preventDefault();
    const form = document.getElementById("app-form");
    const submitBtn = document.getElementById("submit-btn");
    const errorEl = document.getElementById("form-error");
    const successEl = document.getElementById("form-success");
    hideAlert(errorEl);
    hideAlert(successEl);
    // Honeypot: if this hidden field got filled in, silently treat as bot
    // and pretend success, but never actually send it anywhere.
    const honeypot = document.getElementById("website").value;
    const payload = {
      characterName: document.getElementById("characterName").value.trim(),
      discordId: document.getElementById("discordId").value.trim(),
      badgeNumber: document.getElementById("badgeNumber").value.trim(),
      rank: document.getElementById("rank").value.trim(),
      whyJoin: document.getElementById("whyJoin").value.trim(),
      experience: document.getElementById("experience").value.trim(),
      subdivisionSlug: document.getElementById("subdivisionSlug").value,
      subdivisionName: document.getElementById("subdivisionName").value,
      formLoadedAt: document.getElementById("formLoadedAt").value,
      website: honeypot,
      answers: collectCustomAnswers(),
    };
    if (honeypot) {
      // Pretend it worked so bots don't learn anything, but don't call the API.
      form.reset();
      showAlert(successEl);
      return;
    }
    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.innerHTML = '<span class="spinner"></span> Submitting…';
    try {
      const res = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Something went wrong submitting your application.");
      }
      form.reset();
      showAlert(successEl);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      showAlert(errorEl, err.message || "Something went wrong. Please try again in a moment.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    initPage();
    document.getElementById("discordId").addEventListener("blur", handleDiscordIdBlur);
    document.getElementById("app-form").addEventListener("submit", handleSubmit);
  });
})();
