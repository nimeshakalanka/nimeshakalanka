// scripts/generate-stats.mjs  (Node 20+, no dependencies)
import { writeFileSync, mkdirSync } from "node:fs";

const LOGIN = "nimeshakalanka";
const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) {
  console.error("Missing GH_TOKEN");
  process.exit(1);
}

const query = `
query($login: String!) {
  user(login: $login) {
    followers { totalCount }
    pullRequests { totalCount }
    issues { totalCount }
    repositories(ownerAffiliations: OWNER, isFork: false, first: 100, orderBy: {field: STARGAZERS, direction: DESC}) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
          edges { size node { name color } }
        }
      }
    }
    contributionsCollection {
      totalCommitContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `bearer ${TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": "stats-generator",
  },
  body: JSON.stringify({ query, variables: { login: LOGIN } }),
});
const json = await res.json();
if (json.errors || !json.data?.user) {
  console.error(JSON.stringify(json, null, 2));
  process.exit(1);
}
const u = json.data.user;

// ---- numbers ----
const repos = u.repositories.nodes;
const stars = repos.reduce((s, r) => s + r.stargazerCount, 0);
const cc = u.contributionsCollection;
const commits = cc.totalCommitContributions + cc.restrictedContributionsCount;
const yearTotal = cc.contributionCalendar.totalContributions;

const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
const today = new Date().toISOString().slice(0, 10);
let longest = 0;
let run = 0;
for (const d of days) {
  if (d.contributionCount > 0) {
    run++;
    longest = Math.max(longest, run);
  } else run = 0;
}
let current = 0;
for (let i = days.length - 1; i >= 0; i--) {
  const d = days[i];
  if (d.contributionCount > 0) current++;
  else if (d.date === today) continue; // today may not have activity yet
  else break;
}

const langMap = new Map();
for (const r of repos) {
  for (const e of r.languages.edges) {
    const cur = langMap.get(e.node.name) ?? 0;
    langMap.set(e.node.name, cur + e.size);
  }
}
const langTotal = [...langMap.values()].reduce((a, b) => a + b, 0) || 1;
const langs = [...langMap.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .map(([name, size]) => ({ name, pct: (size / langTotal) * 100 }));

// ---- svg ----
const W = 1000, H = 260, PW = 316, GAP = 26;
const px = (i) => i * (PW + GAP);
const fmt = (n) => Number(n).toLocaleString("en-US");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const panel = (i, title) => `
  <rect x="${px(i)}" y="0" width="${PW}" height="${H}" rx="18" fill="#0A0E1A" stroke="#1C2438"/>
  <rect x="${px(i) + 18}" y="0" width="${PW - 36}" height="3" fill="url(#accent)"/>
  <text x="${px(i) + 24}" y="40" class="t">${title}</text>`;

const statRows = [
  ["Total Stars", stars],
  ["Commits (last year)", commits],
  ["Pull Requests", u.pullRequests.totalCount],
  ["Issues", u.issues.totalCount],
  ["Repositories", u.repositories.totalCount],
  ["Followers", u.followers.totalCount],
]
  .map(([k, v], i) => {
    const y = 84 + i * 28;
    return `<text x="${px(0) + 24}" y="${y}" class="l">${esc(k)}</text>
  <text x="${px(0) + PW - 24}" y="${y}" class="v" text-anchor="end">${fmt(v)}</text>`;
  })
  .join("\n  ");

const cx = px(1) + PW / 2;
const R = 52;
const C = 2 * Math.PI * R;
const prog = Math.min(current / Math.max(longest, 1), 1);

const langRows = langs.length
  ? langs
      .map((l, i) => {
        const y = 78 + i * 34;
        const w = Math.max(4, Math.round((268 * l.pct) / langs[0].pct));
        return `<text x="${px(2) + 24}" y="${y}" class="l">${esc(l.name)}</text>
  <text x="${px(2) + PW - 24}" y="${y}" class="l" text-anchor="end">${l.pct.toFixed(1)}%</text>
  <rect x="${px(2) + 24}" y="${y + 8}" width="268" height="6" rx="3" fill="#141B33"/>
  <rect x="${px(2) + 24}" y="${y + 8}" width="0" height="6" rx="3" fill="url(#accent)">
    <animate attributeName="width" from="0" to="${w}" dur="1.2s" begin="0.2s" fill="freeze"/>
  </rect>`;
      })
      .join("\n  ")
  : `<text x="${px(2) + 24}" y="90" class="l">No language data yet</text>`;

const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#FFC53D"/>
      <stop offset="1" stop-color="#5B7CFF"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <style>
      .t { font: 700 13px 'Segoe UI', Helvetica, Arial, sans-serif; letter-spacing: 3px; fill: #FFC53D; }
      .l { font: 500 14px 'Segoe UI', Helvetica, Arial, sans-serif; fill: #8FA3D8; }
      .v { font: 700 16px 'Segoe UI', Helvetica, Arial, sans-serif; fill: #FFFFFF; }
      .big { font: 800 40px 'Segoe UI', Helvetica, Arial, sans-serif; fill: #FFFFFF; }
    </style>
  </defs>

  ${panel(0, "THUNDER STATS")}
  ${statRows}

  ${panel(1, "STREAK")}
  <circle cx="${cx}" cy="120" r="${R}" fill="none" stroke="#141B33" stroke-width="6"/>
  <circle cx="${cx}" cy="120" r="${R}" fill="none" stroke="#FFC53D" stroke-width="6" stroke-linecap="round"
          stroke-dasharray="${(prog * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 ${cx} 120)" filter="url(#glow)">
    <animate attributeName="opacity" values="1;0.6;1" dur="3s" repeatCount="indefinite"/>
  </circle>
  <text x="${cx}" y="133" class="big" text-anchor="middle">${fmt(current)}</text>
  <text x="${cx}" y="198" class="l" text-anchor="middle" letter-spacing="3">DAY STREAK</text>
  <text x="${px(1) + 24}" y="236" class="l">Longest <tspan class="v">${fmt(longest)}</tspan></text>
  <text x="${px(1) + PW - 24}" y="236" class="l" text-anchor="end">Last year <tspan class="v">${fmt(yearTotal)}</tspan></text>

  ${panel(2, "TOP LANGUAGES")}
  ${langRows}
</svg>
`;

mkdirSync("assets", { recursive: true });
writeFileSync("assets/stats.svg", svg);
console.log("assets/stats.svg updated");
