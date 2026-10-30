// Project presets: a picker of configured git checkouts, each with its own worktree and startup
// settings. Type to filter, ↑/↓ and Enter to open, Shift+Enter for the main checkout, ctrl+n to add,
// ctrl+e to edit, Esc to leave.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { knownAgents, theme, props, closeOverlay, run, pickFolder, shared, setShared, notify, home } from "herdr";
import { loadConfig, saveConfig } from "./config.js";
import { inspect, projectFolder, previewBranch, createWorktree, prepareMain, runSetup, findSpace, launch } from "./git.js";
import { initLog, log, logError } from "./log.js";
import { fuzzy, blankProject, shortHome, splitList, joinList, basename } from "./lib.js";

const RECENT = "project-presets.recent";
const MODES = ["ask", "always", "never"];
const MODE_HELP = { ask: "ask for a branch name", always: "always a new worktree", never: "open the checkout" };

// Editor fields: text ones keep an InputState, the rest are buttons.
const TEXT = [
  ["name", "Name", (p) => p.name, (p, v) => (p.name = v)],
  ["path", "Folder", (p) => p.path, (p, v) => (p.path = v)],
  ["group", "Group", (p) => p.group, (p, v) => (p.group = v)],
  ["branchTemplate", "Branch name", (p) => p.worktree.branchTemplate, (p, v) => (p.worktree.branchTemplate = v), "{user} {date} {slug} {repo} {project}"],
  ["root", "Worktree folder", (p) => p.worktree.root, (p, v) => (p.worktree.root = v), "{repo} {branch} plus the above"],
  ["remote", "Remote", (p) => p.git.remote, (p, v) => (p.git.remote = v)],
  ["base", "Base branch", (p) => p.git.base, (p, v) => (p.git.base = v)],
  ["agent", "Agent command", (p) => p.startup.agent, (p, v) => (p.startup.agent = v), "pick above or type one; empty: plain shell"],
  ["args", "Agent arguments", (p) => p.startup.args, (p, v) => (p.startup.args = v), "e.g. --model opus --permission-mode plan"],
  ["prompt", "First prompt", (p) => p.startup.prompt, (p, v) => (p.startup.prompt = v), "sent to the agent; ignored without one"],
  ["setup", "Setup commands", (p) => joinList(p.startup.setup), (p, v) => (p.startup.setup = splitList(v)), "separate with ;; — each limited to 30 s"],
  ["tabs", "Extra tabs", (p) => joinList(p.startup.tabs), (p, v) => (p.startup.tabs = splitList(v)), "commands, separate with ;;"],
];

