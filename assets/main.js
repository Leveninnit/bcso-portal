/**
 * Shared header + footer, injected into every page.
 * To add a new nav link later: edit the NAV_LINKS array below — every
 * page picks it up automatically, nothing else to touch.
 */
const NAV_LINKS = [
  { href: "index.html", label: "Home" },
  { href: "documents.html", label: "Master Documents" },
  { href: "applications.html", label: "Applications" },
  { href: "activity-log.html", label: "Activity Log" },
  // Add future sections here, e.g.:
  // { href: "roster.html", label: "Roster" },
];
function currentPage() {
  // Cloudflare Pages serves clean URLs (e.g. "/applications" instead of
  // "/applications.html"), so compare without the extension on both sides.
  let path = window.location.pathname.split("/").pop() || "index.html";
  path = path.replace(/\.html$/, "");
  return path === "" ? "index" : path;
}
function renderHeader() {
  const active = currentPage();
  const links = NAV_LINKS.map((l) => {
    const linkPage = l.href.replace(/\.html$/, "");
    return `<a href="${l.href}"${linkPage === active ? ' class="active"' : ""}>${l.label}</a>`;
  }).join("");
  return `
  <header class="site-header">
    <div class="container">
      <a href="index.html" class="brand" style="text-decoration:none;">
        <img src="assets/bcso-crest.png" alt="BCSO Crest" />
        <span class="brand-text">
          <strong>Blaine County Sheriff's Office</strong>
          <span>Official Department Portal</span>
        </span>
      </a>
      <nav class="main-nav">${links}</nav>
    </div>
  </header>`;
}
function renderFooter() {
  const year = new Date().getFullYear();
  return `
  <footer class="site-footer">
    <div class="container">
      <span>&copy; ${year} Blaine County Sheriff's Office &mdash; Est. 1908</span>
      <span>Respectful &middot; Professional &middot; Ethical &middot; Service to All</span>
    </div>
  </footer>`;
}
document.addEventListener("DOMContentLoaded", () => {
  const headerMount = document.getElementById("site-header-mount");
  const footerMount = document.getElementById("site-footer-mount");
  if (headerMount) headerMount.outerHTML = renderHeader();
  if (footerMount) footerMount.outerHTML = renderFooter();
});
