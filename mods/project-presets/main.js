// Project Presets: a picker of configured git checkouts, each with its own worktree and startup
// settings. Type to filter, ↑/↓ and Enter to open, Shift+Enter for the main checkout, Add project / Edit / Worktrees / Delete
// buttons (or alt/ctrl/cmd + n, e, w, d), alt+b (cmd+alt+B on a Mac) to go back a screen. Herdr itself closes a popup on Esc and
// never passes that key to the mod, so Esc can only close the picker.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, VirtualListScrollHandle, v_virtual_list } from "gpui-base";
import { exec, knownAgents, window, theme, props, closeOverlay, run, pickFolder, shared, setShared, home, spaces, readTextFile, writeTextFile, layout, layouts, appHome } from "herdr";
import { loadConfig, saveConfig, dataFilePath, loadTrust, saveTrust } from "./config.js";
import { inspect, projectFolder, previewBranch, createWorktree, worktreeSpaceName, listWorktrees, removeWorktree, prepareMain, runSetup, findSpace, launch, gitSummary, folderExists, scanFolder, detectBase, writeRepoFile, mapLimit } from "./git.js";
import { readDemo } from "./demo.js";
import { initLog, log, logError } from "./log.js";
import { fuzzy, blankProject, shortHome, splitList, joinList, basename, allLayouts, nextLayout, layoutPlan, fuzzyPositions, highlightRuns, commandName, agentOptions, ago, listItems, layoutRects, enterAction, spaceColor, defaultTemplate, duplicateProject, startFromTemplate, expandHome, exportData, parseBackup, mergeProjects, mergeLayouts, exportFileName, withLauncherBlocks, templateChanges, applyTemplateChanges, PRESET_FILE, parseRepoPreset, applyRepoPreset, presetSummary, repoPresetOf, normalizeScan, dropNested, discoveredProject, savedProject, SCAN_MAX } from "./lib.js";

const RECENT = "project-presets.recent";
const EXPORT_DIR = "~/Downloads";
const LAUNCHER = "project-presets.launcher"; // where the clickable open button sits: sidebar (the default), status, tabs or off
const LAUNCHERS = [["sidebar", "sidebar"], ["status", "status bar"], ["tabs", "tab bar"], ["off", "off"]];
/** The launcher blocks the shown layout has (ids "pp-launch-<slot>"). A layout without them, such as herdr's own, has none. */
const launcherBlocks = () => {
  const found = [];
  const walk = (n) => { if (n?.id?.startsWith("pp-launch-")) found.push(n.id); (n?.children ?? []).forEach(walk); };
  walk(layout());
  return found;
};
const DETAIL = "project-presets.detail"; // false: hide the detail card (kept between sessions)
// Shortcut hints: ⌘ on macOS (Option+letter types a character there), alt elsewhere.
// The platform, copied from herdr with the rest of the snapshot (see takeSnapshot).
let platformNow = "";
const mac = () => platformNow === "macos";
let homeDir;
const homeOf = () => (homeDir ??= home());
const key = (letter, other = "alt") => (mac() ? `⌘${letter.toUpperCase()}` : `${other}+${letter}`);
/** The way back a screen. Herdr closes a popup on Esc itself, and it owns cmd+B on a Mac, so a Mac gets the cmd+alt chord (like the layout and details keys). */
const backKey = () => (mac() ? "⌘⌥B" : "alt+b");
// Herdr binds a bare alt+l to moving between panes, so the layout key needs ctrl (⌘ on macOS) as well, like the open key.
const FOOTER_SIZE = 11.5;
const LAYOUT_HINT = () => (mac() ? "⌘⌥L" : "ctrl+alt+L");
const DETAIL_HINT = () => (mac() ? "⌘⌥I" : "ctrl+alt+I");

// Sizes are written as designed and go through z(), which applies the person's text size (Settings).
const SCALE = "project-presets.scale"; // the text size as a share of the designed one (kept between sessions)
const SCALES = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5];
let scaleNow = 1;
const z = (n) => Math.round(n * scaleNow * 10) / 10;
/** A stored text size, brought to one of the offered steps; anything else is 100%. */
const validScale = (v) => (SCALES.includes(v) ? v : 1);
const ROW = () => z(48);
const HEADER = () => z(30); // a section header in the project list
const CARD = () => z(340); // the detail card's width
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

/** folder → { info, at }: git answers kept between openings of the picker, so rows show their details at once. */
const infoCache = new Map();
const INFO_FRESH_MS = 15000; // a younger answer isn't asked for again
const infoGen = new Map(); // folder → how many times its git state was changed through the picker
/** The picker changed this folder's worktrees: forget its answer, and let any read already under way know its answer is old. */
const invalidate = (folder) => { infoCache.delete(folder); infoGen.set(folder, (infoGen.get(folder) ?? 0) + 1); };

/** What the last folder scan found, kept between openings of the picker: [{ folder, presetText }] for the scan
 *  settings in `key`. A younger answer is shown as it is; an older one is shown and refreshed behind the list. */
const scanCache = { key: "", at: 0, found: [] };
const SCAN_FRESH_MS = 30000;
const PRESET_STATE = { used: "repo preset", review: "repo preset: review", ignored: "repo preset ignored", error: "repo preset: error" };

