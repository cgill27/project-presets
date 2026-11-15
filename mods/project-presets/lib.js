// Pure helpers: no herdr imports, so they can be tested with plain node.

/** Subsequence match: -1 for no match, else a score (higher is better). */
export function fuzzy(query, text) {
  if (!query) return 0; // no search: every row matches, and nothing needs lowercasing
  const q = query.toLowerCase();
  const s = text.toLowerCase();
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

/** The list as shown: section headers (Open now, Pinned, Everything else, Found in your folders, Template) and the rows between them, each row
 *  keeping its index into `rows`. No headers while searching (the order is then by match) or when only one
 *  section has anything in it. */
export function listItems(rows, searching) {
  if (searching) return rows.map((r, index) => ({ row: r, index }));
  const buckets = { open: [], pinned: [], other: [], found: [], template: [] };
  rows.forEach((r, index) => {
    const item = { row: r, index };
    if (r.p.template) buckets.template.push(item);
    else if (r.space) buckets.open.push(item);
    else if (r.p.pinned) buckets.pinned.push(item);
    else if (r.p.discovered) buckets.found.push(item);
    else buckets.other.push(item);
  });
  const parts = [["Open now", buckets.open], ["Pinned", buckets.pinned], ["Everything else", buckets.other], ["Found in your folders", buckets.found], ["Template", buckets.template]].filter(([, items]) => items.length);
  if (parts.length < 2) return rows.map((r, index) => ({ row: r, index }));
  return parts.flatMap(([title, items]) => [{ header: title }, ...items]);
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

// ---- the template, and duplicating -------------------------------------------------------------

/** The starting point a new person edits and duplicates: a project with no folder (`template: true`) and some sensible
 *  settings. It is shown in the list until it is saved or deleted. */
export function defaultTemplate() {
  return normalize({
    name: "Template",
    path: "",
    template: true,
    worktree: { mode: "ask" },
    startup: { agent: "claude", layout: "agent-terminal" },
  });
}

/** A name not in `taken`: "api copy", then "api copy 2", "api copy 3"… */
export function uniqueName(base, taken) {
  const names = new Set(taken);
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** A copy to edit: unique name, not pinned, no template flag. The folder is kept (the same repo with other settings is the
 *  usual reason to duplicate), except from a template, which has none. */
export function duplicateProject(p, takenNames) {
  const copy = JSON.parse(JSON.stringify(p));
  delete copy.template;
  copy.pinned = false;
  copy.name = uniqueName(p.template ? "New project" : `${p.name} copy`, takenNames);
  if (p.template) copy.path = "";
  return normalize(copy);
}

/** The settings a template carries to the projects made from it (not the name, folder, group or pin). Each is a path into
 *  the project and the label shown when asking whether to apply a change. */
export const TEMPLATE_SETTINGS = [
  [["startup", "agent"], "Agent"],
  [["startup", "args"], "Agent arguments"],
  [["startup", "prompt"], "Prompt"],
  [["startup", "promptMode"], "Prompt mode"],
  [["startup", "layout"], "Pane layout"],
  [["startup", "setup"], "Setup commands"],
  [["startup", "tabs"], "Extra tabs"],
  [["worktree", "mode"], "Worktree mode"],
  [["worktree", "branchTemplate"], "Branch name template"],
  [["worktree", "root"], "Worktree folder"],
  [["worktree", "spaceName"], "Space name"],
  [["worktree", "repoSpace"], "Open the repo's space first"],
  [["git", "fetch"], "Fetch first"],
  [["git", "fastForward"], "Fast-forward checkout"],
  [["git", "remote"], "Remote"],
  [["git", "base"], "Base branch"],
];

const valueAt = (p, path) => path.reduce((o, k) => o?.[k], p);

/** What a save changed in a template: [{ path, label, value }] for each setting whose value differs from `before`. */
export function templateChanges(before, after) {
  return TEMPLATE_SETTINGS
    .filter(([path]) => JSON.stringify(valueAt(before, path)) !== JSON.stringify(valueAt(after, path)))
    .map(([path, label]) => ({ path, label, value: JSON.parse(JSON.stringify(valueAt(after, path) ?? null)) }));
}

/** `projects` with `changes` applied to every project that is not a template: only the settings that changed, so each
 *  project keeps its own name, folder, group, pin and every setting the template did not touch. */
export function applyTemplateChanges(projects, changes) {
  return projects.map((p) => {
    if (p.template) return p;
    const copy = JSON.parse(JSON.stringify(p));
    for (const { path, value } of changes) {
      let o = copy;
      for (const k of path.slice(0, -1)) o = o[k] ??= {};
      o[path[path.length - 1]] = JSON.parse(JSON.stringify(value));
    }
    return copy;
  });
}

/** A blank project that starts with the template's settings (agent, layout, worktree and git settings, group) but not its
 *  name or folder. */
export function startFromTemplate(template) {
  return { ...duplicateProject(template, []), name: "", path: "" };
}

// ---- backup and restore ----------------------------------------------------------------------------

/** A path with the home folder written as `~`, so a backup works on a machine with another user name. */
export function portablePath(path, home) {
  const s = String(path ?? "");
  const h = String(home ?? "").replace(/\/+$/, "");
  if (!h) return s;
  if (s === h) return "~";
  return s.startsWith(h + "/") ? "~" + s.slice(h.length) : s;
}

export const BACKUP_FORMAT = "project-presets-backup";

/** What an export writes: the whole data file (projects, layouts, settings) with home-folder paths made portable. */
export function exportData({ projects, layouts, gitInfo, hideTemplate }, home, now = new Date()) {
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: now.toISOString(),
    gitInfo: gitInfo !== false,
    hideTemplate: hideTemplate === true,
    layouts: layouts ?? [],
    projects: (projects ?? []).map((p) => ({ ...p, path: portablePath(p.path, home), worktree: { ...p.worktree, root: portablePath(p.worktree?.root, home) } })),
  };
}

/** Reads a backup (or a plain project-presets.json): { projects, layouts, gitInfo, hideTemplate }. Throws with the reason. */
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error(`That file is not valid JSON: ${e.message}`); }
  if (!data || typeof data !== "object" || !Array.isArray(data.projects)) throw new Error("That file has no list of projects: is it a project-presets backup?");
  if (data.format !== undefined && data.format !== BACKUP_FORMAT) throw new Error(`That file is not a project-presets backup (format "${data.format}")`);
  if (data.version > 1) throw new Error("That backup is from a newer version of project-presets: update the mod, then import it");
  return {
    projects: data.projects.filter((p) => p && typeof p === "object").map(normalize),
    layouts: Array.isArray(data.layouts) ? data.layouts : [],
    gitInfo: data.gitInfo !== false,
    hideTemplate: data.hideTemplate === true,
  };
}

