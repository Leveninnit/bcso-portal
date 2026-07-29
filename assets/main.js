/**
 * Shared header + footer, injected into every page.
 * To add a new nav link later: edit the NAV_LINKS array below — every
 * page picks it up automatically, nothing else to touch.
 */
const NAV_LINKS = [
  { href: "index.html", label: "Home" },
  { href: "applications.html", label: "Applications" },
  // Add future sections here, e.g.:
  // { href: "roster.html", label: "Roster" },
];
function currentPage() {
  const path = window.location.pathname.split("/").pop() || "index.html";
  return path;
}
function renderHeader() {
  const active = currentPage();
  const links = NAV_LINKS.map(
    (l) =>
      `<a href="${l.href}"${l.href === active ? ' class="active"' : ""}>${l.label}</a>`
  ).join("");
  return `
  <header class="site-header">
    <div class="container">
      <a href="index.html" class="brand" style="text-decoration:none;">
        <img src="assets/bcso-crest.png" alt="BCSO Crest" />
        <span class="brand-text">
          <strong>Blaine County Sheriff's Office</strong>
          <span>Official Applications Portal</span>
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
