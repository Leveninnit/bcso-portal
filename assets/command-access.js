(function () {
  const QUESTION_TYPE_LABELS = {
    text: "Short text",
    paragraph: "Paragraph",
    dropdown: "Dropdown",
  };

  let mySubdivisions = [];
  let activeSlug = null;
  let activeFormType = "application"; // "application" | "log"
  let activeInnerTab = "review"; // "review" | "customize"
  let questionLabelCache = {}; // `${slug}:${type}` -> { [questionId]: label }

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

  async function init() {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    if (error) {
      const messages = {
        no_access: "You're logged into Discord, but you don't hold the Command Login role, so you can't access this dashboard.",
        missing_code: "Login didn't complete — please try again.",
        login_failed: "Something went wrong logging you in. Please try again in a moment.",
        access_denied: "Discord login was cancelled.",
      };
      const box = el("ca-error");
      box.textContent = messages[error] || `Login error: ${error}`;
      box.style.display = "block";
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
    el("ca-whoami").textContent = `Logged in as ${me.username}`;
    mySubdivisions = me.subdivisions || [];

    if (!mySubdivisions.length) {
      el("ca-no-subs").style.display = "block";
      return;
    }

    renderSubTabs();
    activeSlug = mySubdivisions[0];
    renderSubContent();
  }

  function renderSubTabs() {
    const wrap = el("ca-sub-tabs");
    wrap.innerHTML = mySubdivisions
      .map((slug) => {
        const info = subInfo(slug);
        return `<button type="button" class="ca-tab-btn" data-slug="${slug}">${escapeHtml(info.short)}</button>`;
      })
      .join("");
    wrap.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeSlug = btn.dataset.slug;
        activeInnerTab = "review";
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
    const info = subInfo(activeSlug);
    const showApplications = !info.logOnly;
    const container = el("ca-sub-content");

    const innerTabsHtml = `
      <div class="ca-inner-tabs" id="ca-form-type-tabs">
        ${showApplications ? `<button type="button" class="ca-inner-tab-btn" data-type="application">Applications</button>` : ""}
        <button type="button" class="ca-inner-tab-btn" data-type="log">Activity Logs</button>
      </div>
      <div class="ca-inner-tabs" id="ca-inner-tabs">
        <button type="button" class="ca-inner-tab-btn" data-tab="review">Pending Review</button>
        <button type="button" class="ca-inner-tab-btn" data-tab="customize">Customize Questions</button>
      </div>
      <div id="ca-panel"></div>
    `;
    container.innerHTML = innerTabsHtml;

    if (!showApplications) activeFormType = "log";

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
    } else {
      renderCustomizePanel();
    }
  }

  // ---------------------------------------------------------------------
  // Pending review
  // ---------------------------------------------------------------------
  async function renderReviewPanel() {
    const panel = el("ca-panel");
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
    select.addEventListener("change", () => loadSubmissions(select.value));
    await loadSubmissions("pending");
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

  async function loadSubmissions(status) {
    const list = el("ca-submission-list");
    if (!list) return;
    list.innerHTML = "Loading…";
    const slug = activeSlug;
    const type = activeFormType;
    try {
      const url = `/api/admin/submissions?div=${encodeURIComponent(slug)}&type=${type}${status ? `&status=${status}` : ""}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("request failed");
      const data = await res.json();
      const labels = await loadQuestionLabels(slug, type);
      if (!data.submissions || !data.submissions.length) {
        list.innerHTML = `<p class="ca-muted">Nothing here.</p>`;
        return;
      }
      list.innerHTML = data.submissions.map((s) => renderSubmissionCard(s, labels)).join("");
      list.querySelectorAll("[data-action]").forEach((btn) => {
        btn.addEventListener("click", () => handleSubmissionAction(btn.dataset.action, btn.dataset.id, slug, status));
      });
    } catch {
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
            ["Hours on duty", core.hoursOnDuty],
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
    return `
      <div class="ca-submission-card">
        <strong>${escapeHtml(s.characterName)}</strong>
        <span class="ca-status ${s.status}">${s.status}</span>
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
    if (action === "delete") {
      if (!confirm("Delete this submission permanently? This can't be undone.")) return;
      await fetch(`/api/admin/submissions?id=${id}&div=${encodeURIComponent(slug)}`, { method: "DELETE" });
    } else {
      await fetch("/api/admin/submissions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: Number(id), subdivisionSlug: slug, status: action === "accept" ? "accepted" : "rejected" }),
      });
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
        <p class="ca-muted">These extra questions appear underneath the standard fields (Discord ID, Character Name, Badge, Rank) on this subdivision's ${activeFormType === "application" ? "application" : "activity log"} form.</p>
        <div id="ca-question-list">Loading…</div>
        <div class="ca-question-form" id="ca-add-question-form"></div>
      </div>
    `;
    renderQuestionForm(null);
    await loadQuestions();
  }

  async function loadQuestions() {
    const list = el("ca-question-list");
    const slug = activeSlug;
    const type = activeFormType;
    try {
      const res = await fetch(`/api/admin/questions?div=${encodeURIComponent(slug)}&type=${type}`, { cache: "no-store" });
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
      await fetch(`/api/admin/questions?id=${q.id}&div=${encodeURIComponent(activeSlug)}`, { method: "DELETE" });
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
    el("ca-q-save").addEventListener("click", async () => {
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
      if (isEdit) {
        await putQuestion({ ...payload, id: editing.id, sortOrder: editing.sortOrder });
      } else {
        await fetch("/api/admin/questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, sortOrder: 9999 }),
        });
      }
      renderQuestionForm(null);
      loadQuestions();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