const projectKey = (p) => `${p.name}\u0000${String(p.path ?? "").replace(/\/+$/, "")}`;

/** Adds the incoming projects that are not already there (same name and folder), keeping yours as they are.
 *  An incoming template is skipped when you have one. */
export function mergeProjects(existing, incoming) {
  const have = new Set(existing.map(projectKey));
  const hasTemplate = existing.some((p) => p.template);
  const projects = [...existing];
  let added = 0;
  let skipped = 0;
  for (const p of incoming) {
    if (have.has(projectKey(p)) || (p.template && hasTemplate)) { skipped++; continue; }
    projects.push(p);
    have.add(projectKey(p));
    added++;
  }
  return { projects, added, skipped };
}

/** Adds the incoming layouts whose names you don't have; yours win. */
export function mergeLayouts(existing, incoming) {
  const names = new Set(existing.map((l) => l.name));
  const fresh = incoming.filter((l) => l && typeof l.name === "string" && !names.has(l.name));
  return { layouts: [...existing, ...fresh], added: fresh.length };
}

/** The default name for an export, with the local date and time so each export keeps its own file:
 *  project-presets-config-2026-11-01-133500.json */
export function exportFileName(now = new Date()) {
  const n = (v, w = 2) => String(v).padStart(w, "0");
  return `project-presets-config-${now.getFullYear()}-${n(now.getMonth() + 1)}-${n(now.getDate())}-${n(now.getHours())}${n(now.getMinutes())}${n(now.getSeconds())}.json`;
}

/** The launcher blocks a layout needs (see the project-presets-launcher mod), added to a copy of `tree`: the sidebar one
 *  under the Spaces list, the status one beside the status bar, the tab one beside the tab bar. Each is added only where
 *  the layout has the block it goes beside (`spaces`, `status`, `tabs`), and never twice. Returns { tree, added: [slots] }. */
