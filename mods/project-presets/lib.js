// Pure helpers: no herdr imports, so they can be tested with plain node.

/** Subsequence match: -1 for no match, else a score (higher is better). */
export function fuzzy(query, text) {
  const q = query.toLowerCase();
  const s = text.toLowerCase();
  if (!q) return 0;
  let score = 0;
  let i = 0;
  let prev = -2;
  for (let j = 0; j < s.length && i < q.length; j++) {
    if (s[j] !== q[i]) continue;
    score += 1;
    if (j === prev + 1) score += 2;
    if (j === 0 || /[\s\-_/.]/.test(s[j - 1])) score += 3;
    prev = j;
    i++;
  }
  return i === q.length ? score - s.length * 0.01 : -1;
}

export function slug(text) {
  return String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Replaces {name} with vars[name]; unknown names become "". */
export function expand(template, vars) {
  return String(template ?? "").replace(/\{(\w+)\}/g, (_m, k) => vars[k] ?? "");
}

const pad = (n) => String(n).padStart(2, "0");
export const dateStamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const timeStamp = (d = new Date()) => `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

/** A branch name from a template: variables filled, stray slashes and spaces cleaned. */
export function branchName(template, vars) {
  return expand(template, vars)
    .replace(/\s+/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/^[/.-]+|[/.]+$/g, "");
}

export const basename = (p) => String(p).replace(/[\\/]+$/, "").split(/[\\/]/).pop();

/** "~/x" and "$HOME/x" to an absolute path. */
export function expandHome(p, home) {
  return String(p ?? "").replace(/^[\r\n]+|[\r\n]+$/g, "").replace(/^(~|\$HOME)(?=\/|$)/, home).replace(/[\\/]+$/, "");
}

const ESCAPES = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, "\\": 92, '"': 34 };

/** A path as git prints it: when it has special characters git wraps it in quotes and escapes them
 *  (\n, \", \\ and \ooo octal bytes). Anything unquoted comes back unchanged. */
export function unquotePath(p) {
  if (p.length < 2 || p[0] !== '"' || p[p.length - 1] !== '"') return p;
  const bytes = [];
  const enc = new TextEncoder();
  const body = p.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== "\\") { bytes.push(...enc.encode(c)); continue; }
    const oct = body.slice(i + 1, i + 4);
    if (/^[0-7]{3}$/.test(oct)) { bytes.push(parseInt(oct, 8)); i += 3; }
    else if (body[i + 1] in ESCAPES) { bytes.push(ESCAPES[body[i + 1]]); i++; }
    else bytes.push(92);
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

export function shortHome(p, home) {
  return p === home || p.startsWith(home + "/") ? "~" + p.slice(home.length) : p;
}

/** "a ;; b" to ["a", "b"]. */
export const splitList = (text) => String(text ?? "").split(";;").map((x) => x.trim()).filter(Boolean);
export const joinList = (list) => (list ?? []).join(" ;; ");

/** Shell-style words: whitespace separated, with '…' and "…" keeping spaces together. */
export function splitArgs(text) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let m; (m = re.exec(String(text ?? "")));) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export function blankProject(path = "") {
  return {
    name: basename(path),
    path,
    group: "",
    pinned: false,
    worktree: {
      mode: "ask",
      branchTemplate: "{user}/{date}-{slug}",
      root: "~/.herdr/worktrees/{repo}/{branch}",
      spaceName: "{name} · {branch}",
      repoSpace: false,
    },
    git: { fetch: true, remote: "origin", base: "main", fastForward: false },
    startup: { agent: "", args: "", prompt: "", promptMode: "arg", setup: [], tabs: [] },
  };
}

/** Fills anything missing from a hand-edited project, keeping what is there. */
export function normalize(p) {
  const b = blankProject(p?.path ?? "");
  return {
    ...b,
    ...p,
    worktree: { ...b.worktree, ...(p?.worktree ?? {}) },
    git: { ...b.git, ...(p?.git ?? {}) },
    startup: { ...b.startup, ...(p?.startup ?? {}) },
  };
}
