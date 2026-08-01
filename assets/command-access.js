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
      hoursOnDuty: "Hours on Duty",
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
    hoursOnDuty: '"Hours on Duty" question',
    summary: '"Summary" question',
  };

  let mySubdivisions = [];
  let activeSlug = null;
  let activeFormType = "application"; // "application" | "log"
  let activeInnerTab = "review"; // "review" | "customize"
  let questionLabelCache = {}; // `${slug}:${type}` -> { [questionId]: label }
  let movementInnerTab = "generate"; // "generate" | "customize"
  let movementTemplatesCache = null;

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
    }

    // Deputy Movement is department-wide (anyone with Command Login can
    // use it), so the tabs — and a default tab to land on — always
    // render even if this person has no subdivision command role.
    renderSubTabs();
    activeSlug = mySubdivisions.length ? mySubdivisions[0] : MOVEMENT_TAB_SLUG;
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
      renderMovementTab(container);
      return;
    }

    const info = subInfo(activeSlug);
    const showApplications = !info.logOnly;

    const innerTabsHtml = `
      <div class="ca-inner-tabs" id="ca-form-type-tabs" style="display:${activeInnerTab === "documents" ? "none" : ""};">
        ${showApplications ? `<button type="button" class="ca-inner-tab-btn" data-type="application">Applications</button>` : ""}
        <button type="button" class="ca-inner-tab-btn" data-type="log">Activity Logs</button>
      </div>
      <div class="ca-inner-tabs" id="ca-inner-tabs">
        <button type="button" class="ca-inner-tab-btn" data-tab="review">Pending Review</button>
        <button type="button" class="ca-inner-tab-btn" data-tab="customize">Customize Questions</button>
        <button type="button" class="ca-inner-tab-btn" data-tab="documents">Documents</button>
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
    } else if (activeInnerTab === "customize") {
      renderCustomizePanel();
    } else {
      renderDocumentsPanel();
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
      const data = await res.json();
      const overrides = data.labels || {};
      box.innerHTML = FIELD_KEY_ORDER[type].map((fieldKey) => renderFieldLabelRow(fieldKey, overrides[fieldKey])).join("");
      box.querySelectorAll("[data-flaction]").forEach((btn) => {
        btn.addEventListener("click", () => handleFieldLabelAction(btn.dataset.flaction, btn.dataset.field));
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

  async function handleFieldLabelAction(action, fieldKey) {
    const slug = activeSlug;
    const type = activeFormType;
    if (action === "reset") {
      if (!confirm(`Reset "${FIELD_KEY_DISPLAY[fieldKey]}" back to its default wording?`)) return;
      await fetch(
        `/api/admin/field-labels?div=${encodeURIComponent(slug)}&type=${type}&field=${encodeURIComponent(fieldKey)}`,
        { method: "DELETE" }
      );
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
      await fetch("/api/admin/field-labels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subdivisionSlug: slug, formType: type, fieldKey, label }),
      });
      loadFieldLabels();
    }
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
    await fetch(`/api/admin/documents?id=${d.id}&div=${encodeURIComponent(activeSlug)}`, { method: "DELETE" });
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
  el("ca-d-save").addEventListener("click", async () => {
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
    if (isEdit) {
      await putDocument({ ...payload, id: editing.id, sortOrder: editing.sortOrder });
    } else {
      await fetch("/api/admin/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, sortOrder: 9999 }),
      });
    }
    renderDocumentForm(null);
    loadDocuments();
  });
}

// ---------------------------------------------------------------------
  // Deputy Movement — department-wide copy-paste generator + templates
  // ---------------------------------------------------------------------
  function renderMovementTab(container) {
    container.innerHTML = `
      <div class="ca-inner-tabs" id="ca-movement-tabs">
        <button type="button" class="ca-inner-tab-btn" data-tab="generate">Generate</button>
        <button type="button" class="ca-inner-tab-btn" data-tab="customize">Customize Templates</button>
      </div>
      <div id="ca-movement-panel"></div>
    `;
    container.querySelectorAll("#ca-movement-tabs button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === movementInnerTab);
      btn.addEventListener("click", () => {
        movementInnerTab = btn.dataset.tab;
        renderMovementTab(container);
      });
    });
    if (movementInnerTab === "generate") {
      renderMovementGenerate();
    } else {
      renderMovementCustomize();
    }
  }

  function todayAmerican() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);
    return `${mm}/${dd}/${yy}`;
  }

  async function fetchMovementTemplates(force) {
    if (movementTemplatesCache && !force) return movementTemplatesCache;
    try {
      const res = await fetch("/api/admin/movement-templates", { cache: "no-store" });
      const data = await res.json();
      movementTemplatesCache = data.templates || [];
    } catch {
      movementTemplatesCache = [];
    }
    return movementTemplatesCache;
  }

  async function renderMovementGenerate() {
    const panel = el("ca-movement-panel");
    panel.innerHTML = `
      <div class="panel">
        <p class="ca-muted">Enter the deputy's Discord ID and a date, then copy whichever message applies straight into the movements channel.</p>
        <div class="form-row">
          <label for="ca-mv-discord-id">Discord ID</label>
          <input type="text" id="ca-mv-discord-id" placeholder="e.g. 123456789012345678" />
        </div>
        <div class="form-row">
          <label for="ca-mv-date">Date</label>
          <input type="text" id="ca-mv-date" value="${todayAmerican()}" placeholder="MM/DD/YY" />
        </div>
        <div id="ca-mv-templates">Loading…</div>
      </div>
    `;
    el("ca-mv-discord-id").addEventListener("input", renderMovementResults);
    el("ca-mv-date").addEventListener("input", renderMovementResults);
    await renderMovementResults();
  }

  async function renderMovementResults() {
    const box = el("ca-mv-templates");
    if (!box) return;
    const templates = await fetchMovementTemplates();
    const discordId = el("ca-mv-discord-id")?.value.trim();
    const date = el("ca-mv-date")?.value.trim() || todayAmerican();
    if (!templates.length) {
      box.innerHTML = `<p class="ca-muted">No templates yet — add one under "Customize Templates".</p>`;
      return;
    }
    box.innerHTML = templates
      .map((t) => {
        const text = discordId
          ? `<@${discordId}> → ${t.roleIds.map((r) => `<@&${r}>`).join(" & ")} | ${date}`
          : "";
        return `
          <div class="ca-movement-row">
            <div class="ca-movement-name">${escapeHtml(t.name)}</div>
            <input type="text" class="ca-movement-output" readonly value="${escapeHtml(text)}" placeholder="Enter a Discord ID above" />
            <button type="button" class="ca-btn-accept" data-copy-for="${t.id}" ${discordId ? "" : "disabled"}>Copy</button>
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

  async function renderMovementCustomize() {
    const panel = el("ca-movement-panel");
    panel.innerHTML = `
      <div class="panel">
        <p class="ca-muted">Add, edit, or remove the templates available on the Generate tab. Each template pings one or more Discord roles — anyone with the Command Login role can manage these.</p>
        <div id="ca-mv-template-list">Loading…</div>
        <div class="ca-question-form" id="ca-mv-template-form"></div>
      </div>
    `;
    renderMovementTemplateForm(null);
    await loadMovementTemplateList();
  }

  async function loadMovementTemplateList() {
    const list = el("ca-mv-template-list");
    try {
      const templates = await fetchMovementTemplates(true);
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
        btn.addEventListener("click", () => handleMovementTemplateAction(btn.dataset.mvaction, templates, btn.dataset.mvid));
      });
    } catch {
      list.innerHTML = `<p class="ca-muted">Couldn't load templates. Try refreshing.</p>`;
    }
  }

  async function handleMovementTemplateAction(action, templates, id) {
    const t = templates.find((x) => String(x.id) === String(id));
    if (!t) return;
    if (action === "delete") {
      if (!confirm(`Delete template "${t.name}"? This can't be undone.`)) return;
      await fetch(`/api/admin/movement-templates?id=${t.id}`, { method: "DELETE" });
      movementTemplatesCache = null;
      await loadMovementTemplateList();
      return;
    }
    if (action === "edit") {
      renderMovementTemplateForm(t);
    }
  }

  function renderMovementTemplateForm(editing) {
    const formBox = el("ca-mv-template-form");
    const isEdit = !!editing;
    formBox.innerHTML = `
      <h4>${isEdit ? "Edit template" : "Add a template"}</h4>
      <div class="form-row">
        <label>Template name</label>
        <input type="text" id="ca-mv-t-name" value="${escapeHtml(editing?.name || "")}" placeholder="e.g. Suspending" />
      </div>
      <div class="form-row">
        <label>Role ID(s) to ping</label>
        <input type="text" id="ca-mv-t-roles" value="${escapeHtml((editing?.roleIds || []).join(", "))}" placeholder="e.g. 1283145857176440923, 1285706620374093854" />
        <p class="ca-muted" style="margin-top:0.35rem;">Separate multiple role IDs with commas. In Discord, enable Developer Mode, then right-click a role → Copy Role ID.</p>
      </div>
      <div class="ca-actions">
        <button class="ca-btn-accept" id="ca-mv-t-save">${isEdit ? "Save changes" : "Add template"}</button>
        ${isEdit ? `<button class="ca-btn-delete" id="ca-mv-t-cancel">Cancel</button>` : ""}
      </div>
    `;
    if (isEdit) {
      el("ca-mv-t-cancel").addEventListener("click", () => renderMovementTemplateForm(null));
    }
    el("ca-mv-t-save").addEventListener("click", async () => {
      const name = el("ca-mv-t-name").value.trim();
      const roleIds = el("ca-mv-t-roles")
        .value.split(",")
        .map((r) => r.trim())
        .filter(Boolean);
      if (!name) {
        alert("Please enter a template name.");
        return;
      }
      if (!roleIds.length || !roleIds.every((r) => /^\d{5,25}$/.test(r))) {
        alert("Enter one or more valid numeric Discord role IDs, separated by commas.");
        return;
      }
      const payload = { name, roleIds };
      if (isEdit) {
        await fetch("/api/admin/movement-templates", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, id: editing.id, sortOrder: editing.sortOrder }),
        });
      } else {
        await fetch("/api/admin/movement-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, sortOrder: 9999 }),
        });
      }
      movementTemplatesCache = null;
      renderMovementTemplateForm(null);
      await loadMovementTemplateList();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