export default class ProjectPresets extends View {
  static infoCache = infoCache; // the tests reach in to forget an answer
  static scanCache = scanCache;
  static invalidate = invalidate;
  init(_props, cx) {
    this.cx = cx;
    this.scroll = VirtualListScrollHandle.new();
    this.wtScroll = VirtualListScrollHandle.new();
    this.ranges = {};
    this.overlay = props()?.overlay;
    this.projects = [];
    this.virtualTemplate = null; // the default template, shown until it is saved or deleted (see syncTemplate)
    this.hideTemplate = false;
    this.layouts = [];
    this.userLayouts = []; // the layouts in the data file (this.layouts also has the built-in ones)
    this.refreshSnap();
    cx.timer.every(3000, (cx) => { if (this.refreshSnap()) cx.notify(); });
    scaleNow = validScale(shared(SCALE));
    this.detail = shared(DETAIL) !== false; // the detail card beside the list (ctrl+alt+I turns it off)
    this.gitInfo = true;
    this.scan = normalizeScan(); // the folders to look for checkouts in (the data file's `scan`)
    this.foundRaw = []; // what the scan found: [{ folder, presetText }]
    this.trust = {}; // folder → { text, use }: the repo preset files the person has answered about
    this.trustRaw = null;
    this.bases = {}; // folder → the base branch git reports for a found checkout (null: unknown)
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
    knownAgents().then((a) => { this.allAgents = agentOptions(a); this.agents = this.allAgents; this.bump(cx); }).catch((e) => logError("knownAgents", e));
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
        this.userLayouts = c.layouts;
        this.gitInfo = c.gitInfo;
        this.hideTemplate = c.hideTemplate;
        this.scan = c.scan;
        this.syncTemplate();
        this.raw = c.raw;
        const t = await loadTrust();
        this.trust = t.trust;
        this.trustRaw = t.raw;
        if (scanCache.key === this.scanKey()) this.foundRaw = scanCache.found; // the last scan shows at once
      } catch (e) {
        logError("load config", e);
        this.error = e.message;
      }
      if (after) await after();
      cx.notify();
      this.runScan(cx).catch((e) => logError("scan", e));
      // Branch, changed files and worktrees per project: on unless "gitInfo": false is in the data file (it runs git in every
      // project each time the picker opens).
      if (this.gitInfo) this.loadInfo(cx);
    });
  }

  /** A redraw for background work (git answers, the agent list): at most one every 250 ms. Herdr cuts a slow draw off when
   *  another is asked for, so a stream of redraws can keep the popup from ever finishing one. */
  bump(cx) {
    if (this.bumpPending) return;
    this.bumpPending = true;
    cx.timer.after(250, () => { this.bumpPending = false; cx.notify(); });
  }

  /** The default template is a row nobody has saved yet: it shows until the file has a template of its own, or the person
   *  deleted it (`hideTemplate` in the data file). */
  syncTemplate() {
    this.virtualTemplate = !this.hideTemplate && !this.projects.some((p) => p.template) ? (this.virtualTemplate ?? defaultTemplate()) : null;
  }

  /** The saved projects, the ones a folder scan found, and the unsaved default template when it shows. */
  allProjects() {
    const found = this.found();
    if (!found.length && !this.virtualTemplate) return this.projects;
    return [...this.projects, ...found, ...(this.virtualTemplate ? [this.virtualTemplate] : [])];
  }

  // ---- folder scan and repo preset files --------------------------------------------------------

  scanKey() { return JSON.stringify([this.scan.folders, this.scan.depth]); }

  /** Looks for git checkouts under the scan folders and reads each one's preset file. The last answer is shown at once;
   *  this only asks again when it is older than SCAN_FRESH_MS, the scan folders changed, or `force` is set. */
  async runScan(cx, force = false) {
    const key = this.scanKey();
    if (!this.scan.folders.length) { this.scanToken = (this.scanToken ?? 0) + 1; this.scanning = false; this.foundRaw = []; this.scanError = null; return; }
    if (scanCache.key === key) this.foundRaw = scanCache.found;
    if (!force && scanCache.key === key && Date.now() - scanCache.at < SCAN_FRESH_MS) return;
    const token = (this.scanToken = (this.scanToken ?? 0) + 1);
    this.scanning = true;
    try {
      const folders = [];
      const errors = [];
      for (const root of this.scan.folders) {
        try { folders.push(...(await scanFolder(expandHome(root, homeOf()), this.scan.depth))); } catch (e) { errors.push(`${root}: ${e.message}`); }
      }
      const unique = dropNested(folders);
      const found = await mapLimit(unique.slice(0, SCAN_MAX), 8, async (folder) => {
        let presetText = null;
        try { presetText = await readTextFile(`${folder}/${PRESET_FILE}`); } catch {}
        return { folder, presetText };
      });
      if (token !== this.scanToken || this.closing) return;
      Object.assign(scanCache, { key, at: Date.now(), found });
      this.foundRaw = found;
      this.scanError = [...errors, ...(unique.length > SCAN_MAX ? [`${unique.length} checkouts found; only the first ${SCAN_MAX} are listed`] : [])].join(" · ") || null;
      log("debug", "scan", { folders: this.scan.folders, found: found.length });
    } finally {
      if (token === this.scanToken) this.scanning = false;
    }
    this.bump(cx);
  }

  /** The checkouts the scan found that are not saved projects or hidden, as projects: the template's settings, with the
   *  repo's preset file on top when the person has said to use it. The same objects come back until something they are
   *  built from changes, so a row, the launch target and a pending delete keep pointing at the same project. */
  found() {
    const base = this.projects.find((p) => p.template) ?? this.virtualTemplate;
    const m = this.foundMemo;
    if (m && m.projects === this.projects && m.raw === this.foundRaw && m.trust === this.trust && m.scan === this.scan && m.base === base && m.bases === this.bases) return m.list;
    let list = [];
    if (this.foundRaw.length) {
      const saved = new Set(this.projects.filter((p) => !p.template && p.path).map(projectFolder));
      const hidden = new Set(this.scan.hidden.map((h) => expandHome(h, homeOf())));
      list = this.foundRaw.filter((f) => !saved.has(f.folder) && !hidden.has(f.folder)).map((f) => this.foundProject(f, base));
    }
    this.foundMemo = { projects: this.projects, raw: this.foundRaw, trust: this.trust, scan: this.scan, base, bases: this.bases, list };
    return list;
  }

  foundProject(f, base) {
    let p = discoveredProject(f.folder, base);
    let state;
    let preset = null;
    let error;
    if (f.presetText != null) {
      const answer = this.trust[f.folder];
      try {
        preset = parseRepoPreset(f.presetText);
        state = answer && answer.text === f.presetText ? (answer.use ? "used" : "ignored") : "review";
      } catch (e) { state = "error"; error = e.message; }
      if (state === "used") p = applyRepoPreset(p, preset);
    }
    const detected = this.bases[f.folder];
    if (detected && !(state === "used" && preset.git.base)) p.git = { ...p.git, base: detected };
    p.discovered = true;
    if (state) p.preset = state;
    if (error) p.presetError = error;
    return p;
  }

  /** A found checkout was never configured, so its base branch is asked of git (once per folder) before it is opened or
   *  edited. Returns the project to use: a found one is rebuilt when the answer changes it. */
  async ensureBase(p) {
    if (!p.discovered) return p;
    const folder = projectFolder(p);
    if (!(folder in this.bases)) this.bases = { ...this.bases, [folder]: await detectBase(folder, p.git.remote) };
    return this.found().find((x) => projectFolder(x) === folder) ?? p;
  }

  presetTextOf(p) { return this.foundRaw.find((f) => f.folder === projectFolder(p))?.presetText ?? null; }

  /** A found project whose repo has a preset file nobody has answered about: show what it sets before anything runs. */
  askTrust(p, mainOnly) {
    const text = this.presetTextOf(p);
    this.trustAsk = { folder: projectFolder(p), name: p.name, mainOnly, text, lines: presetSummary(parseRepoPreset(text)) };
    this.mode = "trust";
    this.error = null;
    this.cx.notify();
  }

  /** The answer to that screen: use the file's settings, or ignore the file. Either is remembered for this exact file
   *  text; a file that changes is asked about again. Then the project opens. */
  async decideTrust(use) {
    const a = this.trustAsk;
    if (!a || a.busy) return;
    a.busy = true;
    try {
      const next = { ...this.trust, [a.folder]: { text: a.text, use } };
      this.trustRaw = await saveTrust(next, this.trustRaw);
      this.trust = next;
      if (use) await this.keepLayouts(parseRepoPreset(a.text).layouts);
      this.trustAsk = null;
      this.mode = "list";
      const p = this.found().find((x) => projectFolder(x) === a.folder);
      if (p) this.open(await this.ensureBase(p), a.mainOnly);
    } finally { a.busy = false; }
    this.cx.notify();
  }

  /** Adds a repo preset's layouts to the person's own (the ones whose names they don't have), so a project can name them. */
  async keepLayouts(layouts) {
    const merged = mergeLayouts(this.userLayouts, layouts ?? []);
    if (!merged.added) return;
    this.raw = await saveConfig(this.projects, this.raw, { layouts: merged.layouts });
    this.userLayouts = merged.layouts;
    this.layouts = allLayouts(merged.layouts);
  }

  // ---- settings ----

  openSettings() {
    this.mode = "settings";
    this.error = null;
  }

  /** The text size one step up (+1) or down (-1), or back to 100% (0). Everything drawn through z() follows: text, rows,
   *  buttons, boxes, icons and the detail card's width. Kept between sessions, for this machine. */
  stepScale(by) {
    const i = SCALES.indexOf(scaleNow);
    const next = by === 0 ? 1 : SCALES[Math.min(SCALES.length - 1, Math.max(0, i + by))];
    if (next === scaleNow) return;
    scaleNow = next;
    setShared(SCALE, next);
  }

  /** Git details on the rows and the card (branch, changed files, worktrees): `gitInfo` in the data file. */
  async setGitInfo(on) {
    this.raw = await saveConfig(this.projects, this.raw, { gitInfo: on });
    this.gitInfo = on;
    if (on) this.loadInfo(this.cx); else this.info = {};
    this.cx.notify();
  }

  renderSettings(t, cx) {
    const row = (label, help, ...controls) => h_flex().gap(12).items_center().py(6)
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(z(13)).font_medium().text_color(t.foreground).child(label))
        .child(div().text_size(z(11.5)).text_color(t.dim).child(help)))
      .children(controls);
    const at = SCALES.indexOf(scaleNow);
    return v_flex().gap(10)
      .child(this.title(t, "Settings", `${backKey()} back · Esc closes`))
      .child(row("Text size", `Makes the picker's text, rows, buttons and icons bigger or smaller, from ${SCALES[0] * 100}% to ${SCALES[SCALES.length - 1] * 100}%. Herdr's own zoom scales the whole app, this picker included; this changes only the picker. Keys, held with ${mac() ? "⌘" : "alt"}: - smaller, = bigger, 0 for 100%.`,
        this.button(t, "pp-set-smaller", "A−", false, () => { this.stepScale(-1); cx.notify(); }).when(at === 0, (el) => el.opacity(0.5)),
        div().w(z(52)).flex_none().text_center().text_size(z(13)).font_semibold().text_color(t.foreground).child(`${Math.round(scaleNow * 100)}%`),
        this.button(t, "pp-set-bigger", "A+", false, () => { this.stepScale(1); cx.notify(); }).when(at === SCALES.length - 1, (el) => el.opacity(0.5)),
        this.button(t, "pp-set-reset", "Reset", false, () => { this.stepScale(0); cx.notify(); })))
      .child(row("Detail card", `The card beside the list with the highlighted project's details and layout choice. Hide it on a small window. Key: ${DETAIL_HINT()}.`,
        this.button(t, "pp-set-detail", this.detail ? "✓ Shown" : "○ Hidden", false, () => { this.toggleDetail(); cx.notify(); })))
      .child(row("Git details", "Branch, changed files and worktree count on each row and the card. They run git in every saved project when the picker opens; turn them off if it feels slow.",
        this.button(t, "pp-set-git", this.gitInfo ? "✓ On" : "○ Off", false, () => this.setGitInfo(!this.gitInfo))))
      .child(div().text_size(z(11.5)).text_color(t.dim).child("The popup's own width is fixed by herdr when it opens: change overlay.width in the mod's mod.json (1060 px; a value up to 1 is a share of the window, so 0.9 follows any screen)."))
      .when(Boolean(this.error), (el) => el.child(div().text_size(z(12)).text_color(t.blocked).child(this.error)))
      .child(h_flex().justify_end().child(this.button(t, "pp-set-back", "Back", false, () => { this.mode = "list"; this.search.focus(); cx.notify(); })));
  }

  // ---- the scan folders screen ----

  openScan() {
    this.mode = "scan";
    this.error = null;
    this.scanNote = null;
    if (!this.scanInput) {
      this.scanInput = InputState.new({ placeholder: "a folder that holds your repositories, e.g. ~/code" });
      this.scanInput.on("submit", this.guard("add scan folder", () => this.addScanFolder(this.scanInput.value())));
    }
    this.scanInput.set_value("");
    this.scanInput.focus();
  }

  async saveScan(scan) {
    this.raw = await saveConfig(this.projects, this.raw, { scan });
    this.scan = scan;
    this.at = 0;
    this.cx.notify();
    await this.runScan(this.cx, true);
    this.cx.notify();
  }

  async addScanFolder(text) {
    const typed = String(text ?? "").trim();
    if (!typed) return;
    const folder = expandHome(typed, homeOf());
    if (!(await folderExists(folder))) { this.scanNote = { text: `There is no folder at ${shortHome(folder, homeOf())}.`, bad: true }; return this.cx.notify(); }
    const short = shortHome(folder, homeOf());
    if (this.scan.folders.some((f) => expandHome(f, homeOf()) === folder)) { this.scanNote = { text: `${short} is already scanned.`, bad: true }; return this.cx.notify(); }
    this.scanNote = null;
    this.scanInput.set_value("");
    await this.saveScan({ ...this.scan, folders: [...this.scan.folders, short] });
  }

  async browseScan() {
    const dir = await pickFolder({ prompt: "Scan this folder" });
    if (dir) await this.addScanFolder(dir);
  }

  renderScan(t, cx) {
    const shown = this.found().length;
    const withPreset = this.foundRaw.filter((f) => f.presetText != null).length;
    const status = !this.scan.folders.length ? "No folders yet. Add the folder you keep your repositories in."
      : this.scanning && !this.foundRaw.length ? "Looking for git checkouts…"
      : `Found ${this.foundRaw.length} git checkout${this.foundRaw.length === 1 ? "" : "s"}${withPreset ? `, ${withPreset} with a ${PRESET_FILE} file` : ""}. ${shown} ${shown === 1 ? "is" : "are"} listed under "Found in your folders"; the rest are saved projects or hidden.${this.scanning ? " Looking again…" : ""}`;
    return v_flex().gap(10)
      .child(this.title(t, "Scan folders", `${backKey()} back · Esc closes`))
      .child(div().text_size(z(12)).text_color(t.dim).child(`Every git checkout under these folders (up to ${this.scan.depth} folders down) is listed in the picker without adding it by hand. It opens with your Template's settings, or with the repo's own ${PRESET_FILE} once you have looked at that file and said to use it. Edit one to save it as a project of its own.`))
      .child(h_flex().gap(8).items_center()
        .child(h_flex().flex_1().h(z(36)).px(10).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
          .child(Input.new(this.scanInput).flex_1().h_full().text_size(z(12.8)).text_color(t.foreground)))
        .child(this.button(t, "pp-scan-browse", "Browse…", false, () => this.browseScan()))
        .child(this.button(t, "pp-scan-add", "Add folder", true, () => this.addScanFolder(this.scanInput.value()))))
      .child(v_flex().gap(4).children(this.scan.folders.map((f, i) => h_flex().gap(10).h(z(36)).px(12).items_center().rounded(8).bg(t.raised)
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(f))
        .child(this.button(t, `pp-scan-rm-${i}`, "Remove", false, () => this.saveScan({ ...this.scan, folders: this.scan.folders.filter((_x, j) => j !== i) }))))))
      .child(div().text_size(z(12)).text_color(t.dim).child(status))
      .when(Boolean(this.scanError), (el) => el.child(div().text_size(z(12)).text_color(t.blocked).child(this.scanError)))
      .when(Boolean(this.scanNote), (el) => el.child(div().text_size(z(12)).text_color(this.scanNote.bad ? t.blocked : t.done).child(this.scanNote.text)))
      .when(Boolean(this.error), (el) => el.child(div().text_size(z(12)).text_color(t.blocked).child(this.error)))
      .child(h_flex().gap(8).items_center().justify_end()
        .when(this.scan.hidden.length > 0, (el) => el.child(this.button(t, "pp-scan-unhide", `Show ${this.scan.hidden.length} hidden again`, false, () => this.saveScan({ ...this.scan, hidden: [] }))))
        .when(this.scan.folders.length > 0, (el) => el.child(this.button(t, "pp-scan-again", "Scan again", false, async () => { await this.runScan(cx, true); cx.notify(); })))
        .child(this.button(t, "pp-scan-back", "Back", false, () => { this.mode = "list"; this.search.focus(); cx.notify(); })));
  }

  renderTrust(t, cx) {
    const a = this.trustAsk;
    const line = (l) => h_flex().gap(10).items_start().text_size(z(12))
      .child(div().w(z(150)).flex_none().text_color(t.dim).child(l.label))
      .child(div().flex_1().min_w(0).text_color(l.runs ? t.working : t.foreground).child(l.value));
    return v_flex().gap(10).min_h(0)
      .child(this.title(t, `Repo preset · ${a.name}`, `${key("t")} use · ${backKey()} back · Esc closes`))
      .child(div().text_size(z(12)).text_color(t.dim).child(`${shortHome(a.folder, homeOf())} has a ${PRESET_FILE} file: settings its authors share with everyone who clones it. The highlighted lines are commands that would run on this machine, so read them before you use the file. You are asked again if the file changes.`))
      // A fixed height, like the editor's fields: a scrolling box with only a maximum height collapses to nothing in herdr.
      .child(v_flex().gap(4).p(12).flex_none().h(Math.min(380, Math.max(1, a.lines.length) * z(22.6) + 26)).overflow_y_scrollbar().rounded(10).border_1().border_color(t.input).bg(t.raised)
        .children(a.lines.length ? a.lines.map(line) : [div().text_size(z(12)).text_color(t.dim).child("The file sets nothing.")]))
      .when(Boolean(this.error), (el) => el.child(div().text_size(z(12)).text_color(t.blocked).child(this.error)))
      .child(h_flex().gap(8).items_center().justify_end()
        .child(this.button(t, "pp-trust-back", "Back", false, () => { this.mode = "list"; this.trustAsk = null; this.search.focus(); cx.notify(); }))
        .child(this.button(t, "pp-trust-ignore", "Ignore the file", false, () => this.decideTrust(false)))
        .child(this.button(t, "pp-trust-use", "Use these settings", true, () => this.decideTrust(true))));
  }

  /** A new project: blank, or with the settings of a template the person has saved (not the unsaved default one). */
  newProject() {
    const template = this.projects.find((p) => p.template);
    return template ? startFromTemplate(template) : blankProject();
  }

  /** Branch, changed files and worktree count for each project, four at a time so the list stays quick. Answers from an
   *  earlier open show at once and are refreshed behind them unless they are recent; the selected project goes first,
   *  then the ones never read, then the oldest. Each answer schedules a (batched) redraw so rows fill in as they arrive. */
  async loadInfo(cx) {
    const token = (this.infoToken = (this.infoToken ?? 0) + 1);
    const now = Date.now();
    const queue = this.projects.filter((p) => !p.template && p.path);
    for (const p of queue) {
      const hit = infoCache.get(projectFolder(p));
      if (hit && !(projectFolder(p) in this.info)) this.info[projectFolder(p)] = hit.info;
    }
    const age = (p) => now - (infoCache.get(projectFolder(p))?.at ?? 0);
    let first = null;
    try { first = this.selected()?.p; } catch {}
    const todo = queue.filter((p) => age(p) > INFO_FRESH_MS).sort((x, y) => (y === first) - (x === first) || age(y) - age(x));
    if (queue.length !== todo.length) this.bump(cx);
    const worker = async () => {
      for (let p = todo.shift(); p; p = todo.shift()) {
        if (this.infoToken !== token || this.closing) return;
        const folder = projectFolder(p);
        const gen = infoGen.get(folder) ?? 0;
        const info = await gitSummary(folder);
        if (this.infoToken !== token || this.closing) return; // an older load must not stamp the shared cache as fresh
        if ((infoGen.get(folder) ?? 0) !== gen) continue; // worktrees changed while git was answering: that answer may be old
        infoCache.set(folder, { info, at: Date.now() });
        this.info[folder] = info;
        this.bump(cx);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
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
      // On a template: change the agent and press Save, which shows the "apply to your projects?" question.
      if (d.ask && project?.template) { this.fields.find(([k]) => k === "agent")?.[1].set_value?.(d.ask); this.save(this.cx); }
    } else if (d.view === "duplicate") this.duplicateSelected(); // a copy of the project, or a new project from the template when that row is picked
    else if (d.view === "backup") {
      this.openBackup();
      if (d.text) this.backupPath.set_value(d.text);
      if (d.note) this.backupNote = { text: d.note, bad: Boolean(d.bad) };
    } else if (d.view === "scan") this.openScan();
    else if (d.view === "settings") this.openSettings();
    else if (d.view === "delete") this.pendingDelete = project;
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
    if (Array.isArray(d.steps)) this.runDemoSteps(d.steps);
  }

  /** A demo file's "steps": what a person would do, one after another, so a screen that takes several actions to reach
   *  can be captured (and the real app exercised). Each is ["select", "<project name>"], ["add"] (the editor on a new
   *  project), ["list"] (back to the list), ["wait", seconds] or ["<method>", ...arguments] ("$cx" stands for the context). */
  runDemoSteps(steps) {
    this.cx.spawn(async (cx) => {
      for (const [name, ...args] of steps) {
        try {
          if (name === "select") {
            const i = this.rows().findIndex((r) => r.p.name === args[0]);
            if (i < 0) throw new Error(`no project called "${args[0]}"`); // never fall back to another row: the next step may open it
            this.at = i;
          }
          else if (name === "add") this.edit(this.newProject(), null);
          else if (name === "list") { this.mode = "list"; this.search.focus(); }
          else if (name === "wait") await exec("sleep", [String(args[0])]);
          else await this[name](...args.map((a) => (a === "$cx" ? cx : a)));
        } catch (e) { this.fail(`demo step ${name}`, e); cx.notify(); return; } // a failed step ends the run: later steps assume it worked
        cx.notify();
        await exec("sleep", ["0.4"]);
      }
    });
  }

  /** Closes the popup. Not called `close`: herdr calls a view's `close(cx)` as its own cleanup hook when the popup goes. */
  dismiss() {
    this.closing = true;
    if (this.overlay) closeOverlay(this.overlay);
    else run("overlay.close", {}); // opened without an overlay id (a command line open): close the top one
  }

  /** herdr's hook for when the popup is going: stop background work. */
  close() { this.closing = true; }

  query() { return this.search.value(); }

  // ---- herdr's live data -------------------------------------------------

  /** The herdr data a draw needs, copied. Herdr draws a view again whenever live data it read changes (spaces, agents,
   *  shared state), and while an agent works that is constantly: a draw that read the live data was redrawn over and
   *  over, and a draw that takes a while is cut off when the next one is asked for. A draw reads this copy instead. */
  takeSnapshot() {
    const colors = shared("space.colors");
    return {
      spaces: spaces().filter((s) => !s.machine).map((s) => ({ id: s.id, folder: s.folder, status: s.status })),
      colors: colors ? { ...colors } : colors,
      recent: { ...(shared(RECENT) ?? {}) },
      platform: window()?.platform ?? "",
      launcher: shared(LAUNCHER) ?? "sidebar",
      launcherInLayout: launcherBlocks().length > 0,
    };
  }

  /** Takes a new snapshot; true when something in it changed (the caller then asks for a draw). */
  refreshSnap() {
    const next = this.takeSnapshot();
    const key = JSON.stringify(next);
    if (key === this.snapKey) return false;
    this.snap = next;
    this.snapKey = key;
    platformNow = next.platform;
    return true;
  }

  // ---- list -------------------------------------------------------------

  rows() {
    if (this.frame) return this.frame.rows; // while rendering, every caller gets the same list
    const q = this.query();
    // Scoring and sorting every project is the same work until the query, the projects or herdr's snapshot change, and an
    // arrow press, a reveal and the draw after it all ask. (Projects are replaced, never edited in place: the editor works on a draft.)
    const memo = this.rowsMemo;
    const found = this.found();
    if (memo && memo.q === q && memo.projects === this.projects && memo.found === found && memo.template === this.virtualTemplate && memo.snapKey === this.snapKey) return memo.rows;
    const rows = this.computeRows(q);
    this.rowsMemo = { q, projects: this.projects, found, template: this.virtualTemplate, snapKey: this.snapKey, rows };
    return rows;
  }

  computeRows(q) {
    const recent = this.snap.recent;
    const open = new Map(); // folder → its first open space, so a row doesn't scan every space
    for (const s of this.snap.spaces) if (!open.has(s.folder)) open.set(s.folder, s);
    const rows = this.allProjects().map((p) => {
      const score = Math.max(fuzzy(q, p.name), fuzzy(q, p.group), fuzzy(q, basename(p.path)) - 1);
      const folder = projectFolder(p);
      return { p, score, space: p.template ? undefined : open.get(folder), used: recent[p.path] ?? 0 };
    }).filter((r) => r.score >= 0);
    rows.sort((a, b) => q
      ? b.score - a.score
      : (!!a.p.template - !!b.p.template) || (!!b.space - !!a.space) || (b.p.pinned - a.p.pinned) || (!!a.p.discovered - !!b.p.discovered) || (b.used - a.used) || a.p.name.localeCompare(b.p.name));
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

  /** The shown layout has no launcher blocks (herdr's own layouts have none, and it won't let a mod change those): writes a
   *  copy of the shown layout with the blocks to layouts/<name>-launcher.json and switches to it. The copy is built from the
   *  tree in hand and written as a file, so nothing waits on herdr finishing a clone. Your own layouts are never edited. */
  setupLauncher() {
    const from = shared("layout") ?? "main";
    const taken = new Set(layouts());
    let as = `${from}-launcher`;
    for (let n = 2; taken.has(as); n++) as = `${from}-launcher-${n}`;
    const { tree, added } = withLauncherBlocks(layout());
    log("info", "adding the launcher blocks", { from, as, added });
    if (!added.length) return this.fail("launcher", new Error("this layout has no spaces, status or tabs block to put the button beside"));
    return this.guard("launcher", async () => {
      // The blocks draw with the project-presets-launcher mod; without its folder they would be empty and herdr would log errors.
      const modDir = `${appHome()}/mods/project-presets-launcher`;
      if ((await readTextFile(`${modDir}/main.js`)) == null) throw new Error(`the launcher mod isn't installed. Copy mods/project-presets-launcher/ from the repo to ${shortHome(modDir, homeOf())}, then click this again`);
      await writeTextFile(`${appHome()}/layouts/${as}.json`, JSON.stringify(tree, null, 2) + "\n", null);
      run("layout.switch", { name: as });
      this.snap = { ...this.snap, launcherInLayout: true };
      this.cx.notify();
    })();
  }

  /** Moves the clickable open button (see the project-presets-launcher mod) to the next place: sidebar, status bar,
   *  tab bar, then off. The key combo is not affected. */
  cycleLauncher() {
    if (launcherBlocks().length === 0) return this.setupLauncher();
    const now = shared(LAUNCHER) ?? "sidebar";
    const next = LAUNCHERS[(LAUNCHERS.findIndex(([k]) => k === now) + 1) % LAUNCHERS.length][0];
    setShared(LAUNCHER, next);
    this.snap = { ...this.snap, launcher: next }; // the toolbar label changes at once, not at the next snapshot
    // Only the blocks this layout has: on a layout without them (see "The clickable Projects button" in the README) there is
    // nothing to show or hide, and asking would fail.
    const have = launcherBlocks();
    for (const [k] of LAUNCHERS) if (k !== "off" && have.includes(`pp-launch-${k}`)) run(k === next ? "layout.show" : "layout.hide", { id: `pp-launch-${k}` });
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
      ? [["Enter", "opens"], ["Shift+Enter", "checkout"], [key("n"), "add"], [key("u"), "copy"], [key("x"), "export"], [key("f"), "scan"], [key("s"), "settings"], [key("e"), "edit"], [key("w"), "worktrees"], [key("d"), "delete"], [LAYOUT_HINT(), "layout"], [DETAIL_HINT(), "details"]]
      : [["Enter", "creates"], [backKey(), "back"], ["Esc", "closes"]];
    const current = this.layoutNameFor(p);
    const lit = this.layoutLit;
    const choice = (name, label) => {
      const on = name === current;
      return div().px(10).py(3).rounded(8).border_1().text_size(z(11.5))
        .border_color(on ? (lit ? t.accent : t.solid) : t.input).bg(on ? t.solid : t.raised)
        .text_color(on ? t.solid_foreground : t.dim).when(on, (el) => (lit ? el.font_bold() : el.font_semibold())).child(label);
    };
    // Every element a render builds costs time, and herdr cuts a slow render off: one row, a bold key and a plain
    // string per hint, not a box with two boxes inside.
    const hintLine = h_flex().gap(5).items_baseline().flex_wrap().text_size(z(FOOTER_SIZE)).text_color(t.dim)
      .children(hints.flatMap(([k, w], i) => [div().font_semibold().text_color(t.foreground).child(k), i < hints.length - 1 ? `${w}  ·` : w]));
    if (list && this.detail) return hintLine; // the detail card has the layout choice
    return v_flex().gap(8)
      .child(hintLine)
      .child(h_flex().gap(6).items_center().flex_wrap().text_size(z(FOOTER_SIZE))
        .child(div().text_color(t.dim).child("Layout"))
        .child(choice("", "Agent only"))
        .children(this.layouts.map((l) => choice(l.name, l.label ?? l.name)))
        .child(div().flex_1())
        .child(div().px(6).rounded(5).border_1().border_color(t.input).bg(t.raised).text_size(z(10.5)).text_color(t.foreground).child(LAYOUT_HINT())));
  }

  /** A mini icon for an agent entry from herdr's program table (a one-color glyph or a picture). */
  programIcon(t, program, size = 16) {
    size = z(size);
    const box = div().w(size).h(size).flex_none();
    if (!program?.icon) return box.child(svg("icons/agent.svg").size(size).flex_none().text_color(t.dim));
    return box.child(program.tint ? svg(program.icon).size(size).flex_none().text_color(t.foreground) : image(program.icon).w(size).h(size).flex_none());
  }

  shellIcon(t, size = 16) { size = z(size); return div().w(size).h(size).flex_none().child(svg("icons/shell.svg").size(size).flex_none().text_color(t.dim)); }

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
    if (r.p.template) return this.duplicateSelected(); // a template has no folder to open: Enter makes a project from it
    if (r.p.discovered) return this.openFound(r.p, mainOnly);
    this.open(r.p, mainOnly);
  }

  open(p, mainOnly) {
    this.target = p;
    const mode = mainOnly ? "never" : p.worktree.mode;
    if (mode === "ask") return this.askName(p);
    this.start(p, mode === "always");
  }

  /** A found checkout: a repo preset nobody has answered about is shown first; otherwise git is asked for the base
   *  branch (nobody configured one), then it opens like any project. */
  openFound(p, mainOnly) {
    if (p.preset === "review") return this.askTrust(p, mainOnly);
    if (this.opening) return;
    this.opening = true;
    return this.guard("open project", async () => {
      try {
        const ready = await this.ensureBase(p);
        if (this.mode === "list") this.open(ready, mainOnly);
      } finally { this.opening = false; }
      this.cx.notify();
    })();
  }

  askName(p) {
    this.mode = "name";
    this.preview = "";
    this.nameInput = InputState.new({ placeholder: "branch name, e.g. fix login (empty: use the time)" });
    this.nameInput.on("change", (_e, cx) => this.previewSoon(cx));
    this.nameInput.on("submit", () => this.start(p, true, this.nameInput.value()));
    this.nameInput.focus();
    this.refreshPreview(this.cx);
  }

  /** A keystroke in the name box: the preview is asked for once typing pauses, not for every letter. */
  previewSoon(cx) {
    const token = (this.previewTimer = (this.previewTimer ?? 0) + 1);
    this.previewSeq = (this.previewSeq ?? 0) + 1; // a request still out is for older text: its answer is dropped
    this.cx.timer.after(200, () => { if (token === this.previewTimer && this.mode === "name") this.refreshPreview(this.cx); });
  }

  refreshPreview(cx) {
    this.previewTimer = (this.previewTimer ?? 0) + 1; // a pending keystroke timer is now moot
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
          invalidate(projectFolder(p)); // the worktree count changes
          const wt = await createWorktree(p, slugText, log);
          invalidate(projectFolder(p));
          folder = wt.folder;
          name = worktreeSpaceName(p, wt);
          await runSetup(p, folder, log);
        } else if (existing) {
          setShared(RECENT, { ...(shared(RECENT) ?? {}), [p.path]: Date.now() });
          this.dismiss();
          return run("space.select", { id: existing.id });
        } else {
          invalidate(folder); // setup may change the checkout the cached details describe
          await prepareMain(p, log);
          await runSetup(p, folder, log);
          invalidate(folder);
        }
        setShared(RECENT, { ...(shared(RECENT) ?? {}), [p.path]: Date.now() });
        if (p.startup.agent.trim() && p.startup.prompt && p.startup.promptMode === "send") log("Waiting for the agent to be ready for its prompt…");
        // Stay open until the prompt is sent: closing the popup cancels this task.
        await launch(p, folder, name, layout);
        this.dismiss();
      } catch (e) {
        logError("open project", e);
        this.error = e.message;
        cx.notify();
      }
    });
  }

  // ---- editor -----------------------------------------------------------

  edit(project, index, kind) {
    try { this.openEditor(project, index, kind); } catch (e) { logError("editor", e); this.mode = "list"; this.error = `Editor failed: ${e.message}`; }
    this.cx?.notify();
  }

  openEditor(project, index, kind) {
    this.mode = "edit";
    this.index = index; // null: new
    this.editKind = kind ?? (project.template ? "template" : index == null ? "add" : "edit");
    this.draft = JSON.parse(JSON.stringify(project));
    this.draftBefore = JSON.parse(JSON.stringify(project)); // what a template looked like when the editor opened
    this.applyAsk = null; // set when saving a template asks whether to apply its changes to the existing projects
    this.presetNote = null; // what happened with the repo's preset file (filled in from it, written to it)
    this.presetConfirm = null;
    this.draftLayouts = []; // layouts from a repo preset file, added to the person's own on Save
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
    if (this.index == null && !this.draft.template) await this.fillFromRepo(dir);
    cx.notify();
  }

  /** The editor's text boxes, written into the draft. */
  collectDraft() {
    for (const [key, state] of this.fields) TEXT.find(([k]) => k === key)[3](this.draft, key === "path" ? state.value() : state.value().trim());
    return this.draft;
  }

  /** Puts `project` in the editor: the draft and every text box. */
  fillEditor(project) {
    this.draft = JSON.parse(JSON.stringify(project));
    for (const [key, state] of this.fields) state.set_value?.(TEXT.find(([k]) => k === key)[2](this.draft) ?? "");
  }

  /** A new project whose folder has a repo preset file starts with that file's settings, for the person to read and
   *  change before saving. */
  async fillFromRepo(dir) {
    let text = null;
    try { text = await readTextFile(`${dir}/${PRESET_FILE}`); } catch {}
    if (text == null) return;
    try {
      const preset = parseRepoPreset(text);
      this.fillEditor(applyRepoPreset(this.collectDraft(), preset));
      this.draftLayouts = preset.layouts;
      this.presetNote = { text: `Filled in from the repo's ${PRESET_FILE}. Look through Startup (its commands run on this machine) before you save.` };
    } catch (e) {
      this.presetNote = { text: `The repo's ${PRESET_FILE} was not used: ${e.message}`, bad: true };
    }
  }

  /** Writes the project's shared settings to .herdr/project-presets.json in its repository, for committing. An existing
   *  file with other content is replaced only after a second click. */
  async writePreset(cx) {
    const d = this.collectDraft();
    if (!d.path.trim()) throw new Error("Choose the project's folder first: the file is written into it");
    const { top } = await inspect(projectFolder(d));
    const path = `${top}/${PRESET_FILE}`;
    const text = JSON.stringify(repoPresetOf(d, this.userLayouts), null, 2) + "\n";
    const existing = await readTextFile(path);
    if (existing != null && existing !== text && this.presetConfirm !== path) {
      this.presetConfirm = path;
      this.presetNote = { text: `${shortHome(path, homeOf())} already exists with other settings. Click again to replace it.`, bad: true };
      return cx.notify();
    }
    this.presetConfirm = null;
    if (existing !== text) await writeRepoFile(path, text, existing);
    // The person wrote this file themselves: nothing to ask about when a scan finds it.
    const next = { ...this.trust, [top]: { text, use: true } };
    this.trustRaw = await saveTrust(next, this.trustRaw);
    this.trust = next;
    scanCache.at = 0;
    this.presetNote = { text: `Wrote ${shortHome(path, homeOf())}. Commit it and everyone who clones the repo can open it with these settings. Left out as your own: the folder, the pin, the worktree folder and the space name.` };
    cx.notify();
  }

  /** `applyToAll`: undefined on the first Save (a template with changes and other projects asks first); true applies the
   *  changed settings to every project, false saves the template alone. */
  async save(cx, applyToAll) {
    if (this.applyAsk && applyToAll === undefined) return; // the question is showing: answer it with its buttons
    try {
      const d = this.collectDraft();
      if (!d.name) throw new Error("Give the project a name");
      if (!d.template) {
        if (!d.path.trim()) throw new Error("Choose the project's folder: Browse… or type its path");
        await inspect(projectFolder(d));
      }
      let list = [...this.projects];
      if (this.index == null) list.push(d); else list[this.index] = d;
      if (d.template) {
        const changes = templateChanges(this.draftBefore, d);
        const others = this.projects.filter((p) => !p.template).length;
        if (applyToAll === undefined && changes.length && others) {
          this.applyAsk = { changes, count: others };
          return cx.notify();
        }
        if (applyToAll && changes.length) list = applyTemplateChanges(list, changes);
      }
      this.applyAsk = null;
      const layouts = mergeLayouts(this.userLayouts, this.draftLayouts ?? []);
      this.raw = await saveConfig(list, this.raw, layouts.added ? { layouts: layouts.layouts } : {});
      if (layouts.added) { this.userLayouts = layouts.layouts; this.layouts = allLayouts(layouts.layouts); }
      this.projects = list;
      this.syncTemplate();
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
      const template = this.draft.template;
      this.raw = await saveConfig(list, this.raw, template ? { hideTemplate: true } : {});
      this.projects = list;
      if (template) this.hideTemplate = true;
      this.syncTemplate();
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
    if (!r) return;
    if (r.p.discovered) return this.editFound(r.p);
    const index = this.projects.indexOf(r.p);
    this.edit(r.p, index < 0 ? null : index);
  }

  /** Edit on a found checkout opens the editor on a new project for it, already filled in (with the repo's preset file
   *  when there is one, for the person to read); saving makes it a project of their own. */
  editFound(found) {
    return this.guard("edit project", async () => {
      let p = await this.ensureBase(found);
      let preset = null;
      let note = null;
      if (p.preset === "review" || p.preset === "ignored") {
        preset = parseRepoPreset(this.presetTextOf(p));
        p = applyRepoPreset(p, preset);
        note = { text: `Filled in from the repo's ${PRESET_FILE}. Look through Startup (its commands run on this machine) before you save.` };
      } else if (p.preset === "error") note = { text: `The repo's ${PRESET_FILE} was not used: ${p.presetError}`, bad: true };
      this.edit(savedProject(p), null);
      this.presetNote = note;
      this.draftLayouts = preset?.layouts ?? [];
      this.cx.notify();
    })();
  }

  /** ctrl/alt+U: opens the editor on a copy of the highlighted project (from the template: a new project with its settings). */
  duplicateSelected() {
    const r = this.selected();
    if (!r || this.mode !== "list") return;
    if (r.p.discovered) return this.editFound(r.p); // nothing saved to copy yet: this makes the project
    this.edit(duplicateProject(r.p, this.allProjects().map((p) => p.name)), null, r.p.template ? "fromTemplate" : "duplicate");
  }

  // ---- delete project ---------------------------------------------------

  /** First press asks, the second removes the project from the list (its folder and worktrees stay). */
  deleteSelected() {
    const r = this.selected();
    if (!r) return;
    if (this.pendingDelete !== r.p) { this.pendingDelete = r.p; this.error = null; return; }
    if (r.p.discovered) {
      // Not in the data file, so there is nothing to delete: it is hidden from the scan instead.
      const scan = { ...this.scan, hidden: [...this.scan.hidden, shortHome(projectFolder(r.p), homeOf())] };
      this.pendingDelete = null;
      return saveConfig(this.projects, this.raw, { scan }).then((raw) => { this.raw = raw; this.scan = scan; this.cx.notify(); }).catch((e) => this.fail("hide project", e));
    }
    const list = this.projects.filter((p) => p !== r.p);
    this.pendingDelete = null;
    const template = Boolean(r.p.template);
    saveConfig(list, this.raw, template ? { hideTemplate: true } : {}).then((raw) => {
      this.raw = raw;
      this.projects = list;
      if (template) this.hideTemplate = true;
      this.syncTemplate();
      this.cx.notify();
    }).catch((e) => this.fail("delete project", e));
  }

  // ---- worktree cleanup -------------------------------------------------

  openWorktrees() {
    const r = this.selected();
    if (!r || r.p.template) return; // a template has no repository
    if (r.p.discovered && !(projectFolder(r.p) in this.bases)) {
      // "merged" is judged against the base branch, which nobody set for a found checkout: ask git first.
      return this.guard("worktrees", async () => { await this.ensureBase(r.p); if (this.mode === "list") this.openWorktrees(); this.cx.notify(); })();
    }
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
        invalidate(projectFolder(this.target)); // the worktree count and branches change
        try { await removeWorktree(this.target, w); log("debug", "removed worktree", { path: w.path }); } catch (e) { logError("remove worktree", e); failed.push(e.message); }
      }
      invalidate(projectFolder(this.target));
      delete this.info[projectFolder(this.target)];
      if (this.gitInfo) this.loadInfo(cx);
      this.wtSel = new Set();
      this.error = failed.length ? failed.join("\n") : null;
      try { this.wts = await listWorktrees(this.target); } catch {}
      cx.notify();
    });
  }

  // ---- import and export of the config -----------------------------------------------

  openBackup() {
    this.mode = "backup";
    this.error = null;
    this.backupNote = null;
    this.backupConfirm = null; // "overwrite" | "replace": the second click does it
    const fresh = `${EXPORT_DIR}/${exportFileName()}`;
    if (this.backupPath) this.backupPath.set_value(fresh);
    else {
      this.backupPath = InputState.new({ value: fresh });
      this.backupPath.on("change", (_e, cx) => { this.backupConfirm = null; cx.notify(); });
    }
    this.backupPath.focus();
  }

  backupFile() { return expandHome(this.backupPath.value().trim(), homeOf()); }

  setNote(text, bad = false) {
    this.backupNote = { text, bad };
    this.cx.notify();
  }

  /** Writes the project list, the layouts and the settings to the file in the box. An existing file is only replaced after a second click. */
  async exportBackup() {
    try {
      const path = this.backupFile();
      if (!path) return this.setNote("Type where to save the file.", true);
      const existing = await readTextFile(path);
      if (existing != null && this.backupConfirm !== "overwrite") {
        this.backupConfirm = "overwrite";
        return this.setNote(`${shortHome(path, homeOf())} already exists. Click Export again to replace it.`, true);
      }
      const data = exportData({ projects: this.projects, layouts: this.userLayouts, gitInfo: this.gitInfo, hideTemplate: this.hideTemplate }, homeOf());
      await writeTextFile(path, JSON.stringify(data, null, 2) + "\n", existing);
      this.backupConfirm = null;
      this.setNote(`Exported ${data.projects.length} project(s) and ${data.layouts.length} layout(s) to ${shortHome(path, homeOf())}. Paths under your home folder are saved as ~.`);
    } catch (e) {
      logError("export", e);
      this.setNote(`Export failed: ${e.message}`, true);
    }
  }

  /** Reads the file in the box. "merge" adds what is missing and keeps yours; "replace" swaps everything for the backup, after a
   *  second click and with your current file saved as <data file>.bak first. */
  async importBackup(how) {
    try {
      const path = this.backupFile();
      const text = path ? await readTextFile(path) : null;
      if (text == null) return this.setNote(`There is no file at ${shortHome(path || "(nothing typed)", homeOf())}.`, true);
      const backup = parseBackup(text);
      const bak = `${dataFilePath()}.bak`;
      let summary;
      let added;
      if (how === "replace") {
        if (this.backupConfirm !== "replace") {
          this.backupConfirm = "replace";
          return this.setNote(`This replaces your ${this.projects.length} project(s) with the file's ${backup.projects.length}. Your current file is saved as ${shortHome(bak, homeOf())} first. Click Import: replace again to go on.`, true);
        }
        await writeTextFile(bak, this.raw ?? "{}\n", await readTextFile(bak));
        this.raw = await saveConfig(backup.projects, this.raw, { layouts: backup.layouts, gitInfo: backup.gitInfo, hideTemplate: backup.hideTemplate });
        this.applyConfig(backup.projects, backup.layouts, backup.gitInfo, backup.hideTemplate);
        added = backup.projects;
        summary = `Replaced everything with the file: ${backup.projects.length} project(s), ${backup.layouts.length} layout(s). Your previous file is saved as ${shortHome(bak, homeOf())}.`;
      } else {
        const merged = mergeProjects(this.projects, backup.projects);
        const layouts = mergeLayouts(this.userLayouts, backup.layouts);
        this.raw = await saveConfig(merged.projects, this.raw, { layouts: layouts.layouts });
        added = merged.projects.filter((p) => !this.projects.includes(p));
        this.applyConfig(merged.projects, layouts.layouts, this.gitInfo, this.hideTemplate);
        summary = `Merged: ${merged.added} project(s) added, ${merged.skipped} already here${layouts.added ? `, ${layouts.added} layout(s) added` : ""}.`;
      }
      this.backupConfirm = null;
      const missing = [];
      for (const p of added) if (!p.template && p.path && !(await folderExists(expandHome(p.path, homeOf())))) missing.push(p.name);
      this.setNote(missing.length ? `${summary} ${missing.length} folder(s) don't exist on this machine: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}. Go back (${backKey()}), then press ${key("e")} on each to fix its folder.` : summary);
    } catch (e) {
      logError("import", e);
      this.setNote(`Import failed: ${e.message}`, true);
    }
  }

  /** Makes a restored or merged project list the current one. */
  applyConfig(projects, layouts, gitInfo, hideTemplate) {
    this.projects = projects;
    this.userLayouts = layouts;
    this.layouts = allLayouts(layouts);
    this.gitInfo = gitInfo;
    this.hideTemplate = hideTemplate;
    this.syncTemplate();
    this.info = {};
    this.at = 0;
    if (this.gitInfo) this.loadInfo(this.cx);
  }

  async browseBackup() {
    const dir = await pickFolder({ prompt: "Save the export here" });
    if (!dir) return;
    const name = this.backupFile().split("/").pop() || "project-presets-backup.json";
    this.backupPath.set_value(`${dir}/${name}`);
    this.cx.notify();
  }

  renderBackup(t, cx) {
    const confirmAction = this.backupConfirm;
    return v_flex().gap(10)
      .child(this.title(t, "Import and export config", `${backKey()} back · Esc closes`))
      .child(div().text_size(z(12)).text_color(t.dim).child("Export saves your project list, layouts and settings to one file. Import brings them back, on this machine or another. Paths under your home folder are saved as ~, so an exported file works on a machine with a different user name."))
      .child(div().text_size(z(11.5)).text_color(t.dim).child("File"))
      .child(h_flex().gap(8).items_center()
        .child(h_flex().flex_1().h(z(36)).px(10).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
          .child(Input.new(this.backupPath).flex_1().h_full().text_size(z(12.8)).text_color(t.foreground)))
        .child(this.button(t, "pp-bk-browse", "Browse…", false, () => this.browseBackup())))
      .child(h_flex().gap(8).items_center().flex_wrap()
        .child(this.button(t, "pp-bk-export", confirmAction === "overwrite" ? "Click again to replace the file" : "Export", true, () => this.exportBackup()))
        .child(this.button(t, "pp-bk-merge", "Import: merge", false, () => this.importBackup("merge")))
        .child(this.button(t, "pp-bk-replace", confirmAction === "replace" ? "Click again to replace everything" : "Import: replace", false, () => this.importBackup("replace"))))
      .child(div().text_size(z(11)).text_color(t.dim).child("Merge adds the projects you don't have and keeps yours. Replace swaps everything for the file, after a second click, and first saves your current file as project-presets.json.bak."))
      .when(Boolean(this.backupNote), (el) => el.child(div().text_size(z(12)).text_color(this.backupNote.bad ? t.blocked : t.done).child(this.backupNote.text)))
      .child(h_flex().justify_end().child(this.button(t, "pp-bk-back", "Back", false, () => { this.mode = "list"; this.search.focus(); cx.notify(); })));
  }

  // ---- keys -------------------------------------------------------------

  keys(e, cx) {
    const k = e.key;
    const ctrl = e.modifiers.control;
    const mod = ctrl || e.modifiers.alt || e.modifiers.platform; // ctrl, alt or cmd
    const layoutMod = e.modifiers.alt && (ctrl || e.modifiers.platform);
    if (this.pendingDelete && k !== "d") this.pendingDelete = null;
    // herdr never passes Esc to a popup, so this is the way back. (Not a bracket key: herdr binds alt-[ and alt-] to tabs.)
    const back = k === "b" && mod;
    if (k === "escape" || back) {
      if (this.mode === "list") { if (back) return; this.dismiss(); }
      else if (this.mode === "busy" && !this.error) return;
      else if (this.mode === "edit" && this.applyAsk) this.applyAsk = null;
      else { this.mode = "list"; this.error = null; this.trustAsk = null; this.search.focus(); }
    } else if (this.mode === "list") {
      const n = this.rows().length;
      if (k === "down" && n) { this.at = (this.at + 1) % n; this.revealRow(); }
      else if (k === "up" && n) { this.at = (this.at + n - 1) % n; this.revealRow(); }
      else if (k === "enter" && e.modifiers.shift) { this.handled = Date.now(); this.activate(true); }
      else if (k === "d" && mod) this.deleteSelected();
      else if (k === "w" && mod) this.openWorktrees();
      else if (k === "n" && mod) this.edit(this.newProject(), null);
      else if (k === "u" && mod) this.duplicateSelected();
      else if (k === "x" && mod) this.openBackup();
      else if (k === "f" && mod) this.openScan();
      else if (k === "s" && mod) this.openSettings();
      else if (k === "l" && layoutMod) this.cycleLayout(this.selected()?.p ?? blankProject());
      else if (k === "i" && layoutMod) this.toggleDetail();
      else if (k === "e" && mod) this.editSelected();
      else return;
    } else if (this.mode === "name" && k === "l" && layoutMod) this.cycleLayout(this.target);
    // Using a repo's preset file takes its own chord, never Enter: the Enter that opened this screen must not answer it.
    else if (this.mode === "settings" && mod && ["-", "=", "+", "0"].includes(k)) this.stepScale(k === "-" ? -1 : k === "0" ? 0 : 1);
    else if (this.mode === "trust" && k === "t" && mod) this.guard("repo preset", () => this.decideTrust(true))();
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
    this.frame = null;
    this.frame = { rows: this.mode === "list" ? this.rows() : [] };
    let body;
    try {
      body = { list: () => this.renderList(t, cx), edit: () => this.renderEdit(t, cx), worktrees: () => this.renderWorktrees(t, cx), backup: () => this.renderBackup(t, cx), scan: () => this.renderScan(t, cx), settings: () => this.renderSettings(t, cx), trust: () => this.renderTrust(t, cx), name: () => this.renderName(t), busy: () => this.renderBusy(t) }[this.mode]();
    } finally {
      this.frame = null;
    }
    return v_flex().id("project-presets").track_focus(this.handle).w_full().min_h(0).p(18).gap(10).bg(t.popover).text_size(z(13))
      .on_key_down(this.guard("key", (e, cx) => { log("debug", "key", { key: e.key, mods: e.modifiers, mode: this.mode }); this.keys(e, cx); }))
      .child(body);
  }

  /** A scrolling list of 48px rows: wheel and scrollbar work, and `reveal` keeps the highlight in view. */
  vlist(id, rows, render, handle, max, keyOf, onClick, sizes = null) {
    const total = sizes ? sizes.reduce((a, b) => a + b, 0) : rows.length * ROW();
    const height = Math.min(max, total);
    this.ranges[id] = { ...(this.ranges[id] ?? { start: 0, end: 0 }), visible: Math.max(1, Math.floor(height / ROW())) };
    return div().relative().flex_none().w_full().h(height).min_h(0)
      .child(v_virtual_list(id, rows.length, sizes ?? ROW(), (i) => keyOf(rows[i], i), (range) => {
        Object.assign(this.ranges[id], { start: range.start, end: range.end });
        return rows.slice(range.start, range.end).map((r, j) => render(r, range.start + j));
      }).track_scroll(handle).on_item_click(this.guard("row click", (key, cx) => onClick(key, cx))).size_full())
      .when(total > height, (el) => el.child(Scrollbar.vertical(id).viewport_from_layout().absolute().inset_0()));
  }

  /** Keeps the highlighted project in view (section headers count as list items). When it is above what is showing and a
   *  section header sits right over it, the header is brought into view instead, so the row comes with its header. */
  revealRow() {
    const items = listItems(this.rows(), Boolean(this.query()));
    const at = items.findIndex((it) => it.row && it.index === this.at);
    if (at < 0) return;
    const r = this.ranges["pp-projects"];
    this.reveal("pp-projects", this.scroll, r && at < r.start && items[at - 1]?.header ? at - 1 : at);
  }

  /** Brings list item `at` into view. herdr's scroll_to_item means "put this item on screen": it does nothing when the item
   *  is already showing and scrolls just far enough when it is not. (Asking for an item that is already on screen, as the
   *  old code did to land `at` at the bottom, scrolled nothing.) */
  reveal(_id, handle, at) {
    handle.scroll_to_item(at);
  }

  button(t, id, text, primary, action, lead = null) {
    return h_flex().id(id).gap(lead ? 6 : 0).h(z(32)).px(14).items_center().rounded(8).border_1()
      .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(z(12.5)).font_medium().cursor_pointer()
      .on_click(this.guard(`button ${id}`, (...a) => { log("debug", "click", { id }); return action(...a); }))
      .when(Boolean(lead), (el) => el.child(lead)).child(text);
  }

  /** A screen's heading: its name, the key hints, and an × that closes the picker like Esc does. `closable` false leaves
   *  the × out (while a launch is under way: closing then would cancel it). */
  title(t, text, hint, closable = true, extra = null) {
    return h_flex().gap(10).items_center().child(div().flex_1().text_size(z(15)).font_semibold().text_color(t.foreground).child(text))
      .when(Boolean(extra), (el) => el.child(extra))
      .child(div().text_size(z(11)).text_color(t.dim).child(hint))
      .when(closable, (el) => el.child(h_flex().id("pp-close").size(z(22)).flex_none().items_center().justify_center().rounded(6).border_1().border_color(t.input).bg(t.raised)
        .text_size(z(13)).text_color(t.dim).cursor_pointer().hover((e) => e.text_color(t.foreground))
        .on_click(this.guard("close", () => { log("debug", "click", { id: "pp-close" }); this.dismiss(); })).child("×")));
  }

  /** The project's avatar, drawn like herdr's sidebar draws a space's: a tile in the space's own color with the
   *  initial. A project with no open space gets an outline in no color. */
  avatar(t, p, space, size = 18) {
    size = z(size);
    const tile = h_flex().size(size).flex_none().rounded(5).items_center().justify_center().text_size(size * 0.58).font_bold();
    const initial = [...(p.name ?? "")][0]?.toUpperCase() ?? "?";
    if (!space) return tile.border_1().border_color(t.input).text_color(t.dim).child(initial);
    return tile.bg(spaceColor(this.snap.colors, space.id, t)).text_color("#ffffff").child(initial);
  }

  /** A small outlined label. */
  tag(t, text, color, border = color) {
    return div().px(8).rounded(10).border_1().border_color(border).text_size(z(10.5)).text_color(color).flex_none().child(text);
  }

  /** The selected project's mini picture of a layout's panes: the agent's pane lit when this is the one chosen. */
  layoutThumb(t, layout, on, w = z(72), h = z(38)) {
    const box = div().relative().w(w).h(h).flex_none();
    layoutRects(layout).forEach((r, i) => box.child(div().absolute().left(r.x * w + 1).top(r.y * h + 1).w(r.w * w - 2).h(r.h * h - 2).rounded(3).bg(i === 0 && on ? t.accent : on ? t.selected : t.input)));
    return box;
  }

  /** Worktrees, Edit and Delete for the highlighted project: in the detail card, or under the list without it. */
  actionButtons(t, cx) {
    return h_flex().gap(8).items_center().flex_wrap()
      .when(!this.selected()?.p.discovered, (el) => el.child(this.button(t, "pp-dup", "Duplicate", false, () => { this.duplicateSelected(); cx.notify(); })))
      .when(!this.selected()?.p.template, (el) => el.child(this.button(t, "pp-wt", "Worktrees", false, () => { this.openWorktrees(); cx.notify(); })))
      .child(this.button(t, "pp-edit", this.selected()?.p.discovered ? "Save as project…" : "Edit", false, () => { this.editSelected(); cx.notify(); }))
      .child(this.button(t, "pp-delete", this.selected()?.p.discovered ? (this.pendingDelete ? "Hide?" : "Hide") : this.pendingDelete ? "Delete?" : "Delete", false, () => { this.deleteSelected(); cx.notify(); }));
  }

  /** The detail card: what the highlighted project is, what Enter will do, and the layout choice. */
  /** The card for the template row: what it is, the settings a project made from it starts with, and its buttons. */
  renderTemplateCard(t, card, r, cx) {
    const p = r.p;
    const name = commandName(p.startup.agent);
    const program = name && this.allAgents.find((a) => a.key === name || commandName((a.run ?? []).join(" ")) === name);
    const kv = (k, v) => h_flex().gap(10).text_size(z(12)).text_color(t.foreground).child(div().w(z(84)).text_color(t.dim).child(k)).child(v);
    return card
      .child(h_flex().gap(10).items_center()
        .child(this.avatar(t, p, null, 24))
        .child(div().text_size(z(16)).font_semibold().text_color(t.foreground).child(p.name))
        .child(this.tag(t, "template", t.accent)))
      .child(div().text_size(z(12)).text_color(t.dim).child(`Not a real project: it has no folder. Edit it (${key("e")}) to set the defaults you want, then use it to make projects. Add project starts from it once you have saved it.`))
      .child(v_flex().gap(3)
        .child(kv("Agent", program?.name ?? (name || "plain shell")))
        .child(kv("Layout", p.startup.layout || "agent only"))
        .child(kv("Worktrees", enterAction(p.worktree.mode)[0]))
        .when(Boolean(p.group), (el) => el.child(kv("Group", p.group))))
      .child(h_flex().gap(8).items_center().flex_wrap()
        .child(this.button(t, "pp-use", "Use template", true, () => { this.duplicateSelected(); cx.notify(); })));
  }

  renderCard(t, r, cx) {
    const card = v_flex().w(CARD()).flex_none().gap(10).p(14).rounded(12).border_1().border_color(t.input).bg(t.raised);
    if (!r) return card.child(div().text_color(t.dim).text_size(z(12)).child("Nothing selected."));
    const p = r.p;
    if (p.template) return this.renderTemplateCard(t, card, r, cx);
    const folder = projectFolder(p);
    const info = this.info[folder];
    const name = commandName(p.startup.agent);
    const program = name && this.allAgents.find((a) => a.key === name || commandName((a.run ?? []).join(" ")) === name);
    const kv = (k, v) => h_flex().gap(10).items_start().text_size(z(12))
      .child(div().w(z(84)).flex_none().text_color(t.dim).child(k))
      .child(div().flex_1().min_w(0).text_color(t.foreground).child(v));
    const current = this.layoutNameFor(p);
    const choices = [{ name: "", label: "Agent only", panes: [{ type: "agent" }] }, ...this.layouts];
    const [what, openLabel] = enterAction(p.worktree.mode);
    const shown = choices.find((c) => c.name === current);
    const dirtyText = info == null ? "…" : info.dirty ? `${info.dirty} file${info.dirty > 1 ? "s" : ""} modified` : "clean";
    return card
      .child(h_flex().gap(10).items_center().flex_wrap()
        .child(this.avatar(t, p, r.space, 24))
        .child(div().text_size(z(16)).font_semibold().text_color(t.foreground).child(p.name))
        .when(Boolean(r.space), (el) => el.child(this.tag(t, r.space.status === "working" ? "agent working" : "open", r.space.status === "working" ? t.working : t.done)))
        .when(p.pinned, (el) => el.child(this.tag(t, "pinned", t.dim, t.input)))
        .when(Boolean(p.discovered), (el) => el.child(this.tag(t, "found", t.dim, t.input))))
      .when(Boolean(p.discovered), (el) => el.child(div().text_size(z(12)).text_color(p.preset === "error" ? t.blocked : t.dim).child(
        p.preset === "used" ? `Found by a folder scan. It opens with the repo's ${PRESET_FILE} on top of your Template.`
        : p.preset === "review" ? `Found by a folder scan. The repo has a ${PRESET_FILE}: Enter shows what it sets, before anything runs.`
        : p.preset === "ignored" ? `Found by a folder scan. You chose to ignore the repo's ${PRESET_FILE}, so it opens with your Template's settings.`
        : p.preset === "error" ? `Found by a folder scan. The repo's ${PRESET_FILE} can't be used (${p.presetError}), so it opens with your Template's settings.`
        : "Found by a folder scan. It opens with your Template's settings; Save as project… gives it settings of its own.")))
      .child(v_flex().gap(4)
        .child(kv("Agent", h_flex().gap(6).items_center().child(this.agentIcon(t, p, 14)).child(div().child(program?.name ?? (name || "plain shell")))))
        .when(Boolean(p.group), (el) => el.child(kv("Group", p.group)))
        .when(this.gitInfo, (el) => el.child(kv("Branch", info?.branch ?? "…")).child(kv("Changes", info?.dirty ? div().text_color(t.working).child(dirtyText) : dirtyText)).child(kv("Worktrees", info == null ? "…" : String(info.worktrees))))
        .child(kv("Last opened", ago(this.snap.recent[p.path]))))
      .child(v_flex().gap(6)
        .child(h_flex().items_center().child(div().flex_1().text_size(z(10.5)).font_semibold().text_color(t.dim).child(`LAYOUT${this.layoutPick !== null ? " · PICKED" : ""}`))
          .child(div().px(6).rounded(5).border_1().border_color(t.input).text_size(z(10.5)).text_color(t.foreground).child(LAYOUT_HINT())))
        .child(h_flex().gap(8).items_start().flex_wrap().children(choices.map((c, i) => {
          const on = c.name === current;
          const lit = on && this.layoutLit;
          return v_flex().id(`pp-lay-${i}`).gap(4).p(6).rounded(9).border_1().cursor_pointer()
            .border_color(on ? (lit ? t.accent : t.solid) : t.input).bg(on ? t.selected : t.background)
            .on_click(this.guard("layout click", () => { this.layoutPick = c.name === (p.startup.layout ?? "") ? null : c.name; cx.notify(); }))
            .child(this.layoutThumb(t, c, on))
            .child(div().text_size(z(10.5)).max_w(z(72)).text_color(on ? t.foreground : t.dim).when(on, (el) => (lit ? el.font_bold() : el.font_semibold())).child(c.label ?? c.name))
            .when(c.name === (p.startup.layout ?? ""), (el) => el.child(div().text_size(z(9.5)).text_color(t.dim).child("project default")));
        }))))
      .child(div().text_size(z(12)).text_color(t.dim).child(p.preset === "review" ? "Enter shows the repo's preset file first; nothing opens until you answer." : `Enter ${what}${shown && shown.name ? ` and opens ${(shown.label ?? shown.name).toLowerCase()}` : " and opens the agent alone"}.`))
      .child(h_flex().gap(8).items_center()
        .child(this.button(t, "pp-open", openLabel, true, () => { this.activate(false); cx.notify(); }))
        .child(this.button(t, "pp-checkout", "Checkout", false, () => { this.activate(true); cx.notify(); })));
  }

  /** Under the list: the hints and the layout choice, then the buttons. With the card its buttons are in the card, so
   *  only Hide details and Add project share the hints' row; without it the hints get a row of their own. */
  /** The row of buttons under the search box: Add project, then what acts on the highlighted project (named at the
   *  right), then the import/export screen and the card toggle. */
  renderToolbar(t, cx, rows) {
    const sel = this.selected();
    return h_flex().gap(8).items_center().flex_wrap()
      .child(this.button(t, "pp-add", "Add project", true, () => { this.edit(this.newProject(), null); cx.notify(); }))
      .when(rows.length > 0, (el) => el.child(this.actionButtons(t, cx)))
      .child(div().flex_1().min_w(0).truncate().text_size(z(11)).text_color(t.dim).when(Boolean(sel), (e) => e.child(`acts on ${sel.p.name}`)))
      .child(this.button(t, "pp-scan", "Scan…", false, () => { this.openScan(); cx.notify(); }))
      .child(this.button(t, "pp-backup", "Import / export…", false, () => { this.openBackup(); cx.notify(); }))
      .child(this.button(t, "pp-launcher", this.snap.launcherInLayout ? `Launcher: ${LAUNCHERS.find(([k]) => k === this.snap.launcher)?.[1]}` : "Launcher: add to layout", false, () => { this.cycleLauncher(); cx.notify(); }))
      .child(this.button(t, "pp-details", this.detail ? "Hide details" : "Show details", false, () => { this.toggleDetail(); cx.notify(); }));
  }

  listFooter(t) {
    return this.footer(t, this.selected()?.p ?? blankProject(), true);
  }

  /** Found checkouts can be many, so their git details are not read up front like the saved projects': only the
   *  highlighted one's are, once. */
  infoForSelected(cx, r) {
    if (!this.gitInfo || !r?.p.discovered) return;
    const folder = projectFolder(r.p);
    if (folder in this.info || this.infoAsked?.has(folder)) return;
    const hit = infoCache.get(folder);
    if (hit && Date.now() - hit.at < INFO_FRESH_MS) { this.info[folder] = hit.info; return; }
    (this.infoAsked ??= new Set()).add(folder);
    cx.spawn(async (cx) => {
      const info = await gitSummary(folder);
      infoCache.set(folder, { info, at: Date.now() });
      this.info[folder] = info;
      this.bump(cx);
    });
  }

  renderList(t, cx) {
    const rows = this.rows();
    if (this.at >= rows.length) this.at = Math.max(0, rows.length - 1);
    this.infoForSelected(cx, rows[this.at]);
    const projectKey = (r) => `${r.p.name}\u0000${r.p.path}`;
    const items = listItems(rows, Boolean(this.query()));
    const stripe = (r) => (r.space ? (t[r.space.status] ?? t.done) : null);
    const row = (r, i) => {
      const on = i === this.at;
      const info = this.info[projectFolder(r.p)];
      return h_flex().id(`pp-${i}`).relative().w_full().h(ROW()).flex_none().overflow_hidden().pl(14).pr(12).gap(10).items_center().rounded(8).cursor_pointer()
        .when(on, (el) => el.bg(t.selected))
        .when(Boolean(r.space), (el) => el.child(div().absolute().left(0).top(9).w(3).h(ROW() - 18).rounded(2).bg(stripe(r))
          .when(r.space.status === "working", (e) => e.loop("opacity", { from: 1, to: 0.35, period: 1000 }))))
        .child(this.avatar(t, r.p, r.space))
        .child(this.agentIcon(t, r.p))
        .child(v_flex().flex_1().min_w(0)
          .child(this.nameText(t, r.p.name))
          .child(div().text_size(z(11)).text_color(t.dim).truncate().child(r.p.template ? "A starting point: press Enter to make a project from it" : shortHome(projectFolder(r.p), homeOf()))))
        .when(Boolean(r.p.template), (el) => el.child(this.tag(t, "template", t.accent)))
        .when(Boolean(r.p.preset), (el) => el.child(this.tag(t, PRESET_STATE[r.p.preset], r.p.preset === "used" ? t.accent : r.p.preset === "review" ? t.working : r.p.preset === "error" ? t.blocked : t.dim, r.p.preset === "ignored" ? t.input : undefined)))
        .when(Boolean(r.p.group), (el) => el.child(div().text_size(z(11)).text_color(t.dim).child(r.p.group)))
        .when(Boolean(info), (el) => el.child(h_flex().gap(5).flex_none()
          .child(this.tag(t, info.branch, t.dim, t.input))
          .when(info.dirty > 0, (e) => e.child(this.tag(t, `${info.dirty} changed`, t.working)))
          .when(info.worktrees > 0, (e) => e.child(this.tag(t, `${info.worktrees} wt`, t.accent)))));
    };
    const item = (it, i) => it.header
      ? div().w_full().h(HEADER()).flex_none().px(14).pb(3).flex().items_end().text_size(z(10.5)).font_semibold().text_color(t.dim).child(it.header.toUpperCase())
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
    }, items.map((it) => (it.header ? HEADER() : ROW())));
    return v_flex().gap(10).min_h(0)
      // Settings sits in the heading, not the toolbar: the toolbar has no room left for it beside "acts on <name>".
      .child(this.title(t, "Projects", "Esc", true, h_flex().id("pp-settings").h(z(22)).px(9).flex_none().items_center().rounded(6).border_1().border_color(t.input).bg(t.raised)
        .text_size(z(11)).text_color(t.dim).cursor_pointer().hover((e) => e.text_color(t.foreground))
        .on_click(this.guard("button pp-settings", () => { log("debug", "click", { id: "pp-settings" }); this.openSettings(); cx.notify(); })).child("Settings")))
      .child(h_flex().h(z(36)).flex_none().px(10).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.search).flex_1().h_full().text_size(z(12.8)).text_color(t.foreground))
        .child(div().text_size(z(11)).text_color(t.dim).child(`${rows.length} of ${this.allProjects().length}`)))
      .child(this.renderToolbar(t, cx, rows))
      .child(this.error ? div().text_size(z(12)).text_color(t.blocked).child(this.error) : div())
      .child(h_flex().gap(14).items_start().min_h(0)
        .child(v_flex().flex_1().min_w(0).gap(6)
          .child(list)
          .when(!rows.length, (el) => el.child(div().py(14).text_color(t.dim).child("No project matches.")))
          .when(!this.query() && !this.projects.some((p) => !p.template) && !this.found().length, (el) => el.child(div().py(8).px(14).text_size(z(12)).text_color(t.dim).child(this.virtualTemplate || this.projects.some((p) => p.template)
            ? "No projects yet. Edit the Template to suit you ({e}), then press Enter on it to make your first project, or click Add project. Scan… ({f}) lists every checkout under a folder for you.".replace("{e}", key("e")).replace("{f}", key("f"))
            : `No projects yet. Click Add project and choose a git checkout, or Scan… (${key("f")}) to list every checkout under a folder.`))))
        .when(this.detail, (el) => el.child(this.renderCard(t, this.selected(), cx))))
      .when(Boolean(this.pendingDelete), (el) => el.child(div().text_size(z(12)).text_color(t.blocked).child(this.pendingDelete.template
        ? `Remove the template? Press ${key("d")} again or click Delete. To bring it back later, delete "hideTemplate" from project-presets.json.`
        : this.pendingDelete.discovered ? `Hide "${this.pendingDelete.name}" from the list? Press ${key("d")} again or click Hide. Nothing on disk changes; Scan… can show hidden checkouts again.`
        : `Remove "${this.pendingDelete.name}" from the list? Press ${key("d")} again or click Delete. The folder and its worktrees stay.`)))
      .child(this.listFooter(t));
  }

  renderWorktrees(t, cx) {
    const rows = this.wtRows();
    if (this.wtAt >= rows.length) this.wtAt = Math.max(0, rows.length - 1);
    const count = this.wtSel.size;
    const row = (w, i) => h_flex().id(`pp-wt-${i}`).w_full().h(ROW()).flex_none().overflow_hidden().px(12).gap(10).items_center().rounded(8).cursor_pointer()
      .when(i === this.wtAt, (el) => el.bg(t.selected))
      .child(div().w(z(14)).flex_none().text_color(this.wtSel.has(w.path) ? t.accent : t.dim).child(this.wtSel.has(w.path) ? "☑" : "☐"))
      .child(v_flex().flex_1().min_w(0)
        .child(div().text_color(t.foreground).font_medium().truncate().child(w.branch ?? "(detached)"))
        .child(div().text_size(z(11)).text_color(t.dim).truncate().child(shortHome(w.path, homeOf()))))
      .when(Boolean(w.space), (el) => el.child(div().text_size(z(11)).text_color(t.dim).child("open")))
      .when(w.dirty, (el) => el.child(div().text_size(z(11)).text_color(t.blocked).child("uncommitted")))
      .when(w.locked, (el) => el.child(div().text_size(z(11)).text_color(t.blocked).child("locked")))
      .child(div().text_size(z(11)).text_color(w.merged ? t.done : t.dim).child(w.merged ? "merged" : "unmerged"));
    return v_flex().gap(10).min_h(0)
      .child(this.title(t, `Worktrees · ${this.target.name}`, `${backKey()} back · Esc closes`))
      .child(h_flex().h(z(36)).flex_none().px(10).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.wtSearch).flex_1().h_full().text_size(z(12.8)).text_color(t.foreground)))
      .when(Boolean(this.error), (el) => el.child(div().text_size(z(12)).text_color(t.blocked).child(this.error)))
      .child(this.vlist("pp-worktrees", rows, row, this.wtScroll, 340, (w) => w.path, (key, cx) => {
        const i = rows.findIndex((w) => w.path === key);
        if (i < 0) return;
        this.wtAt = i;
        this.toggleWt();
        cx.notify();
      }))
      .when(this.wts === null, (el) => el.child(div().py(14).text_color(t.dim).child("Looking at worktrees…")))
      .when(this.wts !== null && !rows.length, (el) => el.child(div().py(14).text_color(t.dim).child(this.wts.length ? "No worktree matches." : "No worktrees besides the main checkout.")))
      .when(this.wtConfirm, (el) => el.child(div().text_size(z(12)).text_color(t.blocked).child(`Remove ${count} worktree${count > 1 ? "s" : ""}${[...(this.wts ?? [])].some((w) => this.wtSel.has(w.path) && w.space) ? ", and close their spaces" : ""}? Merged branches are deleted too. Press ${key("r")} again or click.`)))
      .child(div().text_size(z(11)).text_color(t.dim).child(`Enter tick · ${key("m")} tick all merged · ${key("r")} remove ticked. Worktrees with uncommitted changes are refused.`))
      .child(h_flex().gap(8).items_center().justify_end()
        .child(this.button(t, "pp-wt-merged", "Tick merged", false, () => { this.selectMerged(); cx.notify(); }))
        .child(this.button(t, "pp-wt-remove", this.wtConfirm ? `Click again to remove ${count}` : `Remove ${count} ticked`, count > 0, () => { this.removeSelected(); cx.notify(); })));
  }

  renderName(t) {
    const p = this.target;
    return v_flex().gap(10)
      .child(this.title(t, `New worktree · ${p.name}`, `${backKey()} back · Esc closes`))
      .child(h_flex().h(z(36)).px(10).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.nameInput).flex_1().h_full().text_size(z(12.8)).text_color(t.foreground)))
      .child(div().text_size(z(12)).text_color(this.error ? t.blocked : t.dim).child(this.error ?? (this.preview ? `branch: ${this.preview}` : "")))
      .child(div().text_size(z(FOOTER_SIZE)).text_color(t.dim).child(`from ${p.git.remote}/${p.git.base}${p.git.fetch ? " after a fetch" : ""} · Enter to create`))
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
    return notes.map((n, i) => h_flex().gap(8).items_baseline().text_size(z(12))
      .child(mark(i).w(z(12)).flex_none())
      .child(div().flex_1().min_w(0).text_color(i === notes.length - 1 && !this.error ? t.foreground : t.dim).child(n)));
  }

  renderBusy(t) {
    return v_flex().gap(8)
      .child(this.title(t, this.target.name, this.error ? "Esc back" : "working…", Boolean(this.error)))
      .child(v_flex().gap(3).children(this.stepRows(t)))
      .when(Boolean(this.error), (el) => el.child(div().text_size(z(12.5)).text_color(t.blocked).child(this.error)));
  }

  /** Shown under the editor after Save on a template with changes: the three ways to go on. */
  renderApplyAsk(t, cx) {
    const { changes, count } = this.applyAsk;
    const plural = count === 1 ? "project" : "projects";
    return v_flex().pt(10).gap(8)
      .child(div().text_size(z(12.5)).text_color(t.foreground).child(`You changed: ${changes.map((c) => c.label).join(", ")}. Apply ${changes.length === 1 ? "it" : "them"} to your ${count} existing ${plural} too?`))
      .child(div().text_size(z(11.5)).text_color(t.dim).child("Only these settings are written. Each project keeps its name, folder, group, pin and every other setting."))
      .child(h_flex().gap(8)
        .child(this.button(t, "pp-apply-all", `Apply to ${count === 1 ? "the project" : `all ${count} projects`}`, true, () => this.save(cx, true)))
        .child(this.button(t, "pp-apply-none", "Only the template", false, () => this.save(cx, false)))
        .child(this.button(t, "pp-apply-back", "Keep editing", false, () => { this.applyAsk = null; cx.notify(); })));
  }

  renderEdit(t, cx) {
    const d = this.draft;
    const label = (text, note) => h_flex().gap(8).items_baseline().pt(10).pb(5)
      .child(div().text_size(z(11.5)).text_color(t.dim).child(text))
      .when(Boolean(note), (el) => el.child(div().text_size(z(10.5)).text_color(t.muted ?? t.dim).child(note)));
    const field = (key) => {
      const [, name, , , note] = TEXT.find(([k]) => k === key);
      const state = this.fields.find(([k]) => k === key)[1];
      return v_flex().child(label(name, note))
        .child(Input.new(state).h(z(34)).px(10).rounded(8).border_1().border_color(this.field === key ? t.accent : t.input).bg(t.background).text_size(z(12.8)).text_color(t.foreground));
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
          .child(div().text_size(z(11.5)).text_color(t.dim).child(MODE_HELP[d.worktree.mode])),
        field("branchTemplate"),
        field("root"),
        field("spaceName"),
        h_flex().pt(12).gap(8).items_center()
          .child(toggle("pp-repospace", "Open the repo's space first", d.worktree.repoSpace, (v) => (d.worktree.repoSpace = v)))
          .child(div().flex_1().min_w(0).text_size(z(11.5)).text_color(t.dim).child("worktrees then nest under it in the sidebar")),
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
          .child(div().text_size(z(11.5)).text_color(t.dim).child(d.startup.promptMode === "send" ? "for agents that reject a prompt argument" : "claude and most agents")),
        field("layout"),
        field("setup"),
        field("tabs"),
      ],
    };
    return v_flex().gap(0).min_h(0)
      .child(this.title(t, { add: "Add project", edit: "Edit project", duplicate: "Duplicate project", template: "Edit template", fromTemplate: "New project from the template" }[this.editKind ?? "add"], `Tab next field · ${key("s", "ctrl")} save · ${backKey()} back · Esc closes`))
      .child(h_flex().pt(10).gap(6)
        .children(SECTIONS.map(([id, name]) => this.button(t, `pp-sec-${id}`, name, this.section === id, () => this.showSection(id)))))
      .child(v_flex().min_h(0).h(430).overflow_y_scrollbar().pr(8).children(sections[this.section]()))
      .when(Boolean(this.presetNote), (el) => el.child(div().pt(8).text_size(z(12)).text_color(this.presetNote.bad ? t.blocked : t.done).child(this.presetNote.text)))
      .child(this.error ? div().pt(8).text_size(z(12)).text_color(t.blocked).child(this.error) : div())
      .when(Boolean(this.applyAsk), (el) => el.child(this.renderApplyAsk(t, cx)))
      .child(h_flex().pt(12).gap(8).justify_end()
        .when(this.index != null, (el) => el.child(this.button(t, "pp-del", this.confirmDelete ? "Click again to delete" : "Delete", false, () => this.remove(cx))))
        .when(!d.template, (el) => el.child(this.button(t, "pp-write-preset", this.presetConfirm ? "Click again to replace the repo's file" : "Write repo preset", false, () => this.writePreset(cx))))
        .child(div().flex_1())
        .child(this.button(t, "pp-cancel", "Cancel", false, () => { this.mode = "list"; this.error = null; this.search.focus(); cx.notify(); }))
        .child(this.button(t, "pp-save", "Save", true, () => this.save(cx))));
  }
}
