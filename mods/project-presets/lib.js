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

/** Which characters of `text` `fuzzy` matched, as indexes (same left-to-right pick); [] for no match or an empty query. */
export function fuzzyPositions(query, text) {
  const q = query.toLowerCase();
  const s = text.toLowerCase();
  const at = [];
  for (let j = 0; j < s.length && at.length < q.length; j++) if (s[j] === q[at.length]) at.push(j);
  return q && at.length === q.length ? at : [];
}

/** Splits `text` into [{ text, hit }] runs, hit where `at` marks a matched character. */
export function highlightRuns(text, at) {
  const hit = new Set(at);
  const runs = [];
  [...text].forEach((ch, i) => {
    const h = hit.has(i);
    if (runs.length && runs[runs.length - 1].hit === h) runs[runs.length - 1].text += ch;
    else runs.push({ text: ch, hit: h });
  });
  return runs;
}

/** The program an agent command runs, for matching it to an agent: "/usr/bin/claude --model x" is "claude". */
export const commandName = (text) => basename(splitArgs(text)[0] ?? "");

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

/** `git worktree list --porcelain -z` (or without -z) to [{ path, branch, locked, prunable }], the
 *  main checkout first. With -z, records end in NUL and a blank field separates worktrees, so a
 *  path may hold anything; without it git prints a path with a newline raw and it can't be told apart. */
