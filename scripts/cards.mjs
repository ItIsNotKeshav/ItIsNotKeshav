// Builds the profile's SVG cards (header, overview, featured projects) into dist/,
// in a dark and a light variant each. Run by .github/workflows/profile.yml.
// Usage: GITHUB_TOKEN=... node scripts/cards.mjs [login]

import { mkdir, readFile, writeFile } from "node:fs/promises";

const LOGIN = process.argv[2] ?? process.env.GITHUB_REPOSITORY_OWNER ?? "ItIsNotKeshav";
const OUT = "dist";

// Repos shown as cards, in order. Stars, language and homepage come from the API.
// A wide card spans the full README width; the others sit two to a row.
const FEATURED = [
  {
    repo: "Zeus",
    title: "Zeus",
    wide: true,
    blurb: "Native WhatsApp for Windows, macOS and Linux, built on ZapFast. Rust and egui with no browser engine, voice and video calls, and chats kept in an encrypted local archive.",
  },
  {
    repo: "ProgressLens",
    title: "ProgressLens",
    blurb: "Local-first student progress analytics. Syncs Google Sheets into snapshots and lets a local Ollama model answer questions.",
  },
  {
    repo: "cardsite",
    title: "Hermes Card",
    blurb: "Design concept for a titanium rewards card. Astro, a GSAP scroll story and a Three.js card.",
  },
];

const THEMES = {
  dark: {
    panel: "#0d1117", inset: "#010409", border: "#30363d", grid: "#21262d",
    text: "#e6edf3", muted: "#9198a1", accent: "#f5a524", track: "#21262d",
  },
  light: {
    panel: "#ffffff", inset: "#f6f8fa", border: "#d1d9e0", grid: "#e6eaef",
    text: "#1f2328", muted: "#59636e", accent: "#a85a00", track: "#eff2f5",
  },
};

// Geist and Geist Mono (SIL OFL), subset to the characters the cards use and embedded,
// since an SVG shown as an image can't load fonts from anywhere else.
const font = async (file) => (await readFile(new URL(`../assets/fonts/${file}`, import.meta.url))).toString("base64");
const FONT_CSS = `
  @font-face{font-family:Geist;font-weight:100 900;src:url(data:font/woff;base64,${await font("geist.woff")}) format("woff")}
  @font-face{font-family:'Geist Mono';font-weight:100 900;src:url(data:font/woff;base64,${await font("geist-mono.woff")}) format("woff")}`;
const SANS = "Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "'Geist Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

// Glyphs Geist lacks, drawn as shapes so they match on every machine.
const chevron = (x, y, color) => `<path d="M${x} ${y - 11}l6 5.5-6 5.5" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
const star = (x, y, color) => `<path transform="translate(${x} ${y}) scale(0.8)" fill="${color}" d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"/>`;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (n) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString("en-US"));

function wrap(text, width) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && (line + " " + word).length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function svg(w, h, t, body, extraCss = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none">
<style>${FONT_CSS}
  .sans{font-family:${SANS}} .mono{font-family:${MONO}}
  ${extraCss}
  @media (prefers-reduced-motion: reduce){*{animation:none!important}}
</style>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="14" fill="${t.panel}" stroke="${t.border}"/>
${body}
</svg>\n`;
}

async function fetchUser() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  const query = `query($login:String!){user(login:$login){
    pullRequests{totalCount}
    contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{contributionCount}}}}
    repositories(first:100,ownerAffiliations:OWNER,privacy:PUBLIC){totalCount nodes{
      name isFork stargazerCount homepageUrl primaryLanguage{name color}
      languages(first:10,orderBy:{field:SIZE,direction:DESC}){edges{size node{name color}}}
    }}
  }}`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "profile-cards" },
    body: JSON.stringify({ query, variables: { login: LOGIN } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GitHub API: ${JSON.stringify(json.errors ?? json)}`);
  return json.data.user;
}

