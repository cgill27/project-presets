// Project presets: a picker of configured git checkouts, each with its own worktree and startup
// settings. Type to filter, ↑/↓ and Enter to open, Shift+Enter for the main checkout, Add project / Edit / Worktrees / Delete
// buttons (or alt/ctrl/cmd + n, e, w, d), Esc to leave.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, VirtualListScrollHandle, v_virtual_list } from "gpui-base";
import { knownAgents, window, theme, props, closeOverlay, run, pickFolder, shared, setShared, home, spaces } from "herdr";
import { loadConfig, saveConfig } from "./config.js";
import { inspect, projectFolder, previewBranch, createWorktree, worktreeSpaceName, listWorktrees, removeWorktree, prepareMain, runSetup, findSpace, launch, gitSummary } from "./git.js";
import { readDemo } from "./demo.js";
import { initLog, log, logError } from "./log.js";
import { fuzzy, blankProject, shortHome, splitList, joinList, basename, allLayouts, nextLayout, layoutPlan, fuzzyPositions, highlightRuns, commandName, agentOptions, ago, listItems, layoutRects, enterAction, spaceColor } from "./lib.js";

const RECENT = "project-presets.recent";
const DETAIL = "project-presets.detail"; // false: hide the detail card (kept between sessions)
// Shortcut hints: ⌘ on macOS (Option+letter types a character there), alt elsewhere.
// Calls into herdr (window, home, shared, spaces) are not free, and a render draws every row: each is asked once per
// render (`this.frame`) or remembered (the platform, until the next render).
let platformCache;
const mac = () => (platformCache ??= window()?.platform ?? "") === "macos";
let homeDir;
const homeOf = () => (homeDir ??= home());
const key = (letter, other = "alt") => (mac() ? `⌘${letter.toUpperCase()}` : `${other}+${letter}`);
// Herdr binds a bare alt+l to moving between panes, so the layout key needs ctrl (⌘ on macOS) as well, like the open key.
const FOOTER_SIZE = 12;
const LAYOUT_HINT = () => (mac() ? "⌘⌥L" : "ctrl+alt+L");
const DETAIL_HINT = () => (mac() ? "⌘⌥I" : "ctrl+alt+I");

const ROW = 48;
const HEADER = 30; // a section header in the project list
const CARD = 340; // the detail card's width
// Editor sections and the text fields each one shows.
const SECTIONS = [["project", "Project"], ["worktree", "Worktree"], ["git", "Git"], ["startup", "Startup"]];
const SECTION_FIELDS = {
  project: ["name", "path", "group"],
  worktree: ["branchTemplate", "root", "spaceName"],
  git: ["remote", "base"],
  startup: ["agent", "args", "prompt", "layout", "setup", "tabs"],
};
const MODES = ["ask", "always", "never"];
const MODE_HELP = { ask: "ask for a branch name", always: "always a new worktree", never: "open the checkout" };

// Editor fields: text ones keep an InputState, the rest are buttons.
const TEXT = [
  ["name", "Name", (p) => p.name, (p, v) => (p.name = v)],
  ["path", "Folder", (p) => p.path, (p, v) => (p.path = v)],
  ["group", "Group", (p) => p.group, (p, v) => (p.group = v)],
  ["branchTemplate", "Branch name", (p) => p.worktree.branchTemplate, (p, v) => (p.worktree.branchTemplate = v), "{user} {date} {slug} {repo} {project}"],
  ["root", "Worktree folder", (p) => p.worktree.root, (p, v) => (p.worktree.root = v), "{repo} {branch} plus the above"],
  ["spaceName", "Space name", (p) => p.worktree.spaceName, (p, v) => (p.worktree.spaceName = v), "the sidebar name: {name} {branch} {slug} {user} {date} {repo}"],
  ["remote", "Remote", (p) => p.git.remote, (p, v) => (p.git.remote = v)],
  ["base", "Base branch", (p) => p.git.base, (p, v) => (p.git.base = v)],
  ["agent", "Agent command", (p) => p.startup.agent, (p, v) => (p.startup.agent = v), "pick above or type one; empty: plain shell"],
  ["args", "Agent arguments", (p) => p.startup.args, (p, v) => (p.startup.args = v), "e.g. --model opus --permission-mode plan"],
  ["prompt", "First prompt", (p) => p.startup.prompt, (p, v) => (p.startup.prompt = v), "sent to the agent; ignored without one"],
  ["layout", "Pane layout", (p) => p.startup.layout, (p, v) => (p.startup.layout = v), "a layout name (empty: just the agent); ctrl+alt+L (⌘⌥L) picks one at launch"],
  ["setup", "Setup commands", (p) => joinList(p.startup.setup), (p, v) => (p.startup.setup = splitList(v)), "separate with ;; — each limited to 30 s"],
  ["tabs", "Extra tabs", (p) => joinList(p.startup.tabs), (p, v) => (p.startup.tabs = splitList(v)), "commands, separate with ;;"],
];

export default class ProjectPresets extends View {
  init(_props, cx) {
    this.cx = cx;
    this.scroll = VirtualListScrollHandle.new();
    this.wtScroll = VirtualListScrollHandle.new();
    this.ranges = {};
    this.overlay = props()?.overlay;
    this.projects = [];
    this.layouts = [];
    this.detail = shared(DETAIL) !== false; // the detail card beside the list
    this.info = {}; // folder → { branch, dirty, worktrees } (null: not readable), filled in after the list shows
    this.layoutPick = null; // null: each project's own layout; "": none; else a layout name (set only when it differs from the project's own)
    this.raw = null;
    this.mode = "list"; // list | edit | name | busy
    this.at = 0;
    this.error = null;
    this.notes = [];
    this.handle = cx.focus_handle();

    this.search = InputState.new({ placeholder: "Open a project…" });
    this.search.on("change", (_e, cx) => { this.at = 0; cx.notify(); });
    this.search.on("submit", () => { if (Date.now() - (this.handled ?? 0) > 200) this.activate(false); });
    this.search.focus();
    cx.timer.after(600, () => this.mode === "list" && this.search.focus());

    this.agents = [];
    this.allAgents = []; // every agent herdr knows plus the usual ones, installed or not: all are offered, and a project may name one this machine lacks
    knownAgents().then((a) => { this.allAgents = agentOptions(a); this.agents = this.allAgents; cx.notify(); }).catch((e) => logError("knownAgents", e));
    initLog();
    this.reload(cx, async () => { const d = await readDemo(); if (d) this.applyDemo(d); });
  }