export default class ProjectPresets extends View {
  init(_props, cx) {
    this.cx = cx;
    this.overlay = props()?.overlay;
    this.projects = [];
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
    knownAgents().then((a) => { this.agents = a.filter((x) => x.installed); cx.notify(); }).catch((e) => logError("knownAgents", e));
    initLog();
    this.reload(cx);
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

  reload(cx) {
    cx.spawn(async (cx) => {
      try {
        const c = await loadConfig();
        this.projects = c.projects;
        this.raw = c.raw;
      } catch (e) {
        logError("load config", e);
        this.error = e.message;
      }
      cx.notify();
    });
  }

  close() { closeOverlay(this.overlay); }

  query() { return this.search.value(); }

  // ---- list -------------------------------------------------------------

  rows() {
    const q = this.query();
    const recent = shared(RECENT) ?? {};
    const rows = this.projects.map((p) => {
      const score = Math.max(fuzzy(q, p.name), fuzzy(q, p.group), fuzzy(q, basename(p.path)) - 1);
      return { p, score, space: findSpace(p), used: recent[p.path] ?? 0 };
    }).filter((r) => r.score >= 0);
    rows.sort((a, b) => q
      ? b.score - a.score
      : (!!b.space - !!a.space) || (b.p.pinned - a.p.pinned) || (b.used - a.used) || a.p.name.localeCompare(b.p.name));
    return rows;
  }

  selected() { return this.rows()[this.at]; }

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
    cx?.spawn(async (cx) => {
      try { this.preview = await previewBranch(p, text); this.error = null; } catch (e) { this.error = e.message; }
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
        let folder = projectFolder(p);
        let name = p.name;
        const existing = findSpace(p);
        if (worktree) {
          const wt = await createWorktree(p, slugText, log);
          folder = wt.folder;
          name = `${p.name} · ${wt.branch}`;
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
        this.close();
        launch(p, folder, name);
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
    this.fields[0][1].focus();
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
      for (const [key, state] of this.fields) TEXT.find(([k]) => k === key)[3](this.draft, state.value().trim());
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
    const i = this.fields.findIndex(([k]) => k === this.field);
    this.fields[(i + (back ? -1 : 1) + this.fields.length) % this.fields.length][1].focus();
  }

  editSelected() {
    const r = this.selected();
    if (r) this.edit(r.p, this.projects.indexOf(r.p));
  }

  // ---- keys -------------------------------------------------------------

  keys(e, cx) {
    const k = e.key;
    const ctrl = e.modifiers.control;
    if (k === "escape") {
      if (this.mode === "list") this.close();
      else if (this.mode === "busy" && !this.error) return;
      else { this.mode = "list"; this.error = null; this.search.focus(); }
    } else if (this.mode === "list") {
      const n = this.rows().length;
      if (k === "down" && n) this.at = (this.at + 1) % n;
      else if (k === "up" && n) this.at = (this.at + n - 1) % n;
      else if (k === "enter" && e.modifiers.shift) { this.handled = Date.now(); this.activate(true); }
      else if (k === "n" && (ctrl || e.modifiers.alt)) this.edit(blankProject(), null);
      else if (k === "e" && (ctrl || e.modifiers.alt)) this.editSelected();
      else return;
    } else if (this.mode === "edit" && k === "tab") this.focusNextField(e.modifiers.shift);
    else if (this.mode === "edit" && k === "s" && ctrl) this.save(cx);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  // ---- render -----------------------------------------------------------

  render() {
    const cx = this.cx;
    const t = theme();
    const body = { list: () => this.renderList(t, cx), edit: () => this.renderEdit(t, cx), name: () => this.renderName(t), busy: () => this.renderBusy(t) }[this.mode]();
    return v_flex().id("project-presets").track_focus(this.handle).w_full().min_h(0).p(18).gap(10).bg(t.popover).text_size(13)
      .on_key_down(this.guard("key", (e, cx) => { log("debug", "key", { key: e.key, mods: e.modifiers, mode: this.mode }); this.keys(e, cx); }))
      .child(body);
  }

  button(t, id, text, primary, action) {
    return h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1()
      .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(this.guard(`button ${id}`, (...a) => { log("debug", "click", { id }); return action(...a); })).child(text);
  }

  title(t, text, hint) {
    return h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child(text))
      .child(div().text_size(11).text_color(t.dim).child(hint));
  }

  renderList(t, cx) {
    const rows = this.rows();
    if (this.at >= rows.length) this.at = Math.max(0, rows.length - 1);
    const row = (r, i) => {
      const on = i === this.at;
      const mode = r.p.worktree.mode;
      return h_flex().id(`pp-${i}`).w_full().h(48).flex_none().overflow_hidden().px(12).gap(10).items_center().rounded(8).cursor_pointer()
        .bg(on ? t.selected : "transparent")
        .on_click(this.guard("row click", () => { log("debug", "click row", { i }); this.at = i; this.activate(false); }))
        .child(div().w(10).flex_none().text_color(r.space ? (t[r.space.status] ?? t.done) : t.dim).child(r.space ? "●" : r.p.pinned ? "★" : "·"))
        .child(v_flex().flex_1().min_w(0)
          .child(div().text_color(t.foreground).font_medium().child(r.p.name))
          .child(div().text_size(11).text_color(t.dim).truncate().child(shortHome(projectFolder(r.p), home()))))
        .when(Boolean(r.p.group), (el) => el.child(div().text_size(11).text_color(t.dim).child(r.p.group)))
        .child(div().text_size(11).text_color(t.dim).child(mode === "never" ? "checkout" : mode === "ask" ? "worktree?" : "worktree"));
    };
    return v_flex().gap(10).min_h(0)
      .child(this.title(t, "Projects", "Esc"))
      .child(h_flex().h(36).flex_none().px(10).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.search).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .child(this.error ? div().text_size(12).text_color(t.blocked).child(this.error) : div())
      .child(v_flex().min_h(0).h(Math.min(380, 8 + rows.length * 48)).overflow_y_scrollbar().children(rows.map(row)))
      .when(!rows.length, (el) => el.child(div().py(14).text_color(t.dim).child(this.projects.length ? "No project matches." : "No projects yet. Click Add project below a git checkout.")))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().text_size(11).text_color(t.dim).child("Enter open · Shift+Enter main checkout · alt+n add · alt+e edit"))
        .when(rows.length > 0, (el) => el.child(this.button(t, "pp-edit", "Edit", false, () => { this.editSelected(); cx.notify(); })))
        .child(this.button(t, "pp-add", "Add project", true, () => { this.edit(blankProject(), null); cx.notify(); })));
  }

  renderName(t) {
    const p = this.target;
    return v_flex().gap(10)
      .child(this.title(t, `New worktree · ${p.name}`, "Esc back"))
      .child(h_flex().h(36).px(10).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.nameInput).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .child(div().text_size(12).text_color(this.error ? t.blocked : t.dim).child(this.error ?? (this.preview ? `branch: ${this.preview}` : "")))
      .child(div().text_size(11).text_color(t.dim).child(`from ${p.git.remote}/${p.git.base}${p.git.fetch ? " after a fetch" : ""} · Enter to create`));
  }

  renderBusy(t) {
    return v_flex().gap(8)
      .child(this.title(t, this.target.name, this.error ? "Esc back" : "working…"))
      .child(v_flex().gap(2).children(this.notes.map((n) => div().text_size(12).text_color(t.dim).child(n))))
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
    const chip = (id, text, value) => this.button(t, id, text, agentState().value().trim() === value, () => { agentState().set_value(value); cx.notify(); });
    const toggle = (id, text, value, set) => this.button(t, id, `${value ? "✓" : "○"} ${text}`, false, () => { set(!value); cx.notify(); });
    const section = (text) => div().pt(16).text_size(11).font_semibold().text_color(t.dim).child(text.toUpperCase());
    return v_flex().gap(0).min_h(0)
      .child(this.title(t, this.index == null ? "Add project" : "Edit project", "Tab next field · ctrl+s save · Esc back"))
      .child(v_flex().min_h(0).h(460).overflow_y_scrollbar().pr(8)
        .child(field("name"))
        .child(field("path"))
        .child(h_flex().pt(6).gap(8).child(this.button(t, "pp-browse", "Browse…", false, () => this.browse(cx))))
        .child(field("group"))
        .child(h_flex().pt(8).child(toggle("pp-pin", "Pin to top", d.pinned, (v) => (d.pinned = v))))
        .child(section("When selected"))
        .child(h_flex().pt(8).gap(8).items_center()
          .child(this.button(t, "pp-mode", `Worktree: ${d.worktree.mode}`, false, () => { d.worktree.mode = MODES[(MODES.indexOf(d.worktree.mode) + 1) % MODES.length]; cx.notify(); }))
          .child(div().text_size(11.5).text_color(t.dim).child(MODE_HELP[d.worktree.mode])))
        .child(field("branchTemplate"))
        .child(field("root"))
        .child(section("Git"))
        .child(h_flex().pt(8).gap(8)
          .child(toggle("pp-fetch", "Fetch first", d.git.fetch, (v) => (d.git.fetch = v)))
          .child(toggle("pp-ff", "Fast-forward checkout", d.git.fastForward, (v) => (d.git.fastForward = v))))
        .child(field("remote"))
        .child(field("base"))
        .child(section("Startup"))
        .child(label("Agent"))
        .child(h_flex().flex_wrap().gap(6)
          .child(chip("pp-agent-shell", "Shell", "", ""))
          .children(this.agents.map((a, i) => chip(`pp-agent-${i}`, a.name, a.run.join(" "), a.run.join(" ")))))
        .child(field("agent"))
        .child(field("args"))
        .child(field("prompt"))
        .child(field("setup"))
        .child(field("tabs")))
      .child(this.error ? div().pt(8).text_size(12).text_color(t.blocked).child(this.error) : div())
      .child(h_flex().pt(12).gap(8).justify_end()
        .when(this.index != null, (el) => el.child(this.button(t, "pp-del", this.confirmDelete ? "Click again to delete" : "Delete", false, () => this.remove(cx))))
        .child(div().flex_1())
        .child(this.button(t, "pp-cancel", "Cancel", false, () => { this.mode = "list"; this.error = null; this.search.focus(); cx.notify(); }))
        .child(this.button(t, "pp-save", "Save", true, () => this.save(cx))));
  }
}