export function withLauncherBlocks(tree) {
  const copy = JSON.parse(JSON.stringify(tree ?? null));
  const added = [];
  const block = (slot, px) => ({ id: `pp-launch-${slot}`, type: "block", size: { px }, content: { mod: "project-presets-launcher", props: { slot } } });
  const has = (n, id) => n?.id === id || (n?.children ?? []).some((c) => has(c, id));
  // Wraps the block `id` in a container of its own kind (the block keeps its content; the container takes its size).
  const wrap = (n, id, type, slot, px, containerId) => {
    const kids = n?.children;
    if (!kids) return false;
    const i = kids.findIndex((c) => c.id === id);
    if (i >= 0) {
      const target = kids[i];
      const { size, min, max } = target;
      const inner = { ...target, size: { weight: 1 } };
      delete inner.min; delete inner.max;
      kids[i] = { id: containerId, type, size: size ?? { weight: 1 }, ...(min != null ? { min } : {}), ...(max != null ? { max } : {}), ...(target.window_drag ? { window_drag: true } : {}), children: [inner, block(slot, px)] };
      return true;
    }
    return kids.some((c) => wrap(c, id, type, slot, px, containerId));
  };
  if (!copy || has(copy, "pp-launch-sidebar") || has(copy, "pp-launch-status") || has(copy, "pp-launch-tabs")) return { tree: copy, added };
  if (wrap(copy, "spaces", "column", "sidebar", 36, "spaces-section")) added.push("sidebar");
  if (wrap(copy, "status", "row", "status", 96, "status-row")) added.push("status");
  if (wrap(copy, "tabs", "row", "tabs", 36, "tabs-row")) added.push("tabs");
  return { tree: copy, added };
}

// ---- repo preset files ---------------------------------------------------------------------------
// A repository can carry its own settings in .herdr/project-presets.json, so everyone who clones it opens it the same
// way: { name?, group?, worktree?: {…}, git?: {…}, startup?: {…}, layouts?: [...] }, the same keys a project has in the
// data file (no folder and no pin: those are each person's own). Its commands run on the machine of whoever opens the
// project, so the picker shows the file and asks before it uses one (see presetSummary and the trust file in config.js).

export const PRESET_FILE = ".herdr/project-presets.json";

const PRESET_SHAPE = {
  worktree: { mode: ["ask", "always", "never"], branchTemplate: "text", root: "text", spaceName: "text", repoSpace: "flag" },
  git: { fetch: "flag", remote: "text", base: "text", fastForward: "flag" },
  startup: { agent: "text", args: "text", prompt: "text", promptMode: ["arg", "send"], setup: "list", tabs: "list", layout: "text" },
};

/** Reads a repo preset file: { name?, group?, worktree, git, startup, layouts }, holding only the settings the file sets.
 *  Throws with the reason when it is not JSON or a setting has the wrong kind of value; unknown keys are ignored. */
export function parseRepoPreset(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error(`not valid JSON: ${e.message}`); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("it must be a JSON object");
  const preset = { worktree: {}, git: {}, startup: {}, layouts: [] };
  for (const key of ["name", "group"]) {
    if (data[key] === undefined) continue;
    if (typeof data[key] !== "string") throw new Error(`"${key}" must be text`);
    if (data[key].trim()) preset[key] = data[key].trim();
  }
  for (const [section, keys] of Object.entries(PRESET_SHAPE)) {
    const given = data[section];
    if (given === undefined) continue;
    if (!given || typeof given !== "object" || Array.isArray(given)) throw new Error(`"${section}" must be an object`);
    for (const [key, kind] of Object.entries(keys)) {
      const v = given[key];
      if (v === undefined) continue;
      const where = `"${section}.${key}"`;
      if (Array.isArray(kind)) { if (!kind.includes(v)) throw new Error(`${where} must be one of ${kind.join(", ")}`); }
      else if (kind === "text") { if (typeof v !== "string") throw new Error(`${where} must be text`); }
      else if (kind === "flag") { if (typeof v !== "boolean") throw new Error(`${where} must be true or false`); }
      else if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new Error(`${where} must be a list of commands`);
      preset[section][key] = kind === "list" ? v.map((x) => x.trim()).filter(Boolean) : v;
    }
  }
  if (data.layouts !== undefined) {
    if (!Array.isArray(data.layouts)) throw new Error('"layouts" must be a list');
    for (const l of data.layouts) {
      if (!l || typeof l.name !== "string" || !l.name.trim() || !Array.isArray(l.panes)) throw new Error('each layout needs a "name" and a "panes" list');
      layoutPlan(l); // a layout that can't be built is refused here, not at launch
    }
    preset.layouts = data.layouts;
  }
  return preset;
}

/** `project` with the preset's settings on top: only what the file sets changes. */
export function applyRepoPreset(project, preset) {
  return normalize({
    ...project,
    ...(preset.name ? { name: preset.name } : {}),
    ...(preset.group ? { group: preset.group } : {}),
    worktree: { ...project.worktree, ...preset.worktree },
    git: { ...project.git, ...preset.git },
    startup: { ...project.startup, ...preset.startup },
  });
}

const RUNS = new Set(["startup.agent", "startup.args", "startup.setup", "startup.tabs"]);

/** What a preset file sets, for the screen that asks before using it: [{ label, value, runs }], one line per setting and
 *  per command. `runs` marks what is executed on this machine (the agent command, setup commands, tabs, layout commands). */
