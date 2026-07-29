/**
 * Central config for Master Documents. Add a new document by adding one
 * object to this array — the Master Documents page reads from here
 * automatically, no other file needs to change.
 *
 * name        - display name
 * description - shown on the document card
 * url         - the live Google Doc/Sheet link. Links open in a new tab
 *               so people always see the current version, rather than a
 *               copy that goes stale. The document must be shared as at
 *               least "Anyone with the link - Viewer" for visitors to be
 *               able to open it.
 */
const DOCUMENTS = [
  {
    name: "Master Roster",
    description:
      "The full department roster — badge numbers, Discord IDs, ranks, and status for every member.",
    url: "https://docs.google.com/spreadsheets/d/16OWSECFEZRnVMApFN3ohJzZ3rYDZ55gQTZUjwGtCyN4/edit?gid=2086098384#gid=2086098384",
  },
  {
    name: "Standard Operating Procedure",
    description:
      "The full BCSO SOP — ranks, chain of command, vehicle and uniform policy, training program, and more.",
    url: "https://docs.google.com/document/d/10-1E-G905Fn8XPIelmPafbPlazCWHSQxwLTzlYTek5U/edit?tab=t.0",
  },
];
// Exposed as a global for plain <script> usage across pages.
window.DOCUMENTS = DOCUMENTS;
