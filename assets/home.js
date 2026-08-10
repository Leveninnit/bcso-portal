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

      const photos = (data.patrolPhotos || []).filter((p) => p.url);
      if (photos.length) {
        document.getElementById("patrol-photo-grid").innerHTML = photos
          .map(
            (p) => `
            <figure class="photo-card">
              <img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.caption || "BCSO patrol photo")}" loading="lazy" />
              ${p.caption ? `<figcaption>${escapeHtml(p.caption)}</figcaption>` : ""}
            </figure>
          `
          )
          .join("");
        document.getElementById("patrol-gallery").style.display = "";
      }
    } catch {
      // Homepage content is an enhancement — if it fails to load, the
      // sections just stay hidden and the rest of the page is unaffected.
    }
  }
  document.addEventListener("DOMContentLoaded", init);
})();