export function presetSummary(preset) {
  const lines = [];
  const show = (v) => (typeof v === "boolean" ? (v ? "yes" : "no") : String(v) === "" ? "(empty)" : String(v));
  if (preset.name) lines.push({ label: "Name", value: preset.name, runs: false });
  if (preset.group) lines.push({ label: "Group", value: preset.group, runs: false });
  for (const [path, label] of TEMPLATE_SETTINGS) {
    const v = valueAt(preset, path);
    if (v === undefined) continue;
    const runs = RUNS.has(path.join("."));
    if (Array.isArray(v)) { for (const x of v) lines.push({ label, value: x, runs }); if (!v.length) lines.push({ label, value: "(none)", runs: false }); }
    else lines.push({ label, value: show(v), runs: runs && v !== "" });
  }
  for (const l of preset.layouts) {
    const panes = l.panes.map((pane, i) => {
      const type = i === 0 ? "agent" : (pane.type ?? (pane.command ? "command" : "shell"));
      return type === "command" ? `runs ${String(pane.command).trim()}` : type;
    });
    lines.push({ label: `Layout "${l.name}"`, value: panes.join(" · "), runs: l.panes.some((pane, i) => i > 0 && (pane.type ?? (pane.command ? "command" : "shell")) === "command") });
  }
  return lines;
}

/** The preset file for a project: the settings a team shares (agent, prompt, setup, tabs, layout, worktree mode and branch
 *  name, git settings) and the layout it names when that is one of `userLayouts`. Left out as each person's own: the
 *  folder, the pin, the worktree folder, the space name and whether the repo's space opens first. */
export function repoPresetOf(project, userLayouts = []) {
  const p = normalize(project);
  const layout = (userLayouts ?? []).find((l) => l && l.name === p.startup.layout);
  return {
    name: p.name,
    ...(p.group ? { group: p.group } : {}),
    worktree: { mode: p.worktree.mode, branchTemplate: p.worktree.branchTemplate },
    git: { fetch: p.git.fetch, remote: p.git.remote, base: p.git.base, fastForward: p.git.fastForward },
    startup: { agent: p.startup.agent, args: p.startup.args, prompt: p.startup.prompt, promptMode: p.startup.promptMode, setup: p.startup.setup, tabs: p.startup.tabs, layout: p.startup.layout },
    ...(layout ? { layouts: [layout] } : {}),
  };
}

// ---- folder scanning -----------------------------------------------------------------------------

export const SCAN_DEPTH = 3; // how many folders below a scan folder a checkout may sit
export const SCAN_MAX = 400; // more checkouts than this are not listed

/** The `scan` key of the data file, tidied: { folders, depth, hidden }. */
export function normalizeScan(scan) {
  const list = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().replace(/(.)\/+$/, "$1")))] : []);
  const depth = Number.isInteger(scan?.depth) ? Math.min(6, Math.max(1, scan.depth)) : SCAN_DEPTH;
  return { folders: list(scan?.folders), depth, hidden: list(scan?.hidden) };
}

/** The `find` that lists the .git folders under the current folder, NUL separated. Hidden folders and node_modules are
 *  skipped; only a .git *folder* counts, so linked worktrees and submodules (whose .git is a file) are not listed. */
export const scanCommand = (depth) => ["sh", ["-c", 'cd "$1" && find . -maxdepth "$2" \\( -name node_modules -o -name ".?*" ! -name .git \\) -prune -o -name .git -type d -prune -print0', "sh"], depth + 1];

/** The checkouts in that find's output, as absolute folders under `root`. */
export function parseScan(stdout, root) {
  const base = String(root).replace(/\/+$/, "");
  return String(stdout ?? "").split("\0").filter(Boolean).map((rel) => {
    const inner = rel.replace(/^\.\//, "").replace(/\/?\.git$/, "");
    return inner ? `${base}/${inner}` : base || "/";
  });
}

/** Folders sorted, without duplicates and without any that sit inside another one (a checkout vendored in a checkout). */
export function dropNested(folders) {
  const kept = [];
  for (const f of [...new Set(folders)].sort()) if (!kept.some((k) => f.startsWith(k.replace(/\/+$/, "") + "/"))) kept.push(f);
  return kept;
}

/** A project for a checkout a scan found: the template's settings (or the blank ones), named after its folder. It is
 *  not in the data file until the person saves it; `discovered` marks it. */
export function discoveredProject(folder, template = null) {
  const base = template ? startFromTemplate(template) : blankProject(folder);
  return { ...base, name: basename(folder), path: folder, pinned: false, discovered: true };
}

/** A found project as the data file keeps it: without the marks the picker put on it. */
export function savedProject(p) {
  const copy = JSON.parse(JSON.stringify(p));
  delete copy.discovered;
  delete copy.preset;
  delete copy.presetError;
  return copy;
}
