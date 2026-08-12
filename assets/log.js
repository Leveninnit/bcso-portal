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
  // Tracks whether setupRankField's fetch (below) has finished, so
  // applySubmitterAutofill can wait for it before deciding whether the
  // plain text #rank field or the #rank-select dropdown is the one to
  // fill in -- without this, a member who blurs the Discord ID field
  // quickly (autofill firing before this fetch resolves) could have their
  // fetched rank written into the text field right before this function
  // swaps it out for an empty dropdown, silently losing the value.
  let rankFieldReady = Promise.resolve();

  async function setupRankField(slug) {
    if (!slug || slug === "general") return;
    if (slug === "rtd") {
      // RTD has its own dedicated select (#rtdRank) instead of the
      // generic #rank/#rank-select pair above, since it's always a
      // required dropdown (never free text) and setRtdMode/handleSubmit
      // depend on that element existing. If command staff have
      // configured custom Rank options for RTD (Command Access -> RTD ->
      // Ranks), those replace the built-in 4-option list below;
      // otherwise the built-in list -- which the Master Roster sheet's
      // Activation Log formulas expect -- stays exactly as it was.
      try {
        const res = await fetch(`/api/rank-options?div=rtd`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        const options = data.options || [];
        if (!options.length) return;
        const rtdRank = document.getElementById("rtdRank");
        const currentValue = rtdRank.value;
        rtdRank.innerHTML =
          `<option value="">Select…</option>` +
          options.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("");
        // Preserve whatever was already selected (e.g. from the
        // submitter autofill) if it's still one of the options after
        // the swap.
        if (currentValue && Array.from(rtdRank.options).some((o) => o.value === currentValue)) {
          rtdRank.value = currentValue;
        }
      } catch {
        // Custom rank options are an enhancement — if they fail to load,
        // keep the built-in RTD list.
      }
      return;
    }
    const textInput = document.getElementById("rank");
    const select = document.getElementById("rank-select");
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

  // ------------------------------------------------------------------
  // "Open Recruitment" recruited-person lists. Whichever RTD branch
  // (Assist/Host/Supervise) has "Open Recruitment" picked as its Type
  // swaps its normal FTO/Cadet/Supervised-person fields for a simple,
  // repeatable "Recruited Person's Discord ID" field — a recruit doesn't
  // have a badge number yet, and one session can net more than one
  // person, so members can add as many rows as they need.
  // ------------------------------------------------------------------
  const RECRUIT_GROUPS = {
    assist: { key: "assist", typeId: "assistType", trainingId: "rtd-assist-fto", recruitsId: "rtd-assist-recruits", listId: "assist-recruit-list", addBtnId: "assist-add-recruit", prefix: "assistRecruitDiscord", recruitValues: ["Open Recruitment"] },
    // Host also has "Discord Recruitment" — a recruitment that happened
    // entirely over Discord rather than in-game, so it gets the same
    // recruited-person Discord ID list as Open Recruitment (see
    // syncNoShiftFields below for the other thing that makes it distinct:
    // no Duration on Duty / Shift Summary, since there's no shift).
    host: { key: "host", typeId: "hostType", trainingId: "rtd-host-training", recruitsId: "rtd-host-recruits", listId: "host-recruit-list", addBtnId: "host-add-recruit", prefix: "hostRecruitDiscord", recruitValues: ["Open Recruitment", "Discord Recruitment"] },
    supervise: { key: "supervise", typeId: "superviseType", trainingId: "rtd-supervise-person", recruitsId: "rtd-supervise-recruits", listId: "supervise-recruit-list", addBtnId: "supervise-add-recruit", prefix: "superviseRecruitDiscord", recruitValues: ["Open Recruitment"] },
  };

  function addRecruitRow(group) {
    const list = document.getElementById(group.listId);
    // Monotonically increasing per group, never reused -- basing this on
    // the current element count instead (the old behavior) meant adding
    // two rows (#2, #3) and then removing #2 made the *next* add compute
    // count=2 again and re-mint id "...2", except now #3 was still on the
    // page, giving two different rows the same id/for pair. Counting up
    // forever avoids that regardless of what gets removed in between.
    if (group.nextIndex === undefined) {
      group.nextIndex = list.querySelectorAll(".rtd-recruit-input").length;
    }
    const index = ++group.nextIndex;
    const inputId = `${group.prefix}${index}`;
    const row = document.createElement("div");
    row.className = "rtd-recruit-row";
    row.innerHTML =
      `<div class="form-row">` +
      `<label for="${inputId}">Recruited Person's Discord ID</label>` +
      `<input type="text" id="${inputId}" class="rtd-recruit-input" data-recruit-group="${group.key}" placeholder="e.g. 372504974311632896" />` +
      `</div>` +
      `<button type="button" class="rtd-recruit-remove" aria-label="Remove this recruit">Remove</button>`;
    row.querySelector(".rtd-recruit-remove").addEventListener("click", () => row.remove());
    list.appendChild(row);
    row.querySelector("input").focus();
  }

  function collectRecruitDiscordIds(group) {
    return Array.from(document.querySelectorAll(`.rtd-recruit-input[data-recruit-group="${group.key}"]`))
      .map((el) => el.value.trim())
      .filter(Boolean);
  }

  // Toggles the training-fields vs. recruited-person-list sub-sections
  // within one RTD branch, and keeps `required` in sync with whichever
  // half is actually visible so the browser doesn't block submission on
  // a hidden field. Called whenever the branch's Type dropdown changes,
  // and whenever the overall Role changes (via updateRtdBranch below).
  function syncRecruitToggle(group, panelActive) {
    const typeVal = document.getElementById(group.typeId).value;
    const isRecruit = group.recruitValues.includes(typeVal);
    const trainingEl = document.getElementById(group.trainingId);
    const recruitsEl = document.getElementById(group.recruitsId);
    const showTraining = panelActive && !isRecruit;
    const showRecruits = panelActive && isRecruit;
    trainingEl.style.display = showTraining ? "" : "none";
    recruitsEl.style.display = showRecruits ? "" : "none";

    // Same "Cadet #2-4 / Notes stay optional" rule as before, scoped to
    // just the training fields now that recruits live outside this group.
    trainingEl.querySelectorAll("input, select").forEach((field) => {
      const isOptionalField = /^cadet[234]/.test(field.id) || /Notes$/.test(field.id);
      field.required = showTraining && !isOptionalField;
    });
    // Only the first recruit row is required — additional ones are just
    // "add more if you have them."
    recruitsEl.querySelectorAll(".rtd-recruit-input").forEach((el, i) => {
      el.required = showRecruits && i === 0;
    });
  }

  function setupRecruitLists() {
    Object.values(RECRUIT_GROUPS).forEach((group) => {
      document.getElementById(group.addBtnId).addEventListener("click", () => addRecruitRow(group));
      document.getElementById(group.typeId).addEventListener("change", updateRtdBranch);
    });
  }

  // form.reset() (called after a successful submit) resets the *values*
  // of real form inputs, but it doesn't remove DOM nodes -- so any extra
  // recruit rows a member added during that submission used to stick
  // around, empty, cluttering the form for their next entry. This strips
  // every row back down to each group's single static first row (the one
  // baked into log.html, with no Remove button) and resets the id counter
  // so freshly added rows start numbering from 2 again.
  function resetRecruitLists() {
    Object.values(RECRUIT_GROUPS).forEach((group) => {
      const list = document.getElementById(group.listId);
      list.querySelectorAll(".rtd-recruit-remove").forEach((btn) => {
        const row = btn.closest(".rtd-recruit-row");
        if (row) row.remove();
      });
      group.nextIndex = undefined;
      clearRecruitScreenshot(group.key);
    });
  }

  // ------------------------------------------------------------------
  // "Open Recruitment" screenshot upload — an optional proof-of-
  // recruitment image attached to whichever recruit group (Assist/Host/
  // Supervise) is submitting. One per group, keyed the same way as
  // RECRUIT_GROUPS above. Supports click-to-browse, drag & drop, and
  // pasting an image (Ctrl+V) either while the dropzone itself has focus
  // or anywhere on the page while a recruit panel is open — see
  // setupRecruitScreenshots. The file never leaves the browser as-is: it's
  // downscaled and recompressed through a canvas first (handleScreenshotFile)
  // so a multi-megabyte phone screenshot still turns into a small, fast
  // upload, and the progress bar shown during that reflects real
  // FileReader byte progress for the read step.
  // ------------------------------------------------------------------
  const SHOT_MAX_INPUT_BYTES = 15 * 1024 * 1024; // reject absurd files before even trying to read them
  const SHOT_MAX_DIMENSION = 1600; // longest side after downscaling
  const SHOT_JPEG_QUALITY = 0.82;
  const recruitShots = {}; // group.key -> { dataUrl } | undefined

  function shotEl(key, suffix) {
    return document.getElementById(`${key}-shot-${suffix}`);
  }
  function setShotError(key, message) {
    const el = shotEl(key, "error");
    if (!el) return;
    el.textContent = message || "";
    el.style.display = message ? "" : "none";
  }
  function setShotProgress(key, pct, label) {
    const fill = shotEl(key, "progress-fill");
    const labelEl = shotEl(key, "progress-label");
    if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + "%";
    if (labelEl && label) labelEl.textContent = label;
  }
  function showShotState(key, state) {
    // state: "idle" | "progress" | "preview"
    const idle = shotEl(key, "idle");
    const progress = shotEl(key, "progress");
    const preview = shotEl(key, "preview");
    if (idle) idle.style.display = state === "idle" ? "" : "none";
    if (progress) progress.style.display = state === "progress" ? "" : "none";
    if (preview) preview.style.display = state === "preview" ? "" : "none";
  }
  function clearRecruitScreenshot(key) {
    delete recruitShots[key];
    const input = shotEl(key, "input");
    if (input) input.value = "";
    setShotError(key, "");
    showShotState(key, "idle");
  }
  function getRecruitScreenshot(key) {
    return (recruitShots[key] && recruitShots[key].dataUrl) || "";
  }

  // Reads the file (real byte-progress via FileReader), then downsizes +
  // recompresses it through a canvas so it's small before it's ever sent
  // anywhere. Progress: 0-50% is the file read, 50-95% is the image
  // decode + canvas resize/compress, 95-100% finalizes the preview.
  function handleScreenshotFile(key, file) {
    setShotError(key, "");
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      setShotError(key, "Please choose an image file (PNG, JPG, etc.).");
      return;
    }
    if (file.size > SHOT_MAX_INPUT_BYTES) {
      setShotError(key, "That image is too large (max 15MB). Try a smaller screenshot.");
      return;
    }
    showShotState(key, "progress");
    setShotProgress(key, 4, "Reading image…");
    const reader = new FileReader();
    reader.onprogress = (ev) => {
      if (ev.lengthComputable) {
        setShotProgress(key, 4 + (ev.loaded / ev.total) * 46, "Reading image…");
      }
    };
    reader.onerror = () => {
      setShotError(key, "Couldn't read that image. Please try again.");
      showShotState(key, "idle");
    };
    reader.onload = () => {
      setShotProgress(key, 55, "Processing image…");
      const img = new Image();
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > SHOT_MAX_DIMENSION || height > SHOT_MAX_DIMENSION) {
            const scale = SHOT_MAX_DIMENSION / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          setShotProgress(key, 78, "Compressing…");
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL("image/jpeg", SHOT_JPEG_QUALITY);
          setShotProgress(key, 97, "Almost done…");
          recruitShots[key] = { dataUrl };
          setTimeout(() => {
            const imgEl = shotEl(key, "img");
            if (imgEl) imgEl.src = dataUrl;
            showShotState(key, "preview");
          }, 150);
        } catch {
          setShotError(key, "Couldn't process that image. Please try a different file.");
          showShotState(key, "idle");
        }
      };
      img.onerror = () => {
        setShotError(key, "That doesn't look like a valid image. Please try a different file.");
        showShotState(key, "idle");
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function pasteImageFromClipboard(ev, key) {
    const items = (ev.clipboardData && ev.clipboardData.items) || [];
    for (const item of items) {
      if (item.kind === "file" && /^image\//.test(item.type)) {
        const file = item.getAsFile();
        if (file) {
          ev.preventDefault();
          handleScreenshotFile(key, file);
        }
        return true;
      }
    }
    return false;
  }

  function setupRecruitScreenshots() {
    Object.keys(RECRUIT_GROUPS).forEach((key) => {
      const dropzone = shotEl(key, "dropzone");
      const input = shotEl(key, "input");
      if (!dropzone || !input) return;
      dropzone.addEventListener("click", () => input.click());
      dropzone.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          input.click();
        }
      });
      input.addEventListener("change", () => {
        if (input.files && input.files[0]) handleScreenshotFile(key, input.files[0]);
      });
      dropzone.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        dropzone.classList.add("rtd-shot-dragover");
      });
      dropzone.addEventListener("dragleave", () => {
        dropzone.classList.remove("rtd-shot-dragover");
      });
      dropzone.addEventListener("drop", (ev) => {
        ev.preventDefault();
        dropzone.classList.remove("rtd-shot-dragover");
        const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
        if (file) handleScreenshotFile(key, file);
      });
      dropzone.addEventListener("paste", (ev) => pasteImageFromClipboard(ev, key));
      const removeBtn = shotEl(key, "remove");
      if (removeBtn) {
        removeBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          clearRecruitScreenshot(key);
        });
      }
    });
    // Also catch a paste anywhere on the page while a recruit panel is
    // open, not just when its dropzone happens to have focus -- Ctrl+V
    // normally "just works" wherever you are, and requiring a click into
    // a small box first is an easy way to miss the feature entirely.
    document.addEventListener("paste", (ev) => {
      if (ev.defaultPrevented) return; // a focused dropzone already handled it above
      const activeKey = Object.keys(RECRUIT_GROUPS).find((key) => {
        const el = shotEl(key, "dropzone");
        return el && el.offsetParent !== null; // visible on screen right now
      });
      if (activeKey) pasteImageFromClipboard(ev, activeKey);
    });
  }

  // RTD Host -> "Discord Recruitment" isn't an on-duty shift — it's just
  // a note that a recruitment happened over Discord — so it has no
  // Duration on Duty or Shift Summary of its own. Both fields (which live
  // outside #rtd-fields entirely, see log.html) hide and stop being
  // required whenever that's the selected Host type; every other
  // role/type combo, and every non-RTD subdivision, is unaffected.
  function syncNoShiftFields() {
    const role = document.getElementById("rtdRole").value;
    const hostType = document.getElementById("hostType").value;
    const noShift = role === "host" && hostType === "Discord Recruitment";
    document.getElementById("rtd-duration-row").style.display = noShift ? "none" : "";
    document.getElementById("rtd-summary-row").style.display = noShift ? "none" : "";
    ["hoursOnDuty", "durationMinutes", "durationSeconds"].forEach((id) => {
      document.getElementById(id).required = !noShift;
    });
    document.getElementById("summary").required = !noShift;
  }

  function updateRtdBranch() {
    const role = document.getElementById("rtdRole").value; // "assist" | "host" | "supervise" | ""
    const panels = { assist: "rtd-assist", host: "rtd-host", supervise: "rtd-supervise" };
    Object.entries(panels).forEach(([key, id]) => {
      const el = document.getElementById(id);
      const active = role === key;
      el.style.display = active ? "" : "none";
      // The Type dropdown itself is required whenever this branch is
      // active. Everything below it (training fields vs. recruited-person
      // list) is handled by syncRecruitToggle, since which half applies
      // depends on the Type value, not just which role is active.
      document.getElementById(RECRUIT_GROUPS[key].typeId).required = active;
      syncRecruitToggle(RECRUIT_GROUPS[key], active);
    });
    syncNoShiftFields();
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
    const isRecruitType = (group) => group.recruitValues.includes(val(group.typeId));
    const assistIsRecruit = role === "assist" && isRecruitType(RECRUIT_GROUPS.assist);
    const hostIsRecruit = role === "host" && isRecruitType(RECRUIT_GROUPS.host);
    const superviseIsRecruit = role === "supervise" && isRecruitType(RECRUIT_GROUPS.supervise);
    return {
      role,
      assistType: role === "assist" ? val("assistType") : "",
      ftoBadge: role === "assist" && !assistIsRecruit ? val("ftoBadge") : "",
      ftoDiscordId: role === "assist" && !assistIsRecruit ? val("ftoDiscordId") : "",
      assistRecruits: assistIsRecruit ? collectRecruitDiscordIds(RECRUIT_GROUPS.assist) : [],
      assistScreenshot: assistIsRecruit ? getRecruitScreenshot(RECRUIT_GROUPS.assist.key) : "",
      hostType: role === "host" ? val("hostType") : "",
      cadets: role === "host" && !hostIsRecruit ? [1, 2, 3, 4].map(cadet) : [],
      hostRecruits: hostIsRecruit ? collectRecruitDiscordIds(RECRUIT_GROUPS.host) : [],
      hostScreenshot: hostIsRecruit ? getRecruitScreenshot(RECRUIT_GROUPS.host.key) : "",
      superviseType: role === "supervise" ? val("superviseType") : "",
      supervisedBadge: role === "supervise" && !superviseIsRecruit ? val("supervisedBadge") : "",
      supervisedDiscordId: role === "supervise" && !superviseIsRecruit ? val("supervisedDiscordId") : "",
      superviseRecruits: superviseIsRecruit ? collectRecruitDiscordIds(RECRUIT_GROUPS.supervise) : [],
      superviseScreenshot: superviseIsRecruit ? getRecruitScreenshot(RECRUIT_GROUPS.supervise.key) : "",
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
    rankFieldReady = setupRankField(slugValue);

    setupRecruitLists();
    setupRecruitScreenshots();
    setRtdMode(isRtdSlug(slugValue));
    document.getElementById("rtdRole").addEventListener("change", updateRtdBranch);
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

  // Auto-fill character name / badge / Discord ID / rank from the Master
  // Roster for the person SUBMITTING the log — triggered from either the
  // Discord ID field OR the Badge Number field, whichever the member
  // fills in first (see handleDiscordIdBlur / handleBadgeNumberBlur
  // below). This is a convenience only — any failure (roster not
  // configured, no match, network error) just leaves the fields as-is
  // for manual entry.
  async function applySubmitterAutofill(data) {
    const note = document.getElementById("autofill-note");
    // Only claim "Auto-filled" if something was actually filled in -- see
    // the same fix in apply.js's handleDiscordIdBlur for why (a matched
    // roster row can still have every relevant field blank).
    let filledSomething = false;
    if (data.name) {
      document.getElementById("characterName").value = data.name;
      filledSomething = true;
    }
    if (data.badgeNumber) {
      document.getElementById("badgeNumber").value = data.badgeNumber;
      filledSomething = true;
    }
    if (data.discordId) {
      document.getElementById("discordId").value = data.discordId;
      filledSomething = true;
    }
    if (data.rank) {
      const slug = document.getElementById("subdivisionSlug").value;
      if (isRtdSlug(slug)) {
        // Wait for setupRankField's fetch to finish first -- now that
        // RTD's dropdown can also be swapped out for command-staff-
        // configured options (see setupRankField), matching against
        // #rtdRank's options before that swap finishes risks the same
        // "autofill wins the race, then gets silently reset when the
        // custom list replaces it" bug the non-RTD branch below already
        // guards against with this same await.
        await rankFieldReady;
        const rtdRank = document.getElementById("rtdRank");
        const match = Array.from(rtdRank.options).find(
          (o) => o.value.toLowerCase() === data.rank.toLowerCase()
        );
        if (match) {
          rtdRank.value = match.value;
          filledSomething = true;
        }
      } else {
        // Wait for setupRankField's fetch to finish before checking which
        // field is actually showing right now -- see rankFieldReady above.
        await rankFieldReady;
        const rankSelect = document.getElementById("rank-select");
        const usingDropdown = rankSelect && rankSelect.style.display !== "none";
        if (usingDropdown) {
          const match = Array.from(rankSelect.options).find(
            (o) => o.value.toLowerCase() === data.rank.toLowerCase()
          );
          if (match) {
            rankSelect.value = match.value;
            filledSomething = true;
          }
        } else {
          document.getElementById("rank").value = data.rank;
          filledSomething = true;
        }
      }
    }
    if (filledSomething) {
      note.textContent = "✓ Auto-filled from Master Roster";
      note.style.color = "var(--success)";
      note.style.display = "inline";
    }
  }

  async function handleDiscordIdBlur() {
    const discordId = document.getElementById("discordId").value.trim();
    const note = document.getElementById("autofill-note");
    note.style.display = "none";
    if (!discordId) return;
    try {
      const res = await fetch("/api/roster-lookup?discordId=" + encodeURIComponent(discordId));
      const data = await res.json().catch(() => ({}));
      if (data.found) await applySubmitterAutofill(data);
    } catch {
      // Roster lookup is a convenience — ignore failures quietly.
    }
  }

  async function handleBadgeNumberBlur() {
    const badgeNumber = document.getElementById("badgeNumber").value.trim();
    const note = document.getElementById("autofill-note");
    note.style.display = "none";
    if (!badgeNumber) return;
    try {
      const res = await fetch("/api/roster-lookup?badgeNumber=" + encodeURIComponent(badgeNumber));
      const data = await res.json().catch(() => ({}));
      if (data.found) await applySubmitterAutofill(data);
    } catch {
      // Roster lookup is a convenience — ignore failures quietly.
    }
  }

  // ------------------------------------------------------------------
  // RTD-only paired Badge Number + Discord ID fields (FTO, Cadets #1-4,
  // Supervised person). These are a DIFFERENT person than whoever is
  // submitting the log, so each pair gets its own independent lookup —
  // filling in Badge Number looks up and fills Discord ID, and vice
  // versa. Same convenience/fails-soft behavior as the fields above;
  // there's no name/rank to show for these, just the cross-fill.
  // ------------------------------------------------------------------
  function wireBadgeDiscordPair(badgeFieldId, discordFieldId) {
    const badgeEl = document.getElementById(badgeFieldId);
    const discordEl = document.getElementById(discordFieldId);
    if (!badgeEl || !discordEl) return;
    badgeEl.addEventListener("blur", async () => {
      const badge = badgeEl.value.trim();
      if (!badge) return;
      try {
        const res = await fetch("/api/roster-lookup?badgeNumber=" + encodeURIComponent(badge));
        const data = await res.json().catch(() => ({}));
        if (data.found && data.discordId) discordEl.value = data.discordId;
      } catch {
        // Convenience only — ignore failures quietly.
      }
    });
    discordEl.addEventListener("blur", async () => {
      const discordId = discordEl.value.trim();
      if (!discordId) return;
      try {
        const res = await fetch("/api/roster-lookup?discordId=" + encodeURIComponent(discordId));
        const data = await res.json().catch(() => ({}));
        if (data.found && data.badgeNumber) badgeEl.value = data.badgeNumber;
      } catch {
        // Convenience only — ignore failures quietly.
      }
    });
  }

  function setupRtdPairAutofill() {
    wireBadgeDiscordPair("ftoBadge", "ftoDiscordId");
    wireBadgeDiscordPair("cadet1Badge", "cadet1Discord");
    wireBadgeDiscordPair("cadet2Badge", "cadet2Discord");
    wireBadgeDiscordPair("cadet3Badge", "cadet3Discord");
    wireBadgeDiscordPair("cadet4Badge", "cadet4Discord");
    wireBadgeDiscordPair("supervisedBadge", "supervisedDiscordId");
  }

  // XMLHttpRequest instead of fetch specifically so upload.onprogress is
  // available -- fetch has no cross-browser way to observe request-body
  // upload progress. Only meaningfully visible when the payload includes
  // a recruitment screenshot (see handleSubmit's submit-progress bar);
  // for a plain JSON payload the whole request completes basically
  // instantly regardless.
  function postJsonWithProgress(url, payload, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.setRequestHeader("Content-Type", "application/json");
      if (onProgress) {
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) onProgress(ev.loaded / ev.total);
        };
      }
      xhr.onload = () => {
        let json = {};
        try {
          json = JSON.parse(xhr.responseText);
        } catch {
          // Non-JSON response body — treat as an empty object, same as
          // the old fetch path's `.catch(() => ({}))`.
        }
        resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, json });
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.send(JSON.stringify(payload));
    });
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

    // Each duration field (hours/minutes/seconds) has its own min/max on
    // the input, but nothing stopped e.g. 20 hours + 50 minutes from
    // passing per-field checks while still exceeding a real 24h shift --
    // that combined total is only enforced server-side, so it used to
    // surface as a late, confusing rejection after everything else looked
    // fine. Mirror the server's check here so it's caught immediately.
    const isDiscordRecruitment =
      rtd && payload.rtd.role === "host" && payload.rtd.hostType === "Discord Recruitment";
    if (!isDiscordRecruitment) {
      const h = Number(payload.durationHours) || 0;
      const m = Number(payload.durationMinutes) || 0;
      const s = Number(payload.durationSeconds) || 0;
      const totalSeconds = h * 3600 + m * 60 + s;
      if (totalSeconds <= 0 || totalSeconds > 24 * 3600) {
        showAlert(errorEl, "Duration must be between 1 second and 24 hours.");
        return;
      }
    }

    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.innerHTML = '<span class="spinner"></span> Submitting…';

    // Real upload progress is only worth showing when there's actually a
    // screenshot in the payload — a plain JSON submission is a few KB and
    // completes before a progress bar could even render meaningfully.
    const hasScreenshot =
      rtd && !!(payload.rtd.assistScreenshot || payload.rtd.hostScreenshot || payload.rtd.superviseScreenshot);
    const submitProgress = document.getElementById("submit-progress");
    const submitProgressFill = document.getElementById("submit-progress-fill");
    if (hasScreenshot && submitProgress) {
      submitProgress.style.display = "";
      if (submitProgressFill) submitProgressFill.style.width = "0%";
    }

    try {
      const { ok, json: data } = await postJsonWithProgress("/api/log", payload, (fraction) => {
        if (submitProgressFill) submitProgressFill.style.width = Math.round(fraction * 100) + "%";
      });
      if (submitProgress) submitProgress.style.display = "none";
      if (!ok) {
        showAlert(errorEl, data.error || "Something went wrong. Please try again.");
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
        return;
      }
      form.reset();
      resetRecruitLists();
      setRtdMode(rtd);
      showAlert(successEl);
      submitBtn.textContent = originalText;
    } catch {
      if (submitProgress) submitProgress.style.display = "none";
      showAlert(errorEl, "Could not reach the server. Please check your connection and try again.");
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initPage();
    document.getElementById("discordId").addEventListener("blur", handleDiscordIdBlur);
    document.getElementById("badgeNumber").addEventListener("blur", handleBadgeNumberBlur);
    setupRtdPairAutofill();
    document.getElementById("log-form").addEventListener("submit", handleSubmit);
  });
})();