export function parseWorktrees(text) {
  const nul = text.includes("\0");
  const blocks = nul ? text.split("\0\0") : text.trim().split(/\n\n+/);
  return blocks.filter((b) => b.trim() !== "").map((b) => {
    const lines = nul ? b.split("\0") : b.split("\n");
    const get = (key) => lines.find((x) => x === key || x.startsWith(key + " "));
    const path = get("worktree")?.slice(9) ?? "";
    const branch = get("branch")?.match(/^branch refs\/heads\/(.+)$/)?.[1] ?? null;
    return { path, branch, locked: Boolean(get("locked")), prunable: Boolean(get("prunable")) };
  });
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
    startup: { agent: "", args: "", prompt: "", promptMode: "arg", setup: [], tabs: [], layout: "" },
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

// ---- pane layouts -----------------------------------------------------------------------------
// A layout is the panes of a project's first tab: the first one runs the agent, each next one is
// split off an earlier pane. { name, label?, panes: [{ name?, type: "agent"|"shell"|"command",
// command?, direction: "right"|"down", from? }] }. `from` names the pane to split (default: the
// previous one). Sizes are not set: herdr splits evenly.

export const BUILTIN_LAYOUTS = [
  { name: "agent-terminal", label: "Agent + terminal below", panes: [{ type: "agent" }, { type: "shell", direction: "down" }] },
  { name: "agent-side-terminal", label: "Agent + terminal right", panes: [{ type: "agent" }, { type: "shell", direction: "right" }] },
];

/** The layouts to offer: built-ins, then the user's (a user layout replaces a built-in of the same name). */
export function allLayouts(user) {
  const mine = (user ?? []).filter((l) => l && typeof l.name === "string" && l.name.trim() && Array.isArray(l.panes));
  const names = new Set(mine.map((l) => l.name));
  return [...BUILTIN_LAYOUTS.filter((l) => !names.has(l.name)), ...mine];
}

/** The splits that build a layout, in order: [{ name, type, command, direction, from }]. The first
 *  pane is the agent's and needs no split. Throws with the reason when a pane can't be placed. */
export function layoutPlan(layout) {
  const panes = layout?.panes ?? [];
  const seen = new Set();
  const plan = [];
  panes.forEach((pane, i) => {
    const name = String(pane?.name ?? (i === 0 ? "agent" : `pane${i + 1}`));
    if (seen.has(name)) throw new Error(`Layout "${layout.name}": two panes are called "${name}"`);
    if (i > 0) {
      if (!["right", "down"].includes(pane.direction)) throw new Error(`Layout "${layout.name}": pane "${name}" needs direction "right" or "down"`);
      const type = pane.type ?? (pane.command ? "command" : "shell");
      if (!["agent", "shell", "command"].includes(type)) throw new Error(`Layout "${layout.name}": pane "${name}" has an unknown type "${pane.type}"`);
      if (type === "command" && !String(pane.command ?? "").trim()) throw new Error(`Layout "${layout.name}": command pane "${name}" has no command`);
      const from = pane.from ?? [...seen].pop();
      if (!seen.has(from)) throw new Error(`Layout "${layout.name}": pane "${name}" splits "${from}", which does not come before it`);
      plan.push({ name, type, command: type === "command" ? String(pane.command).trim() : "", direction: pane.direction, from });
    }
    seen.add(name);
  });
  return plan;
}

/** The layout after `current` when cycling through none ("") and then every layout; an unknown name goes to none. */
export function nextLayout(names, current) {
  const order = ["", ...names];
  const i = order.indexOf(current ?? "");
  return order[(i + 1) % order.length];
}

/** A command that starts in `folder` (a split doesn't take one); no argv: the person's shell. */
export const inFolder = (folder, argv = []) => [
  "sh", "-c", 'cd "$1" || exit; shift; [ $# -gt 0 ] || set -- "${SHELL:-/bin/sh}"; exec "$@"', "sh", folder, ...argv,
];

// ---- agent options ----------------------------------------------------------------------------

// The coding agents offered even when herdr's own list lacks them (or lists only installed ones).
// Icons are herdr's own, in ~/.config/herdr-app/icons; `tint` ones take the text color.
const FALLBACK_AGENTS = [
  { key: "claude", name: "Claude Code", run: ["claude"], icon: "icons/claude.svg", tint: false },
  { key: "codex", name: "Codex", run: ["codex"], icon: "icons/codex.svg", tint: false },
  { key: "opencode", name: "opencode", run: ["opencode"], icon: "icons/opencode.svg", tint: true },
  { key: "hermes", name: "Hermes", run: ["hermes"], icon: "icons/hermes.svg", tint: true },
  { key: "pi", name: "pi", run: ["pi"], icon: "icons/pi.svg", tint: false },
];

/** Every agent to offer: herdr's list (installed or not), then the fallbacks it doesn't already have. */
export function agentOptions(known) {
  const have = (a) => (known ?? []).some((k) => k.key === a.key || commandName((k.run ?? []).join(" ")) === a.key);
  return [...(known ?? []), ...FALLBACK_AGENTS.filter((a) => !have(a)).map((a) => ({ ...a, installed: false }))];
}

// ---- the picker's list and detail card ----------------------------------------------------------

/** "just now", "12 min ago", "3 hours ago", "yesterday", "5 days ago", "2 weeks ago"; "never" without a time. */
export function ago(ts, now = Date.now()) {
  if (!ts) return "never";
  const m = Math.max(0, Math.floor((now - ts) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h > 1 ? "s" : ""} ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.floor(d / 7)} weeks ago`;
  return `${Math.floor(d / 30)} months ago`;
}

/** The list as shown: section headers (Open now, Pinned, Everything else) and the rows between them, each row
 *  keeping its index into `rows`. No headers while searching (the order is then by match) or when only one
 *  section has anything in it. */
export function listItems(rows, searching) {
  const parts = [
    ["Open now", (r) => r.space],
    ["Pinned", (r) => !r.space && r.p.pinned],
    ["Everything else", (r) => !r.space && !r.p.pinned],
  ].map(([title, test]) => ({ title, rows: rows.map((r, index) => ({ r, index })).filter((x) => test(x.r)) })).filter((x) => x.rows.length);
  if (searching || parts.length < 2) return rows.map((r, index) => ({ row: r, index }));
  return parts.flatMap((x) => [{ header: x.title }, ...x.rows.map(({ r, index }) => ({ row: r, index }))]);
}

/** Where a layout's panes sit, as fractions of its box: [{ name, x, y, w, h }]. Each split halves the pane it
 *  comes from (the new pane takes the right or bottom half). A broken layout draws as the agent alone. */
export function layoutRects(layout) {
  let plan = [];
  try { plan = layoutPlan(layout); } catch { return [{ name: "agent", x: 0, y: 0, w: 1, h: 1 }]; }
  const rects = [{ name: layout?.panes?.[0]?.name ?? "agent", x: 0, y: 0, w: 1, h: 1 }];
  for (const pane of plan) {
    const from = rects.find((r) => r.name === pane.from);
    if (!from) continue;
    if (pane.direction === "right") {
      const half = from.w / 2;
      rects.push({ name: pane.name, x: from.x + half, y: from.y, w: half, h: from.h });
      from.w = half;
    } else {
      const half = from.h / 2;
      rects.push({ name: pane.name, x: from.x, y: from.y + half, w: from.w, h: half });
      from.h = half;
    }
  }
  return rects;
}

/** What Enter does for a worktree mode, and the label of the main button. */
export const enterAction = (mode) => mode === "never" ? ["opens the checkout", "Open checkout"] : mode === "always" ? ["creates a new worktree", "Create worktree"] : ["asks for a branch name", "Open…"];

// ---- space colors -----------------------------------------------------------------------------

// What herdr's space avatars look like for a stored color name (the sidebar's `spaces` mod draws them
// the same way and says every mod that draws space avatars should): one strong color per hue.
export const SPACE_MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

/** The avatar color of a space from herdr's shared `space.colors` ({ spaceId: "ansi4" | "#rrggbb" }); teal until herdr
 *  has given it one. `theme` supplies a color name SPACE_MARK doesn't know. */
export function spaceColor(colors, id, theme = {}) {
  const c = (colors ?? {})[id] ?? "ansi6";
  return c.startsWith("#") ? c : (SPACE_MARK[c] ?? theme[c] ?? SPACE_MARK.ansi6);
}