  /** Wraps a handler: an exception is logged and shown in the popup instead of vanishing. */
  guard(where, fn) {
    return (...a) => {
      try {
        const r = fn(...a);
        if (r && r.catch) r.catch((e) => this.fail(where, e));
        return r;
      } catch (e) { this.fail(where, e); }
    };
  }

  fail(where, e) {
    logError(where, e);
    this.error = `${where}: ${e?.message ?? e}`;
    if (this.mode === "name") this.mode = "list";
    this.cx?.notify();
  }

  reload(cx, after) {
    cx.spawn(async (cx) => {
      try {
        const c = await loadConfig();
        this.projects = c.projects;
        this.layouts = allLayouts(c.layouts);
        this.raw = c.raw;
      } catch (e) {
        logError("load config", e);
        this.error = e.message;
      }
      if (after) await after();
      cx.notify();
      this.loadInfo(cx);
    });
  }

  /** Branch, changed files and worktree count for each project, three at a time so the list stays quick. */
  async loadInfo(cx) {
    const token = (this.infoToken = (this.infoToken ?? 0) + 1);
    const queue = [...this.projects];
    const worker = async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        if (this.infoToken !== token || this.closing) return;
        const folder = projectFolder(p);
        this.info[folder] = await gitSummary(folder);
        // A redraw per answer would repaint the whole list for each project: batch them.
        if (!this.infoPending) {
          this.infoPending = true;
          cx.timer.after(150, () => { this.infoPending = false; cx.notify(); });
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    cx.notify();
  }

  /** Puts the picker in the view a demo file names (see demo.js). */
  applyDemo(d) {
    const project = this.projects.find((p) => p.name === d.project);
    if (d.query != null) this.search.set_value(d.query);
    if (d.detail != null) this.detail = d.detail; // for the screenshot only: not kept
    if (d.layout != null) this.layoutPick = d.layout;
    const at = () => { const i = this.rows().findIndex((r) => r.p === project); this.at = Math.max(0, i); };
    if (d.select != null) this.at = d.select;
    else if (project) at();
    if (d.scrollTo != null) this.cx.timer.after(600, () => { this.scroll.scroll_to_item(d.scrollTo, "top"); this.cx.notify(); });
    if (d.view === "edit") {
      this.edit(project ?? blankProject(), project ? this.projects.indexOf(project) : null);
      if (d.section) this.showSection(d.section);
      if (d.focus) this.fields.find(([k]) => k === d.focus)?.[1].focus();
    } else if (d.view === "delete") this.pendingDelete = project;
    else if (d.view === "name") {
      this.target = project;
      this.askName(project);
      this.nameInput.set_value(d.text ?? "");
      this.cx.timer.after(600, () => this.refreshPreview(this.cx));
    } else if (d.view === "worktrees") {
      this.afterWt = () => { if (d.tick) this.selectMerged(); if (d.confirm) this.wtConfirm = true; };
      this.openWorktrees();
    } else if (d.view === "busy") {
      this.target = project;
      this.mode = "busy";
      this.notes = d.notes ?? [];
    }
  }

  close() { this.closing = true; closeOverlay(this.overlay); }

  query() { return this.search.value(); }

  // ---- list -------------------------------------------------------------

  rows(recent) {
    if (this.frame) return this.frame.rows; // while rendering, every caller gets the same list
    recent ??= shared(RECENT) ?? {};
    const q = this.query();
    const open = spaces().filter((s) => !s.machine); // once, not once per project
    const rows = this.projects.map((p) => {
      const score = Math.max(fuzzy(q, p.name), fuzzy(q, p.group), fuzzy(q, basename(p.path)) - 1);
      const folder = projectFolder(p);
      return { p, score, space: open.find((s) => s.folder === folder), used: recent[p.path] ?? 0 };
    }).filter((r) => r.score >= 0);
    rows.sort((a, b) => q
      ? b.score - a.score
      : (!!b.space - !!a.space) || (b.p.pinned - a.p.pinned) || (b.used - a.used) || a.p.name.localeCompare(b.p.name));
    return rows;
  }

  selected() { return this.rows()[this.at]; }

  /** The layout name a launch of `p` uses: the picked one, else the project's own. */
  layoutNameFor(p) { return this.layoutPick ?? p.startup.layout; }

  /** ctrl+alt+I: shows or hides the detail card; the choice is kept for next time. */
  toggleDetail() {
    this.detail = !this.detail;
    setShared(DETAIL, this.detail);
  }

  /** ctrl+alt+L: the next layout for `p`'s launch (none, then each layout). */
  cycleLayout(p) {
    const next = nextLayout(this.layouts.map((l) => l.name), this.layoutNameFor(p));
    this.layoutPick = next === (p.startup.layout ?? "") ? null : next;
    // The selector stands out for a second so the change is easy to see.
    const flash = (this.layoutFlash = (this.layoutFlash ?? 0) + 1);
    this.layoutLit = true;
    this.cx.timer.after(1000, () => { if (this.layoutFlash === flash) { this.layoutLit = false; this.cx.notify(); } });
  }

  /** Under the list: a hint line with the keys in bold, then the layout selector. It shows every layout with the
   *  one this launch uses lit; for a second after a change the lit one turns bold with an accent ring. */
  footer(t, p, list) {
    const hints = list
      ? [["Click", "selects"], ["Double-click / Enter", "opens"], ["Shift+Enter", "checkout"], [key("n"), "add"], [key("e"), "edit"], [key("w"), "worktrees"], [key("d"), "delete"], [LAYOUT_HINT(), "layout"], [DETAIL_HINT(), this.detail ? "hide details" : "show details"]]
      : [["Enter", "creates"], ["Esc", "back"]];
    const dot = () => div().text_color(t.dim).child("·");
    const current = this.layoutNameFor(p);
    const lit = this.layoutLit;
    const choice = (name, label) => {
      const on = name === current;
      return div().px(10).py(3).rounded(8).border_1().text_size(11.5)
        .border_color(on ? (lit ? t.accent : t.solid) : t.input).bg(on ? t.solid : t.raised)
        .text_color(on ? t.solid_foreground : t.dim).when(on, (el) => (lit ? el.font_bold() : el.font_semibold())).child(label);
    };
    const hintLine = h_flex().gap(6).items_baseline().flex_wrap().text_size(FOOTER_SIZE)
      .children(hints.flatMap(([k, w], i) => [
        ...(i ? [dot()] : []),
        h_flex().gap(4).child(div().font_semibold().text_color(t.foreground).child(k)).child(div().text_color(t.dim).child(w)),
      ]));
    if (list && this.detail) return hintLine; // the detail card has the layout choice
    return v_flex().gap(8)
      .child(hintLine)
      .child(h_flex().gap(6).items_center().flex_wrap().text_size(FOOTER_SIZE)
        .child(div().text_color(t.dim).child("Layout"))
        .child(choice("", "Agent only"))
        .children(this.layouts.map((l) => choice(l.name, l.label ?? l.name)))
        .child(div().flex_1())
        .child(div().px(6).rounded(5).border_1().border_color(t.input).bg(t.raised).text_size(10.5).text_color(t.foreground).child(LAYOUT_HINT())));
  }

  /** A mini icon for an agent entry from herdr's program table (a one-color glyph or a picture). */
  programIcon(t, program, size = 16) {
    const box = div().w(size).h(size).flex_none();
    if (!program?.icon) return box.child(svg("icons/agent.svg").size(size).flex_none().text_color(t.dim));
    return box.child(program.tint ? svg(program.icon).size(size).flex_none().text_color(t.foreground) : image(program.icon).w(size).h(size).flex_none());
  }

  shellIcon(t, size = 16) { return div().w(size).h(size).flex_none().child(svg("icons/shell.svg").size(size).flex_none().text_color(t.dim)); }

  /** The mini icon for what a project starts: its agent (claude, hermes, pi…), the shell icon for a plain
   *  shell, and the generic agent icon for a command herdr has no entry for. */
  agentIcon(t, p, size = 16) {
    const name = commandName(p.startup.agent);
    if (!name) return this.shellIcon(t, size);
    return this.programIcon(t, this.allAgents.find((a) => a.key === name || commandName((a.run ?? []).join(" ")) === name), size);
  }

  /** A project's name with the letters the search matched in bold and the accent color. */
  nameText(t, name) {
    const at = fuzzyPositions(this.query(), name);
    const row = h_flex().text_color(t.foreground).font_medium();
    if (!at.length) return row.child(name);
    return row.children(highlightRuns(name, at).map((r) => r.hit ? div().font_bold().text_color(t.accent).child(r.text) : div().child(r.text)));
  }

  /** Enter (mainOnly false) follows the project's worktree mode; Shift+Enter opens the checkout itself. */
  activate(mainOnly) {
    const r = this.selected();
    if (!r || this.mode !== "list") return;
    this.target = r.p;
    const mode = mainOnly ? "never" : r.p.worktree.mode;
    if (mode === "ask") return this.askName(r.p);
    this.start(r.p, mode === "always");
  }

  askName(p) {
    this.mode = "name";
    this.preview = "";
    this.nameInput = InputState.new({ placeholder: "branch name, e.g. fix login (empty: use the time)" });
    this.nameInput.on("change", (_e, cx) => this.refreshPreview(cx));
    this.nameInput.on("submit", () => this.start(p, true, this.nameInput.value()));
    this.nameInput.focus();
    this.refreshPreview(this.cx);
  }

  refreshPreview(cx) {
    const p = this.target;
    const text = this.nameInput.value();
    // Answers can come back out of order: only the latest request may set the preview.
    const seq = (this.previewSeq = (this.previewSeq ?? 0) + 1);
    cx?.spawn(async (cx) => {
      try {
        const branch = await previewBranch(p, text);
        if (seq !== this.previewSeq) return;
        this.preview = branch;
        this.error = null;
      } catch (e) {
        if (seq !== this.previewSeq) return;
        this.error = e.message;
      }
      cx.notify();
    });
    cx?.notify();
  }

  start(p, worktree, slugText = "") {
    this.mode = "busy";
    this.notes = [];
    this.error = null;
    const log = (m) => { this.notes = [...this.notes, m]; this.cx?.notify(); };
    this.cx?.spawn(async (cx) => {
      try {
        const layoutName = this.layoutNameFor(p);
        const layout = layoutName ? this.layouts.find((l) => l.name === layoutName) : null;
        if (layoutName && !layout) throw new Error(`No layout called "${layoutName}". Layouts: ${this.layouts.map((l) => l.name).join(", ") || "none"}`);
        if (layout) layoutPlan(layout); // a broken layout is reported before anything is created
        let folder = projectFolder(p);
        let name = p.name;
        const existing = findSpace(p);
        if (worktree) {
          const wt = await createWorktree(p, slugText, log);
          folder = wt.folder;
          name = worktreeSpaceName(p, wt);
          await runSetup(p, folder, log);
        } else if (existing) {
          setShared(RECENT, { ...(shared(RECENT) ?? {}), [p.path]: Date.now() });
          this.close();
          return run("space.select", { id: existing.id });
        } else {
          await prepareMain(p, log);
          await runSetup(p, folder, log);
        }
        setShared(RECENT, { ...(shared(RECENT) ?? {}), [p.path]: Date.now() });
        if (p.startup.agent.trim() && p.startup.prompt && p.startup.promptMode === "send") log("Waiting for the agent to be ready for its prompt…");
        // Stay open until the prompt is sent: closing the popup cancels this task.
        await launch(p, folder, name, layout);
        this.close();
      } catch (e) {
        logError("open project", e);
        this.error = e.message;
        cx.notify();
      }
    });
  }

  // ---- editor -----------------------------------------------------------

  edit(project, index) {
    try { this.openEditor(project, index); } catch (e) { logError("editor", e); this.mode = "list"; this.error = `Editor failed: ${e.message}`; }
    this.cx?.notify();
  }

  openEditor(project, index) {
    this.mode = "edit";
    this.index = index; // null: new
    this.draft = JSON.parse(JSON.stringify(project));
    this.error = null;
    this.confirmDelete = false;
    this.fields = TEXT.map(([key, , get]) => {
      const s = InputState.new({ value: get(this.draft) ?? "" });
      s.on("focus", () => (this.field = key));
      return [key, s];
    });
    this.section = "project";
    this.fields[0][1].focus();
  }

  showSection(id) {
    this.section = id;
    this.field = SECTION_FIELDS[id][0];
    const state = this.fields.find(([k]) => k === this.field)[1];
    this.cx.timer.after(80, () => state.focus()); // once its input is on screen
    this.cx.notify();
  }

  async browse(cx) {
    const dir = await pickFolder({ prompt: "Use this folder" });
    if (!dir) return;
    this.fields.find(([k]) => k === "path")[1].set_value?.(dir);
    this.draft.path = dir;
    const name = this.fields.find(([k]) => k === "name")[1];
    if (!name.value()) name.set_value?.(basename(dir));
    cx.notify();
  }

  async save(cx) {
    try {
      for (const [key, state] of this.fields) TEXT.find(([k]) => k === key)[3](this.draft, key === "path" ? state.value() : state.value().trim());
      const d = this.draft;
      if (!d.name) throw new Error("Give the project a name");
      await inspect(projectFolder(d));
      const list = [...this.projects];
      if (this.index == null) list.push(d); else list[this.index] = d;
      this.raw = await saveConfig(list, this.raw);
      this.projects = list;
      this.mode = "list";
      this.error = null;
      this.search.focus();
    } catch (e) {
      logError("save", e);
      this.error = e.message;
    }
    cx.notify();
  }

  async remove(cx) {
    if (!this.confirmDelete) { this.confirmDelete = true; return cx.notify(); }
    try {
      const list = this.projects.filter((_p, i) => i !== this.index);
      this.raw = await saveConfig(list, this.raw);
      this.projects = list;
      this.mode = "list";
      this.search.focus();
    } catch (e) { logError("delete", e); this.error = e.message; }
    cx.notify();
  }

  focusNextField(back) {
    const keys = SECTION_FIELDS[this.section];
    const i = keys.indexOf(this.field);
    this.field = keys[(i + (back ? -1 : 1) + keys.length) % keys.length];
    this.fields.find(([k]) => k === this.field)[1].focus();
  }

  editSelected() {
    const r = this.selected();
    if (r) this.edit(r.p, this.projects.indexOf(r.p));
  }

  // ---- delete project ---------------------------------------------------

  /** First press asks, the second removes the project from the list (its folder and worktrees stay). */
  deleteSelected() {
    const r = this.selected();
    if (!r) return;
    if (this.pendingDelete !== r.p) { this.pendingDelete = r.p; this.error = null; return; }
    const list = this.projects.filter((p) => p !== r.p);
    this.pendingDelete = null;
    saveConfig(list, this.raw).then((raw) => { this.raw = raw; this.projects = list; this.cx.notify(); }).catch((e) => this.fail("delete project", e));
  }

  // ---- worktree cleanup -------------------------------------------------

  openWorktrees() {
    const r = this.selected();
    if (!r) return;
    this.target = r.p;
    this.mode = "worktrees";
    this.wts = null;
    this.wtSel = new Set();
    this.wtAt = 0;
    this.wtConfirm = false;
    this.error = null;
    this.wtSearch = InputState.new({ placeholder: "Filter worktrees…" });
    this.wtSearch.on("change", (_e, cx) => { this.wtAt = 0; cx.notify(); });
    this.wtSearch.on("submit", () => { if (Date.now() - (this.handled ?? 0) > 200) this.toggleWt(); });
    this.wtSearch.focus();
    this.loadWorktrees();
  }

  loadWorktrees() {
    this.cx.spawn(async (cx) => {
      try { this.wts = await listWorktrees(this.target); } catch (e) { this.wts = []; logError("list worktrees", e); this.error = e.message; }
      this.afterWt?.();
      this.afterWt = null;
      cx.notify();
    });
  }

  wtRows() {
    const q = this.wtSearch?.value() ?? "";
    return (this.wts ?? []).filter((w) => fuzzy(q, `${w.branch ?? ""} ${basename(w.path)}`) >= 0);
  }

  toggleWt() {
    const w = this.wtRows()[this.wtAt];
    if (!w) return;
    this.wtConfirm = false;
    if (this.wtSel.has(w.path)) this.wtSel.delete(w.path); else this.wtSel.add(w.path);
  }

  selectMerged() {
    this.wtConfirm = false;
    const mergedClean = (this.wts ?? []).filter((w) => w.merged && !w.dirty && !w.locked);
    const all = mergedClean.every((w) => this.wtSel.has(w.path));
    for (const w of mergedClean) all ? this.wtSel.delete(w.path) : this.wtSel.add(w.path);
  }

  /** First press asks for confirmation, the second removes the ticked worktrees one by one. */
  removeSelected() {
    const chosen = (this.wts ?? []).filter((w) => this.wtSel.has(w.path));
    if (!chosen.length) return;
    if (!this.wtConfirm) { this.wtConfirm = true; return; }
    this.wtConfirm = false;
    this.error = null;
    this.cx.spawn(async (cx) => {
      const failed = [];
      for (const w of chosen) {
        try { await removeWorktree(this.target, w); log("debug", "removed worktree", { path: w.path }); } catch (e) { logError("remove worktree", e); failed.push(e.message); }
      }
      this.wtSel = new Set();
      this.error = failed.length ? failed.join("\n") : null;
      try { this.wts = await listWorktrees(this.target); } catch {}
      cx.notify();
    });
  }

  // ---- keys -------------------------------------------------------------

  keys(e, cx) {
    const k = e.key;
    const ctrl = e.modifiers.control;
    const mod = ctrl || e.modifiers.alt || e.modifiers.platform; // ctrl, alt or cmd
    const layoutMod = e.modifiers.alt && (ctrl || e.modifiers.platform);
    if (this.pendingDelete && k !== "d") this.pendingDelete = null;
    if (k === "escape") {
      if (this.mode === "list") this.close();
      else if (this.mode === "busy" && !this.error) return;
      else { this.mode = "list"; this.error = null; this.search.focus(); }
    } else if (this.mode === "list") {
      const n = this.rows().length;
      if (k === "down" && n) { this.at = (this.at + 1) % n; this.revealRow(); }
      else if (k === "up" && n) { this.at = (this.at + n - 1) % n; this.revealRow(); }
      else if (k === "enter" && e.modifiers.shift) { this.handled = Date.now(); this.activate(true); }
      else if (k === "d" && mod) this.deleteSelected();
      else if (k === "w" && mod) this.openWorktrees();
      else if (k === "n" && mod) this.edit(blankProject(), null);
      else if (k === "l" && layoutMod) this.cycleLayout(this.selected()?.p ?? blankProject());
      else if (k === "i" && layoutMod) this.toggleDetail();
      else if (k === "e" && mod) this.editSelected();
      else return;
    } else if (this.mode === "name" && k === "l" && layoutMod) this.cycleLayout(this.target);
    else if (this.mode === "worktrees") {
      const n = this.wtRows().length;
      if (k === "down" && n) { this.wtAt = (this.wtAt + 1) % n; this.reveal("pp-worktrees", this.wtScroll, this.wtAt); }
      else if (k === "up" && n) { this.wtAt = (this.wtAt + n - 1) % n; this.reveal("pp-worktrees", this.wtScroll, this.wtAt); }
      else if (k === "enter") { this.handled = Date.now(); this.toggleWt(); }
      else if (k === "m" && mod) this.selectMerged();
      else if (k === "r" && mod) this.removeSelected();
      else return;
    } else if (this.mode === "edit" && k === "tab") this.focusNextField(e.modifiers.shift);
    else if (this.mode === "edit" && k === "s" && mod) this.save(cx);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  // ---- render -----------------------------------------------------------

  render() {
    const cx = this.cx;
    const t = theme();
    platformCache = undefined;
    this.frame = null;
    const recent = shared(RECENT) ?? {};
    this.frame = { rows: this.mode === "list" ? this.rows(recent) : [], colors: shared("space.colors"), recent };
    let body;
    try {
      body = { list: () => this.renderList(t, cx), edit: () => this.renderEdit(t, cx), worktrees: () => this.renderWorktrees(t, cx), name: () => this.renderName(t), busy: () => this.renderBusy(t) }[this.mode]();
    } finally {
      this.frame = null;
    }
    return v_flex().id("project-presets").track_focus(this.handle).w_full().min_h(0).p(18).gap(10).bg(t.popover).text_size(13)
      .on_key_down(this.guard("key", (e, cx) => { log("debug", "key", { key: e.key, mods: e.modifiers, mode: this.mode }); this.keys(e, cx); }))
      .child(body);
  }

  /** A scrolling list of 48px rows: wheel and scrollbar work, and `reveal` keeps the highlight in view. */
  vlist(id, rows, render, handle, max, keyOf, onClick, sizes = null) {
    const total = sizes ? sizes.reduce((a, b) => a + b, 0) : rows.length * ROW;
    const height = Math.min(max, total);
    this.ranges[id] = { ...(this.ranges[id] ?? { start: 0, end: 0 }), visible: Math.max(1, Math.floor(height / ROW)) };
    return div().relative().flex_none().w_full().h(height).min_h(0)
      .child(v_virtual_list(id, rows.length, sizes ?? ROW, (i) => keyOf(rows[i], i), (range) => {
        Object.assign(this.ranges[id], { start: range.start, end: range.end });
        return rows.slice(range.start, range.end).map((r, j) => render(r, range.start + j));
      }).track_scroll(handle).on_item_click(this.guard("row click", (key, cx) => onClick(key, cx))).size_full())
      .when(total > height, (el) => el.child(Scrollbar.vertical(id).viewport_from_layout().absolute().inset_0()));
  }

  /** Keeps the highlighted project in view (section headers count as list items). */
  revealRow() {
    const at = listItems(this.rows(), Boolean(this.query())).findIndex((it) => it.row && it.index === this.at);
    if (at >= 0) this.reveal("pp-projects", this.scroll, at);
  }

  /** Scrolls only when row `at` is outside what is showing. */
  reveal(id, handle, at) {
    const r = this.ranges[id];
    if (!r) return;
    if (at < r.start) handle.scroll_to_item(at, "top");
    else if (at >= r.start + r.visible) handle.scroll_to_item(Math.max(0, at - r.visible + 1), "top");
  }

  button(t, id, text, primary, action, lead = null) {
    return h_flex().id(id).gap(lead ? 6 : 0).h(32).px(14).items_center().rounded(8).border_1()
      .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(this.guard(`button ${id}`, (...a) => { log("debug", "click", { id }); return action(...a); }))
      .when(Boolean(lead), (el) => el.child(lead)).child(text);
  }

  title(t, text, hint) {
    return h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child(text))
      .child(div().text_size(11).text_color(t.dim).child(hint));
  }

  /** The project's avatar, drawn like herdr's sidebar draws a space's: a tile in the space's own color with the
   *  initial. A project with no open space gets an outline in no color. */
  avatar(t, p, space, size = 18) {
    const tile = h_flex().size(size).flex_none().rounded(5).items_center().justify_center().text_size(size * 0.58).font_bold();
    const initial = [...(p.name ?? "")][0]?.toUpperCase() ?? "?";
    if (!space) return tile.border_1().border_color(t.input).text_color(t.dim).child(initial);
    return tile.bg(spaceColor(this.frame ? this.frame.colors : shared("space.colors"), space.id, t)).text_color("#ffffff").child(initial);
  }

  /** A small outlined label. */
  tag(t, text, color, border = color) {
    return div().px(8).rounded(10).border_1().border_color(border).text_size(10.5).text_color(color).flex_none().child(text);
  }

  /** The selected project's mini picture of a layout's panes: the agent's pane lit when this is the one chosen. */
  layoutThumb(t, layout, on, w = 72, h = 38) {
    const box = div().relative().w(w).h(h).flex_none();
    layoutRects(layout).forEach((r, i) => box.child(div().absolute().left(r.x * w + 1).top(r.y * h + 1).w(r.w * w - 2).h(r.h * h - 2).rounded(3).bg(i === 0 && on ? t.accent : on ? t.selected : t.input)));
    return box;
  }

  /** Worktrees, Edit and Delete for the highlighted project: in the detail card, or under the list without it. */
  actionButtons(t, cx) {
    return h_flex().gap(8).items_center()
      .child(this.button(t, "pp-wt", "Worktrees", false, () => { this.openWorktrees(); cx.notify(); }))
      .child(this.button(t, "pp-edit", "Edit", false, () => { this.editSelected(); cx.notify(); }))
      .child(this.button(t, "pp-delete", this.pendingDelete ? "Delete?" : "Delete", false, () => { this.deleteSelected(); cx.notify(); }));
  }

  /** The detail card: what the highlighted project is, what Enter will do, and the layout choice. */
  renderCard(t, r, cx) {
    const card = v_flex().w(CARD).flex_none().gap(10).p(14).rounded(12).border_1().border_color(t.input).bg(t.raised);
    if (!r) return card.child(div().text_color(t.dim).text_size(12).child("Nothing selected."));
    const p = r.p;
    const folder = projectFolder(p);
    const info = this.info[folder];
    const name = commandName(p.startup.agent);
    const program = name && this.allAgents.find((a) => a.key === name || commandName((a.run ?? []).join(" ")) === name);
    const kv = (k, v) => h_flex().gap(10).items_start().text_size(12)
      .child(div().w(84).flex_none().text_color(t.dim).child(k))
      .child(div().flex_1().min_w(0).text_color(t.foreground).child(v));
    const current = this.layoutNameFor(p);
    const choices = [{ name: "", label: "Agent only", panes: [{ type: "agent" }] }, ...this.layouts];
    const [what, openLabel] = enterAction(p.worktree.mode);
    const shown = choices.find((c) => c.name === current);
    const dirtyText = info == null ? "…" : info.dirty ? `${info.dirty} file${info.dirty > 1 ? "s" : ""} modified` : "clean";
    return card
      .child(h_flex().gap(10).items_center().flex_wrap()
        .child(this.avatar(t, p, r.space, 24))
        .child(div().text_size(16).font_semibold().text_color(t.foreground).child(p.name))
        .when(Boolean(r.space), (el) => el.child(this.tag(t, r.space.status === "working" ? "agent working" : "open", r.space.status === "working" ? t.working : t.done)))
        .when(p.pinned, (el) => el.child(this.tag(t, "pinned", t.dim, t.input))))
      .child(v_flex().gap(4)
        .child(kv("Agent", h_flex().gap(6).items_center().child(this.agentIcon(t, p, 14)).child(div().child(program?.name ?? (name || "plain shell")))))
        .when(Boolean(p.group), (el) => el.child(kv("Group", p.group)))
        .child(kv("Branch", info?.branch ?? "…"))
        .child(kv("Changes", info?.dirty ? div().text_color(t.working).child(dirtyText) : dirtyText))
        .child(kv("Worktrees", info == null ? "…" : String(info.worktrees)))
        .child(kv("Last opened", ago((this.frame?.recent ?? shared(RECENT) ?? {})[p.path]))))
      .child(v_flex().gap(6)
        .child(h_flex().items_center().child(div().flex_1().text_size(10.5).font_semibold().text_color(t.dim).child(`LAYOUT${this.layoutPick !== null ? " · PICKED" : ""}`))
          .child(div().px(6).rounded(5).border_1().border_color(t.input).text_size(10.5).text_color(t.foreground).child(LAYOUT_HINT())))
        .child(h_flex().gap(8).items_start().flex_wrap().children(choices.map((c, i) => {
          const on = c.name === current;
          const lit = on && this.layoutLit;
          return v_flex().id(`pp-lay-${i}`).gap(4).p(6).rounded(9).border_1().cursor_pointer()
            .border_color(on ? (lit ? t.accent : t.solid) : t.input).bg(on ? t.selected : t.background)
            .on_click(this.guard("layout click", () => { this.layoutPick = c.name === (p.startup.layout ?? "") ? null : c.name; cx.notify(); }))
            .child(this.layoutThumb(t, c, on))
            .child(div().text_size(10.5).max_w(72).text_color(on ? t.foreground : t.dim).when(on, (el) => (lit ? el.font_bold() : el.font_semibold())).child(c.label ?? c.name))
            .when(c.name === (p.startup.layout ?? ""), (el) => el.child(div().text_size(9.5).text_color(t.dim).child("project default")));
        }))))
      .child(div().text_size(12).text_color(t.dim).child(`Enter ${what}${shown && shown.name ? ` and opens ${(shown.label ?? shown.name).toLowerCase()}` : " and opens the agent alone"}.`))
      .child(h_flex().gap(8).items_center()
        .child(this.button(t, "pp-open", openLabel, true, () => { this.activate(false); cx.notify(); }))
        .child(this.button(t, "pp-checkout", "Checkout", false, () => { this.activate(true); cx.notify(); })))
      .child(this.actionButtons(t, cx));
  }

  /** Under the list: the hints and the layout choice, then the buttons. With the card its buttons are in the card, so
   *  only Hide details and Add project share the hints' row; without it the hints get a row of their own. */
  listFooter(t, cx, rows) {
    const p = this.selected()?.p ?? blankProject();
    const details = this.button(t, "pp-details", this.detail ? "Hide details" : "Show details", false, () => { this.toggleDetail(); cx.notify(); });
    const add = this.button(t, "pp-add", "Add project", true, () => { this.edit(blankProject(), null); cx.notify(); });
    if (this.detail) return h_flex().gap(12).items_center().child(div().flex_1().min_w(0).child(this.footer(t, p, true))).child(details).child(add);
    return v_flex().gap(10)
      .child(this.footer(t, p, true))
      .child(h_flex().gap(8).items_center().justify_end()
        .when(rows.length > 0, (el) => el.child(this.actionButtons(t, cx)))
        .child(div().flex_1())
        .child(details)
        .child(add));
  }

  renderList(t, cx) {
    const rows = this.rows();
    if (this.at >= rows.length) this.at = Math.max(0, rows.length - 1);
    const projectKey = (r) => `${r.p.name}\u0000${r.p.path}`;
    const items = listItems(rows, Boolean(this.query()));
    const stripe = (r) => (r.space ? (t[r.space.status] ?? t.done) : null);
    const row = (r, i) => {
      const on = i === this.at;
      const info = this.info[projectFolder(r.p)];
      return h_flex().id(`pp-${i}`).relative().w_full().h(ROW).flex_none().overflow_hidden().pl(14).pr(12).gap(10).items_center().rounded(8).cursor_pointer()
        .when(on, (el) => el.bg(t.selected))
        .when(Boolean(r.space), (el) => el.child(div().absolute().left(0).top(9).w(3).h(ROW - 18).rounded(2).bg(stripe(r))
          .when(r.space.status === "working", (e) => e.loop("opacity", { from: 1, to: 0.35, period: 1000 }))))
        .child(this.avatar(t, r.p, r.space))
        .child(this.agentIcon(t, r.p))
        .child(v_flex().flex_1().min_w(0)
          .child(this.nameText(t, r.p.name))
          .child(div().text_size(11).text_color(t.dim).truncate().child(shortHome(projectFolder(r.p), homeOf()))))
        .when(Boolean(r.p.group), (el) => el.child(div().text_size(11).text_color(t.dim).child(r.p.group)))
        .when(Boolean(info), (el) => el.child(h_flex().gap(5).flex_none()
          .child(this.tag(t, info.branch, t.dim, t.input))
          .when(info.dirty > 0, (e) => e.child(this.tag(t, `${info.dirty} changed`, t.working)))
          .when(info.worktrees > 0, (e) => e.child(this.tag(t, `${info.worktrees} wt`, t.accent)))));
    };
    const item = (it, i) => it.header
      ? div().w_full().h(HEADER).flex_none().px(14).pb(3).flex().items_end().text_size(10.5).font_semibold().text_color(t.dim).child(it.header.toUpperCase())
      : row(it.row, it.index);
    const list = this.vlist("pp-projects", items, item, this.scroll, this.detail ? 420 : 330, // shorter without the card: its footer is three rows tall
       (it) => (it.header ? `header:${it.header}` : projectKey(it.row)), (key, cx) => {
      const i = rows.findIndex((r) => projectKey(r) === key);
      if (i < 0) return;
      const double = this.lastClick?.key === key && Date.now() - this.lastClick.at < 450;
      this.lastClick = { key, at: Date.now() };
      log("debug", "click row", { i, double });
      this.at = i;
      if (double) this.activate(false); else cx.notify();
    }, items.map((it) => (it.header ? HEADER : ROW)));
    return v_flex().gap(10).min_h(0)
      .child(this.title(t, "Projects", "Esc"))
      .child(h_flex().h(36).flex_none().px(10).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.search).flex_1().h_full().text_size(12.8).text_color(t.foreground))
        .child(div().text_size(11).text_color(t.dim).child(`${rows.length} of ${this.projects.length}`)))
      .child(this.error ? div().text_size(12).text_color(t.blocked).child(this.error) : div())
      .child(h_flex().gap(14).items_start().min_h(0)
        .child(v_flex().flex_1().min_w(0).gap(6)
          .child(list)
          .when(!rows.length, (el) => el.child(div().py(14).text_color(t.dim).child(this.projects.length ? "No project matches." : "No projects yet. Click Add project below a git checkout."))))
        .when(this.detail, (el) => el.child(this.renderCard(t, this.selected(), cx))))
      .when(Boolean(this.pendingDelete), (el) => el.child(div().text_size(12).text_color(t.blocked).child(`Remove "${this.pendingDelete.name}" from the list? Press ${key("d")} again or click Delete. The folder and its worktrees stay.`)))
      .child(this.listFooter(t, cx, rows));
  }

  renderWorktrees(t, cx) {
    const rows = this.wtRows();
    if (this.wtAt >= rows.length) this.wtAt = Math.max(0, rows.length - 1);
    const count = this.wtSel.size;
    const row = (w, i) => h_flex().id(`pp-wt-${i}`).w_full().h(48).flex_none().overflow_hidden().px(12).gap(10).items_center().rounded(8).cursor_pointer()
      .when(i === this.wtAt, (el) => el.bg(t.selected))
      .child(div().w(14).flex_none().text_color(this.wtSel.has(w.path) ? t.accent : t.dim).child(this.wtSel.has(w.path) ? "☑" : "☐"))
      .child(v_flex().flex_1().min_w(0)
        .child(div().text_color(t.foreground).font_medium().truncate().child(w.branch ?? "(detached)"))
        .child(div().text_size(11).text_color(t.dim).truncate().child(shortHome(w.path, homeOf()))))
      .when(Boolean(w.space), (el) => el.child(div().text_size(11).text_color(t.dim).child("open")))
      .when(w.dirty, (el) => el.child(div().text_size(11).text_color(t.blocked).child("uncommitted")))
      .when(w.locked, (el) => el.child(div().text_size(11).text_color(t.blocked).child("locked")))
      .child(div().text_size(11).text_color(w.merged ? t.done : t.dim).child(w.merged ? "merged" : "unmerged"));
    return v_flex().gap(10).min_h(0)
      .child(this.title(t, `Worktrees · ${this.target.name}`, "Esc back"))
      .child(h_flex().h(36).flex_none().px(10).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.wtSearch).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
      .child(this.vlist("pp-worktrees", rows, row, this.wtScroll, 340, (w) => w.path, (key, cx) => {
        const i = rows.findIndex((w) => w.path === key);
        if (i < 0) return;
        this.wtAt = i;
        this.toggleWt();
        cx.notify();
      }))
      .when(this.wts === null, (el) => el.child(div().py(14).text_color(t.dim).child("Looking at worktrees…")))
      .when(this.wts !== null && !rows.length, (el) => el.child(div().py(14).text_color(t.dim).child(this.wts.length ? "No worktree matches." : "No worktrees besides the main checkout.")))
      .when(this.wtConfirm, (el) => el.child(div().text_size(12).text_color(t.blocked).child(`Remove ${count} worktree${count > 1 ? "s" : ""}${[...(this.wts ?? [])].some((w) => this.wtSel.has(w.path) && w.space) ? ", and close their spaces" : ""}? Merged branches are deleted too. Press ${key("r")} again or click.`)))
      .child(div().text_size(11).text_color(t.dim).child(`Enter tick · ${key("m")} tick all merged · ${key("r")} remove ticked. Worktrees with uncommitted changes are refused.`))
      .child(h_flex().gap(8).items_center().justify_end()
        .child(this.button(t, "pp-wt-merged", "Tick merged", false, () => { this.selectMerged(); cx.notify(); }))
        .child(this.button(t, "pp-wt-remove", this.wtConfirm ? `Click again to remove ${count}` : `Remove ${count} ticked`, count > 0, () => { this.removeSelected(); cx.notify(); })));
  }

  renderName(t) {
    const p = this.target;
    return v_flex().gap(10)
      .child(this.title(t, `New worktree · ${p.name}`, "Esc back"))
      .child(h_flex().h(36).px(10).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.nameInput).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .child(div().text_size(12).text_color(this.error ? t.blocked : t.dim).child(this.error ?? (this.preview ? `branch: ${this.preview}` : "")))
      .child(div().text_size(FOOTER_SIZE).text_color(t.dim).child(`from ${p.git.remote}/${p.git.base}${p.git.fetch ? " after a fetch" : ""} · Enter to create`))
      .child(this.footer(t, p, false));
  }

  /** The busy screen's steps: done ones get a ✓, the current one a spinner (or a ✗ once it failed). */
  stepRows(t) {
    const notes = this.notes.length ? this.notes : ["Starting…"];
    const mark = (i) => {
      const last = i === notes.length - 1;
      if (!last) return div().text_color(t.done).child("✓");
      if (this.error) return div().text_color(t.blocked).child("✗");
      return div().text_color(t.accent).frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 80).child("⠋");
    };
    return notes.map((n, i) => h_flex().gap(8).items_baseline().text_size(12)
      .child(mark(i).w(12).flex_none())
      .child(div().flex_1().min_w(0).text_color(i === notes.length - 1 && !this.error ? t.foreground : t.dim).child(n)));
  }

  renderBusy(t) {
    return v_flex().gap(8)
      .child(this.title(t, this.target.name, this.error ? "Esc back" : "working…"))
      .child(v_flex().gap(3).children(this.stepRows(t)))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12.5).text_color(t.blocked).child(this.error)));
  }

  renderEdit(t, cx) {
    const d = this.draft;
    const label = (text, note) => h_flex().gap(8).items_baseline().pt(10).pb(5)
      .child(div().text_size(11.5).text_color(t.dim).child(text))
      .when(Boolean(note), (el) => el.child(div().text_size(10.5).text_color(t.muted ?? t.dim).child(note)));
    const field = (key) => {
      const [, name, , , note] = TEXT.find(([k]) => k === key);
      const state = this.fields.find(([k]) => k === key)[1];
      return v_flex().child(label(name, note))
        .child(Input.new(state).h(34).px(10).rounded(8).border_1().border_color(this.field === key ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground));
    };
    const agentState = () => this.fields.find(([k]) => k === "agent")[1];
    const chip = (id, text, value, lead, dim) => this.button(t, id, text, agentState().value().trim() === value, () => { agentState().set_value(value); this.draft.startup.promptMode = /^hermes\b/.test(value) ? "send" : "arg"; cx.notify(); }, lead).when(dim, (el) => el.opacity(0.6));
    const toggle = (id, text, value, set) => this.button(t, id, `${value ? "✓" : "○"} ${text}`, false, () => { set(!value); cx.notify(); });
    const sections = {
      project: () => [
        field("name"),
        field("path"),
        h_flex().pt(6).gap(8).child(this.button(t, "pp-browse", "Browse…", false, () => this.browse(cx))),
        field("group"),
        h_flex().pt(10).child(toggle("pp-pin", "Pin to top", d.pinned, (v) => (d.pinned = v))),
      ],
      worktree: () => [
        h_flex().pt(10).gap(8).items_center()
          .child(this.button(t, "pp-mode", `Worktree: ${d.worktree.mode}`, false, () => { d.worktree.mode = MODES[(MODES.indexOf(d.worktree.mode) + 1) % MODES.length]; cx.notify(); }))
          .child(div().text_size(11.5).text_color(t.dim).child(MODE_HELP[d.worktree.mode])),
        field("branchTemplate"),
        field("root"),
        field("spaceName"),
        h_flex().pt(12).gap(8).items_center()
          .child(toggle("pp-repospace", "Open the repo's space first", d.worktree.repoSpace, (v) => (d.worktree.repoSpace = v)))
          .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.dim).child("worktrees then nest under it in the sidebar")),
      ],
      git: () => [
        h_flex().pt(10).gap(8)
          .child(toggle("pp-fetch", "Fetch first", d.git.fetch, (v) => (d.git.fetch = v)))
          .child(toggle("pp-ff", "Fast-forward checkout", d.git.fastForward, (v) => (d.git.fastForward = v))),
        field("remote"),
        field("base"),
      ],
      startup: () => [
        label("Agent"),
        h_flex().flex_wrap().gap(6)
          .child(chip("pp-agent-shell", "Shell", "", this.shellIcon(t, 14), false))
          .children(this.agents.map((a, i) => chip(`pp-agent-${i}`, a.name, a.run.join(" "), this.programIcon(t, a, 14), a.installed === false))),
        field("agent"),
        field("args"),
        field("prompt"),
        h_flex().pt(8).gap(8).items_center()
          .child(this.button(t, "pp-pmode", `Prompt: ${d.startup.promptMode === "send" ? "typed after start" : "command-line argument"}`, false, () => { d.startup.promptMode = d.startup.promptMode === "send" ? "arg" : "send"; cx.notify(); }))
          .child(div().text_size(11.5).text_color(t.dim).child(d.startup.promptMode === "send" ? "for agents that reject a prompt argument" : "claude and most agents")),
        field("layout"),
        field("setup"),
        field("tabs"),
      ],
    };
    return v_flex().gap(0).min_h(0)
      .child(this.title(t, this.index == null ? "Add project" : "Edit project", `Tab next field · ${key("s", "ctrl")} save · Esc back`))
      .child(h_flex().pt(10).gap(6)
        .children(SECTIONS.map(([id, name]) => this.button(t, `pp-sec-${id}`, name, this.section === id, () => this.showSection(id)))))
      .child(v_flex().min_h(0).h(430).overflow_y_scrollbar().pr(8).children(sections[this.section]()))
      .child(this.error ? div().pt(8).text_size(12).text_color(t.blocked).child(this.error) : div())
      .child(h_flex().pt(12).gap(8).justify_end()
        .when(this.index != null, (el) => el.child(this.button(t, "pp-del", this.confirmDelete ? "Click again to delete" : "Delete", false, () => this.remove(cx))))
        .child(div().flex_1())
        .child(this.button(t, "pp-cancel", "Cancel", false, () => { this.mode = "list"; this.error = null; this.search.focus(); cx.notify(); }))
        .child(this.button(t, "pp-save", "Save", true, () => this.save(cx))));
  }
}