function summarize(user) {
  const repos = user.repositories.nodes;
  const days = user.contributionsCollection.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
  let best = 0, run = 0;
  for (const d of days) {
    run = d.contributionCount > 0 ? run + 1 : 0;
    best = Math.max(best, run);
  }

  // Languages across own work only: forks are mostly someone else's code.
  const bytes = new Map();
  for (const r of repos) {
    if (r.isFork) continue;
    for (const { size, node } of r.languages.edges) {
      const cur = bytes.get(node.name) ?? { size: 0, color: node.color ?? "#8b949e" };
      cur.size += size;
      bytes.set(node.name, cur);
    }
  }
  const total = [...bytes.values()].reduce((a, b) => a + b.size, 0) || 1;
  const sorted = [...bytes].sort((a, b) => b[1].size - a[1].size);
  const languages = sorted.slice(0, 6).map(([name, v]) => ({ name, color: v.color, pct: (v.size / total) * 100 }));
  const rest = 100 - languages.reduce((a, l) => a + l.pct, 0);
  if (rest >= 0.5) languages.push({ name: "Other", color: null, pct: rest });

  return {
    stats: [
      [user.contributionsCollection.contributionCalendar.totalContributions, "contributions"],
      [days.filter((d) => d.contributionCount > 0).length, "active days"],
      [best, "best streak (days)"],
      [repos.reduce((a, r) => a + r.stargazerCount, 0), "stars earned"],
      [user.pullRequests.totalCount, "pull requests"],
    ],
    languages,
    repos: new Map(repos.map((r) => [r.name, r])),
  };
}

function header(t) {
  const W = 1200, H = 300, tx = 636, ty = 42, tw = 520, th = 216;
  const term = [
    ["building", "Zeus", "native WhatsApp, in Rust"],
    ["made", "ProgressLens", "local-AI analytics"],
    ["designed", "Hermes Card", "3D card concept"],
  ];
  const lines = term.map(([verb, name, what], i) => `
  <text class="mono line" style="animation-delay:${0.5 + i * 0.45}s" x="${tx + 26}" y="${ty + 110 + i * 32}" font-size="17">
    <tspan fill="${t.muted}">${verb.padEnd(10, " ")}</tspan><tspan fill="${t.text}" font-weight="600">${esc(name)}</tspan><tspan fill="${t.muted}"> · ${esc(what)}</tspan>
  </text>`).join("");

  const body = `
<defs>
  <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" fill="${t.grid}"/></pattern>
  <linearGradient id="fade" x1="0" x2="1"><stop offset="0.35" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>
  <mask id="m"><rect width="${W}" height="${H}" fill="url(#fade)"/></mask>
</defs>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="14" fill="url(#dots)" mask="url(#m)"/>
<text class="mono" x="64" y="98" font-size="21" fill="${t.accent}">hi, i'm</text>
<text class="sans" x="62" y="164" font-size="68" font-weight="700" fill="${t.text}" letter-spacing="-1.5">Keshav Joshi</text>
<text class="sans" x="64" y="214" font-size="22" fill="${t.muted}">I build full-stack products and native</text>
<text class="sans" x="64" y="245" font-size="22" fill="${t.muted}">desktop apps with Rust, TypeScript and React.</text>

<rect x="${tx}" y="${ty}" width="${tw}" height="${th}" rx="10" fill="${t.inset}" stroke="${t.border}"/>
<path d="M${tx} ${ty + 34}h${tw}" stroke="${t.border}"/>
<circle cx="${tx + 20}" cy="${ty + 17}" r="5" fill="${t.border}"/>
<circle cx="${tx + 38}" cy="${ty + 17}" r="5" fill="${t.border}"/>
<circle cx="${tx + 56}" cy="${ty + 17}" r="5" fill="${t.border}"/>
<text class="mono" x="${tx + tw / 2}" y="${ty + 23}" font-size="14" fill="${t.muted}" text-anchor="middle">~/keshav</text>
${chevron(tx + 27, ty + 72, t.accent)}
<text class="mono" x="${tx + 46}" y="${ty + 72}" font-size="17" fill="${t.text}">keshav --now</text>
${lines}
<g class="line" style="animation-delay:1.9s">${chevron(tx + 27, ty + 196, t.accent)}</g>
<rect class="cursor" x="${tx + 46}" y="${ty + 181}" width="10" height="19" fill="${t.text}"/>`;

  return svg(W, H, t, body, `
  .line{animation:in .5s ease-out both}
  .cursor{animation:blink 1.1s steps(1) infinite}
  @keyframes in{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:none}}
  @keyframes blink{50%{opacity:0}}`);
}

