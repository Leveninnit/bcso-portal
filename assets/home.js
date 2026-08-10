/**
 * Powers the homepage's Deputy of the Week/Month and Patrol Photos
 * sections (see functions/api/site-content.js and home-admin.html).
 * Both sections stay hidden until High Command has actually filled
 * something in — an empty department doesn't show placeholder cards.
 */
(function () {
  function escapeHtml(str) {
    return (str ?? "").toString().replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }
  function subName(slug) {
    const sub = (window.SUBDIVISIONS || []).find((s) => s.slug === slug);
    return sub ? sub.name : "";
  }
  function honorCard(title, d) {
    if (!d || !d.characterName) return "";
    const subLine = subName(d.subdivisionSlug);
    return `
      <div class="panel value-card honor-card">
        ${d.photoUrl ? `<img class="honor-photo" src="${escapeHtml(d.photoUrl)}" alt="${escapeHtml(d.characterName)}" />` : ""}
        <div class="honor-badge">${title}</div>
        <h3>${escapeHtml(d.characterName)}</h3>
        <p class="honor-rank">${escapeHtml(d.rankTitle || "")}${subLine ? ` &middot; ${escapeHtml(subLine)}` : ""}</p>
        ${d.blurb ? `<p>${escapeHtml(d.blurb)}</p>` : ""}
      </div>
    `;
  }

  // ---------------------------------------------------------------------
  // Patrol Gallery — one photo at a time, navigated with the prev/next
  // arrow buttons, the left/right arrow keys, or the dots underneath.
  // ---------------------------------------------------------------------
  let patrolPhotos = [];
  let patrolIndex = 0;

  function renderPatrolSlide() {
    if (!patrolPhotos.length) return;
    const p = patrolPhotos[patrolIndex];
    const img = document.getElementById("patrol-slide-img");
    const caption = document.getElementById("patrol-slide-caption");
    img.src = p.url;
    img.alt = p.caption || "BCSO patrol photo";
    if (p.caption) {
      caption.textContent = p.caption;
      caption.style.display = "";
    } else {
      caption.textContent = "";
      caption.style.display = "none";
    }
    document.querySelectorAll("#patrol-slide-dots .photo-slide-dot").forEach((dot, i) => {
      dot.classList.toggle("active", i === patrolIndex);
    });
  }

  function stepPatrolSlide(delta) {
    if (patrolPhotos.length < 2) return;
    patrolIndex = (patrolIndex + delta + patrolPhotos.length) % patrolPhotos.length;
    renderPatrolSlide();
  }

  // Left/right arrow keys step through the slideshow from anywhere on
  // the page, as long as the person isn't typing into a form field
  // (registered once at load — it's a no-op until patrolPhotos has
  // more than one photo).
  document.addEventListener("keydown", (e) => {
    if (patrolPhotos.length < 2) return;
    const tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.key === "ArrowLeft") stepPatrolSlide(-1);
    else if (e.key === "ArrowRight") stepPatrolSlide(1);
  });

  async function init() {
    try {
      const res = await fetch("/api/site-content", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));

      const honorsHtml = [honorCard("Deputy of the Week", data.deputyOfWeek), honorCard("Deputy of the Month", data.deputyOfMonth)]
        .filter(Boolean)
        .join("");
      if (honorsHtml) {
        document.getElementById("honors-grid").innerHTML = honorsHtml;
        document.getElementById("honors").style.display = "";
      }

      patrolPhotos = (data.patrolPhotos || []).filter((p) => p.url);
      if (patrolPhotos.length) {
        patrolIndex = 0;
        const prevBtn = document.getElementById("patrol-slide-prev");
        const nextBtn = document.getElementById("patrol-slide-next");
        const dotsWrap = document.getElementById("patrol-slide-dots");
        const showControls = patrolPhotos.length > 1;
        prevBtn.style.display = showControls ? "" : "none";
        nextBtn.style.display = showControls ? "" : "none";
        dotsWrap.style.display = showControls ? "" : "none";
        dotsWrap.innerHTML = showControls
          ? patrolPhotos
              .map((_, i) => `<button type="button" class="photo-slide-dot" data-index="${i}" aria-label="Go to photo ${i + 1}"></button>`)
              .join("")
          : "";
        dotsWrap.querySelectorAll(".photo-slide-dot").forEach((dot) => {
          dot.addEventListener("click", () => {
            patrolIndex = Number(dot.dataset.index);
            renderPatrolSlide();
          });
        });
        prevBtn.addEventListener("click", () => stepPatrolSlide(-1));
        nextBtn.addEventListener("click", () => stepPatrolSlide(1));
        renderPatrolSlide();
        document.getElementById("patrol-gallery").style.display = "";
      }
    } catch {
      // Homepage content is an enhancement — if it fails to load, the
      // sections just stay hidden and the rest of the page is unaffected.
    }
  }
  document.addEventListener("DOMContentLoaded", init);
})();
