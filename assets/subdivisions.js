/**
 * Central config for subdivisions. Add a new subdivision by adding one
 * object to this array — the Applications page and the Apply form
 * both read from here automatically, no other file needs to change.
 *
 * slug        - used in the URL (apply.html?div=slug) and as the Discord
 *               embed subdivision tag. Lowercase, no spaces.
 * name        - full display name
 * short       - short badge/acronym shown on cards
 * description - shown on the Applications page card and top of the form
 * requirements- optional bullet list shown on the form (array of strings)
 * logOnly     - if true, this subdivision has no application form and is
 *               excluded from the Applications page — it only appears on
 *               the Activity Log page (e.g. SRT).
 */
const SUBDIVISIONS = [
  {
    slug: "teu",
    name: "Traffic Enforcement Unit",
    short: "TEU",
    description:
      "Handles highway patrol, speed enforcement, DUI checkpoints, and collision response across Blaine County.",
    requirements: [
      "Minimum 2 weeks as a Deputy in good standing",
      "Clean disciplinary record for the last 30 days",
      "Comfortable with pursuit and traffic-stop procedures",
    ],
  },
  {
    slug: "ocd",
    name: "Organised Crime Division",
    short: "OCD",
    description:
      "Plainclothes investigative division targeting organised criminal activity, long-term investigations, and major case takedowns.",
    requirements: [
      "Minimum 3 weeks tenure",
      "Prior arrest/report-writing experience preferred",
      "Available for evening operations",
    ],
  },
  {
    slug: "nred",
    name: "Natural Resources & Environment Division",
    short: "NRED",
    description:
      "Patrols county parks, wilderness, and waterways — enforcing environmental and wildlife regulations across Blaine County.",
    requirements: [
      "Minimum 2 weeks tenure",
      "Comfortable with off-road / rural patrol",
    ],
  },
  {
    slug: "rtd",
    name: "Recruitment & Training Division",
    short: "RTD",
    description:
      "Trains and evaluates new recruits, runs the field training program, and maintains department training standards.",
    requirements: [
      "Minimum 4 weeks tenure",
      "Strong knowledge of SOPs and radio codes",
      "Patient, clear communicator",
    ],
  },
  {
    slug: "srt",
    name: "Special Response Team",
    short: "SRT",
    description:
      "High-risk tactical unit handling barricaded suspects, warrant service, and other specialist operations. SRT does not take public applications through this portal — activity is tracked via the Activity Log only.",
    requirements: [],
    logOnly: true,
  },
];
// Exposed as a global for plain <script> usage across pages.
window.SUBDIVISIONS = SUBDIVISIONS;