function overview(t, { stats, languages }) {
  const W = 1200, H = 290, pad = 48, colW = (W - pad * 2) / stats.length;
  const tiles = stats.map(([n, label], i) => `
<text class="sans" x="${pad + i * colW}" y="112" font-size="46" font-weight="700" fill="${t.text}" letter-spacing="-1">${fmt(n)}</text>
<text class="sans" x="${pad + i * colW}" y="144" font-size="18" fill="${t.muted}">${esc(label)}</text>`).join("");

  const barW = W - pad * 2;
  let x = pad;
  const segs = languages.map((l) => {
    const w = (l.pct / 100) * barW;
    const r = `<rect x="${x.toFixed(1)}" y="200" width="${Math.max(w - 2, 1).toFixed(1)}" height="10" fill="${l.color ?? t.muted}"/>`;
    x += w;
    return r;
  }).join("");

  let lx = pad;
  const legend = languages.map((l) => {
    const label = `${l.name} ${l.pct < 1 ? "<1" : Math.round(l.pct)}%`;
    const item = `<circle cx="${lx + 5}" cy="250" r="6" fill="${l.color ?? t.muted}"/>
<text class="sans" x="${lx + 18}" y="256" font-size="17" fill="${t.muted}">${esc(label)}</text>`;
    lx += 18 + label.length * 9.2 + 28;
    return item;
  }).join("");

  return svg(W, H, t, `
<text class="mono" x="${pad}" y="52" font-size="15" fill="${t.muted}" letter-spacing="1">AT A GLANCE · LAST 12 MONTHS</text>
${tiles}
<clipPath id="bar"><rect x="${pad}" y="200" width="${barW}" height="10" rx="5"/></clipPath>
<rect x="${pad}" y="200" width="${barW}" height="10" rx="5" fill="${t.track}"/>
<g clip-path="url(#bar)">${segs}</g>
${legend}`);
}

function project(t, f, repo) {
  const W = f.wide ? 1200 : 600, H = f.wide ? 196 : 236, foot = H - 29;
  const lines = wrap(f.blurb, f.wide ? 100 : 48).slice(0, 3).map((l, i) =>
    `<text class="sans" x="30" y="${100 + i * 29}" font-size="20" fill="${t.muted}">${esc(l)}</text>`).join("");
  const lang = repo?.primaryLanguage;
  const stars = repo?.stargazerCount ?? 0;
  const host = repo?.homepageUrl ? new URL(repo.homepageUrl).host : "";
  return svg(W, H, t, `
<text class="sans" x="30" y="58" font-size="30" font-weight="700" fill="${t.text}" letter-spacing="-0.5">${esc(f.title)}</text>
${lines}
${lang ? `<circle cx="37" cy="${foot - 6}" r="7" fill="${lang.color ?? t.muted}"/>
<text class="sans" x="53" y="${foot}" font-size="17" fill="${t.muted}">${esc(lang.name)}</text>` : ""}
${stars ? (() => {
    const x = lang ? 53 + lang.name.length * 9.5 + 24 : 30;
    return `${star(x, foot - 13, t.muted)}<text class="sans" x="${x + 19}" y="${foot}" font-size="17" fill="${t.muted}">${stars}</text>`;
  })() : ""}
${host ? `<text class="mono" x="${W - 30}" y="${foot}" font-size="15" fill="${t.accent}" text-anchor="end">${esc(host)} ↗</text>` : ""}`);
}

const data = summarize(await fetchUser());
await mkdir(OUT, { recursive: true });
for (const [name, t] of Object.entries(THEMES)) {
  await writeFile(`${OUT}/header-${name}.svg`, header(t));
  await writeFile(`${OUT}/overview-${name}.svg`, overview(t, data));
  for (const f of FEATURED) {
    await writeFile(`${OUT}/project-${f.repo.toLowerCase()}-${name}.svg`, project(t, f, data.repos.get(f.repo)));
  }
}
console.log(`wrote cards for ${LOGIN} to ${OUT}/`);
