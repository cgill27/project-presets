// The picker's view, run without a window: gpui is replaced by a recording stub (test/helpers/gpui-stub.mjs), so the
// tests render each screen, press keys, click buttons and read back the text, icons and styles.
import "./helpers/setup.mjs";
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { makeRepo, scratch, sh } from "./helpers/repo.mjs";

const { state, reset } = await import("./helpers/herdr-stub.mjs");
const { textOf, findAll } = await import("./helpers/gpui-stub.mjs");
const { default: Picker } = await import("../mods/project-presets/main.js");
const { normalize } = await import("../mods/project-presets/lib.js");

const dataFile = () => `${state.appHome}/data/project-presets.json`;
beforeEach(reset);

const mods = (o = {}) => ({ control: false, alt: false, platform: false, shift: false, ...o });
const press = (v, cx, key, m) => v.keys({ key, modifiers: mods(m) }, cx);
// Enter reaches the picker through the search box's (or the name box's) submit event, not the key handler.
const enter = (v) => (v.mode === "name" ? v.nameInput : v.search).emit("submit");
const CTRL_ALT = { control: true, alt: true };

/** A picker with these projects (and layouts) in its data file, loaded and rendered once. */
async function open(projects, layouts) {
  reset();
  mkdirSync(`${state.appHome}/data`, { recursive: true });
  writeFileSync(dataFile(), JSON.stringify({ ...(layouts ? { layouts } : {}), projects }, null, 2));
  const pending = [];
  const cx = {
    timers: [],
    timer: { after: (ms, fn) => cx.timers.push({ ms, fn }) },
    spawn: (fn) => { const p = fn(cx); pending.push(p); return p; },
    focus_handle: () => ({}),
    notify() {},
    stop_propagation() {},
    settle: async () => { for (let i = 0; i < 6; i++) { await Promise.all(pending.splice(0)); await new Promise((r) => setImmediate(r)); } },
    fire: (ms) => { for (const t of cx.timers.filter((x) => x.ms === ms)) t.fn(); },
  };
  const v = new Picker();
  v.init({}, cx);
  await cx.settle();
  return { v, cx };
}
const proj = (name, path, over = {}) => normalize({ name, path, git: { fetch: false }, ...over });
const rendered = (v) => v.render();
const texts = (v) => textOf(rendered(v));
/** The detail card's layout choices: label → element, so a test can look at its styles. */
const chips = (v) => {
  const found = {};
  for (const el of findAll(rendered(v), (e) => /^pp-lay-/.test(e.op?.("id")?.[0] ?? ""))) found[textOf(el).replace(/project default$/, "")] = el;
  return found;
};
const lit = (chip) => chip.op("bg")[0] === "#selected";
const labelOf = (chip) => findAll(chip, (e) => e.tag === "div" && e.has("text_size") && e.op("text_size")[0] === 10.5)[0];

// ---------------------------------------------------------------- the list

test("the list shows each project with its folder, mode and group", async () => {
  const { v } = await open([proj("api", "/r/api", { group: "platform", worktree: { mode: "always" } }), proj("docs", "/r/docs", { worktree: { mode: "never" } })]);
  const t = texts(v);
  for (const s of ["Projects", "api", "docs", "/r/api", "platform", "worktree", "checkout"]) assert.ok(t.includes(s), s);
});

test("an empty list says how to start", async () => {
  const { v } = await open([]);
  assert.match(texts(v), /No projects yet/);
  const { v: v2 } = await open([proj("api", "/r/api")]);
  v2.search.set_value("zzzz");
  assert.match(texts(v2), /No project matches/);
});

test("each row has its agent's icon, a shell icon for a plain shell, and the generic icon for an unknown command", async () => {
  const { v } = await open([
    proj("a-claude", "/r/a", { startup: { agent: "claude --model opus" } }),
    proj("b-codex", "/r/b", { startup: { agent: "codex" } }),
    proj("c-shell", "/r/c"),
    proj("d-weird", "/r/d", { startup: { agent: "mytool" } }),
  ]);
  const icons = findAll(rendered(v), (e) => e.tag === "svg" || e.tag === "image").map((e) => `${e.tag}:${e.arg}`);
  assert.ok(icons.includes("image:icons/claude.svg"));
  assert.ok(icons.includes("image:icons/codex.svg"), "an agent herdr's list lacks still gets its icon");
  assert.ok(icons.includes("svg:icons/shell.svg"));
  assert.ok(icons.includes("svg:icons/agent.svg"));
});

test("typing highlights the matched letters of the name", async () => {
  const { v } = await open([proj("api-gateway", "/r/gw")]);
  v.search.set_value("apgw");
  const bold = findAll(rendered(v), (e) => e.tag === "div" && e.has("font_bold") && e.op("text_color")?.[0] === "#accent").map(textOf);
  assert.deepEqual(bold, ["ap", "g", "w"]);
  v.search.set_value("");
  assert.deepEqual(findAll(rendered(v), (e) => e.tag === "div" && e.has("font_bold") && e.op("text_color")?.[0] === "#accent"), []);
});

test("arrow keys move the highlight and wrap; Escape closes", async () => {
  const { v, cx } = await open([proj("a", "/r/a"), proj("b", "/r/b"), proj("c", "/r/c")]);
  assert.equal(v.at, 0);
  press(v, cx, "down"); press(v, cx, "down");
  assert.equal(v.at, 2);
  press(v, cx, "down");
  assert.equal(v.at, 0);
  press(v, cx, "up");
  assert.equal(v.at, 2);
  press(v, cx, "escape");
  assert.equal(state.closed, 1);
});

test("the footer lists the keys", async () => {
  const { v } = await open([proj("a", "/r/a")]);
  const t = texts(v);
  for (const s of ["Click", "Double-click / Enter", "Shift+Enter", "alt+n", "alt+e", "alt+w", "alt+d", "layout", "ctrl+alt+L"]) assert.ok(t.includes(s), s);
});

// ---------------------------------------------------------------- the layout selector

const LAYOUTS = [{ name: "coding", label: "Agent, files and a terminal", panes: [{ type: "agent" }, { name: "files", command: "yazi .", direction: "right" }] }];

test("the card shows every layout as a picture, with the project's own lit", async () => {
  const { v } = await open([proj("a", "/r/a", { startup: { layout: "coding" } })], LAYOUTS);
  const c = chips(v);
  assert.deepEqual(Object.keys(c), ["Agent only", "Agent + terminal below", "Agent + terminal right", "Agent, files and a terminal"]);
  assert.deepEqual(Object.entries(c).filter(([, e]) => lit(e)).map(([k]) => k), ["Agent, files and a terminal"]);
});

test("with no layout set, 'Agent only' is lit", async () => {
  const { v } = await open([proj("a", "/r/a")], LAYOUTS);
  assert.deepEqual(Object.entries(chips(v)).filter(([, e]) => lit(e)).map(([k]) => k), ["Agent only"]);
});

test("ctrl+alt+L steps through the layouts and wraps; a bare alt+L or ctrl+L does nothing", async () => {
  const { v, cx } = await open([proj("a", "/r/a")], LAYOUTS);
  const now = () => Object.entries(chips(v)).filter(([, e]) => lit(e)).map(([k]) => k)[0];
  press(v, cx, "l", { alt: true });
  press(v, cx, "l", { control: true });
  press(v, cx, "l", { platform: true });
  assert.equal(now(), "Agent only");
  const seen = [];
  for (let i = 0; i < 5; i++) { press(v, cx, "l", CTRL_ALT); seen.push(now()); }
  assert.deepEqual(seen, ["Agent + terminal below", "Agent + terminal right", "Agent, files and a terminal", "Agent only", "Agent + terminal below"]);
  press(v, cx, "l", { platform: true, alt: true });
  assert.equal(now(), "Agent + terminal right", "cmd+alt+L works too");
});

test("a pick counts only while it differs from the project's own layout", async () => {
  const { v, cx } = await open([proj("a", "/r/a", { startup: { layout: "coding" } })], LAYOUTS);
  press(v, cx, "l", CTRL_ALT);
  assert.equal(v.layoutPick, "", "wrapped to none: differs from coding");
  for (let i = 0; i < 3; i++) press(v, cx, "l", CTRL_ALT);
  assert.equal(v.layoutPick, null, "back at the project's own layout: not a pick");
});

test("the lit chip turns bold with an accent ring for a second after a change", async () => {
  const { v, cx } = await open([proj("a", "/r/a")], LAYOUTS);
  const litChip = () => Object.values(chips(v)).find(lit);
  const bold = () => labelOf(litChip()).has("font_bold");
  assert.ok(!bold());
  press(v, cx, "l", CTRL_ALT);
  assert.ok(bold());
  assert.equal(litChip().op("border_color")[0], "#accent");
  const first = cx.timers.at(-1);
  press(v, cx, "l", CTRL_ALT);
  first.fn(); // the first press's timer must not end the second press's highlight
  assert.ok(bold());
  cx.timers.at(-1).fn();
  assert.ok(!bold());
  assert.equal(litChip().op("border_color")[0], "#solid");
});

test("the layout key also works at the branch-name step", async () => {
  const dir = makeRepo({ name: "Ada" });
  const { v, cx } = await open([proj("a", dir, { worktree: { mode: "ask", branchTemplate: "{user}/{slug}" } })], LAYOUTS);
  enter(v);
  assert.equal(v.mode, "name");
  press(v, cx, "l", CTRL_ALT);
  assert.equal(v.layoutPick, "agent-terminal", "the first step from 'Agent only'");
  for (let i = 0; i < 3; i++) press(v, cx, "l", CTRL_ALT);
  assert.equal(v.layoutPick, null, "all the way round: back at the project's own, so not a pick");
  const t = texts(v);
  assert.ok(t.includes("Enter") && t.includes("creates") && t.includes("Esc") && t.includes("Layout"));
  press(v, cx, "escape");
  assert.equal(v.mode, "list");
});

// ---------------------------------------------------------------- opening a project

/** Opens project `p` with the key that follows its mode, then waits for the work to finish. */
async function launchFirst(projects, layouts, beforeEnter) {
  const { v, cx } = await open(projects, layouts);
  beforeEnter?.(v, cx);
  enter(v);
  await cx.settle();
  return { v, cx };
}
const spaceNew = () => state.runs.filter((r) => r.command === "space.new");

test("Enter on a 'never' project opens its checkout in a space and closes", async () => {
  const dir = makeRepo();
  await launchFirst([proj("demo", dir, { worktree: { mode: "never" } })]);
  assert.deepEqual(spaceNew().map((r) => [r.args.name, r.args.folder]), [["demo", dir]]);
  assert.equal(state.closed, 1);
  assert.deepEqual(state.splits, []);
});

test("a project's layout is built when it opens", async () => {
  const dir = makeRepo();
  await launchFirst([proj("demo", dir, { worktree: { mode: "never" }, startup: { layout: "agent-terminal" } })]);
  assert.equal(state.splits.length, 1);
  assert.equal(state.splits[0].direction, "down");
  assert.equal(state.splits[0].pane, "pane-of-sp1");
  assert.equal(state.closed, 1);
});

test("a layout picked at launch wins over the project's own, and 'Agent only' means no splits", async () => {
  const dir = makeRepo();
  await launchFirst([proj("demo", dir, { worktree: { mode: "never" }, startup: { layout: "agent-terminal" } })], LAYOUTS, (v, cx) => {
    for (let i = 0; i < 3; i++) press(v, cx, "l", CTRL_ALT); // agent-terminal → side → coding → none
    assert.equal(v.layoutPick, "");
  });
  assert.deepEqual(state.splits, []);
  reset();
  await launchFirst([proj("demo", dir, { worktree: { mode: "never" } })], LAYOUTS, (v, cx) => {
    for (let i = 0; i < 3; i++) press(v, cx, "l", CTRL_ALT); // → coding
  });
  assert.equal(state.splits.length, 1);
  assert.equal(state.splits[0].direction, "right");
  assert.deepEqual(state.splits[0].argv.slice(5), ["sh", "-c", "yazi ."]);
});

test("an unknown layout name stops before anything is created and says which layouts exist", async () => {
  const dir = makeRepo();
  const { v } = await launchFirst([proj("demo", dir, { worktree: { mode: "never" }, startup: { layout: "nope" } })], LAYOUTS);
  assert.match(v.error, /No layout called "nope".*agent-terminal.*coding/);
  assert.equal(v.mode, "busy");
  assert.deepEqual(spaceNew(), []);
  assert.equal(state.closed, 0);
});

test("a malformed layout is reported before anything is created", async () => {
  const dir = makeRepo();
  const bad = [{ name: "bad", panes: [{ type: "agent" }, { type: "shell" }] }];
  const { v } = await launchFirst([proj("demo", dir, { worktree: { mode: "never" }, startup: { layout: "bad" } })], bad);
  assert.match(v.error, /needs direction/);
  assert.deepEqual(spaceNew(), []);
});

test("an 'always' project makes a worktree and opens a space named for it", async () => {
  const dir = makeRepo({ name: "Ada" });
  const root = scratch("pp-ui-wt");
  await launchFirst([proj("demo", dir, { worktree: { mode: "always", branchTemplate: "{user}/{slug}", root: `${root}/{branch}` } })]);
  assert.equal(spaceNew().length, 1);
  assert.match(spaceNew()[0].args.name, /^demo · ada\//);
  assert.ok(spaceNew()[0].args.folder.startsWith(root));
  assert.ok(existsSync(spaceNew()[0].args.folder));
});

test("an 'ask' project asks for a name, previews the branch, and creates it on Enter", async () => {
  const dir = makeRepo({ name: "Ada" });
  const root = scratch("pp-ui-wt");
  const { v, cx } = await open([proj("demo", dir, { worktree: { mode: "ask", branchTemplate: "{user}/{slug}", root: `${root}/{branch}` } })]);
  enter(v);
  assert.equal(v.mode, "name");
  v.nameInput.set_value("fix login");
  v.refreshPreview(cx);
  await cx.settle();
  assert.match(texts(v), /branch: ada\/fix-login/);
  v.nameInput.emit("submit");
  await cx.settle();
  assert.equal(spaceNew().length, 1);
  assert.ok(existsSync(join(root, "ada/fix-login")));
});

test("Shift+Enter opens the checkout whatever the mode", async () => {
  const dir = makeRepo();
  const { v, cx } = await open([proj("demo", dir, { worktree: { mode: "always" } })]);
  press(v, cx, "enter", { shift: true });
  await cx.settle();
  assert.equal(spaceNew()[0].args.folder, dir);
});

test("an already-open space is focused instead of opening another", async () => {
  const dir = makeRepo();
  const { v, cx } = await open([proj("demo", dir, { worktree: { mode: "never" } })]);
  state.spaces = [{ id: "sp-open", folder: dir, machine: null }];
  enter(v);
  await cx.settle();
  assert.deepEqual(state.runs.map((r) => r.command), ["space.select"]);
  assert.equal(state.closed, 1);
});

test("a folder that is not a git checkout shows the error and Escape returns", async () => {
  const { v, cx } = await launchFirst([proj("demo", scratch(), { worktree: { mode: "never" } })]);
  assert.match(v.error, /not a git checkout/);
  assert.match(texts(v), /not a git checkout/);
  press(v, cx, "escape");
  assert.equal(v.mode, "list");
  assert.equal(v.error, null);
});

// ---------------------------------------------------------------- the working screen

test("the working screen shows done steps, a spinner on the current one, and a cross on failure", async () => {
  const { v } = await open([proj("demo", "/r/demo")]);
  v.target = v.projects[0];
  v.mode = "busy";
  v.notes = [];
  assert.match(texts(v), /Starting…/);
  v.notes = ["git fetch origin…", "git worktree add x…", "$ npm ci"];
  let marks = findAll(rendered(v), (e) => e.tag === "div" && e.has("frames"));
  assert.equal(marks.length, 1, "one spinner");
  assert.equal(marks[0].op("frames")[0].length, 10);
  const t = texts(v);
  assert.equal((t.match(/✓/g) ?? []).length, 2);
  assert.ok(t.includes("working…"));
  v.error = "setup failed";
  marks = findAll(rendered(v), (e) => e.tag === "div" && e.has("frames"));
  assert.equal(marks.length, 0, "no spinner after a failure");
  assert.ok(texts(v).includes("✗") && texts(v).includes("setup failed") && texts(v).includes("Esc back"));
});

// ---------------------------------------------------------------- the editor

test("the editor renders all four sections", async () => {
  const { v, cx } = await open([proj("demo", "/r/demo")], LAYOUTS);
  v.editSelected();
  for (const id of ["project", "worktree", "git", "startup"]) {
    v.showSection(id);
    assert.ok(texts(v).length > 0, id);
  }
  v.showSection("startup");
  assert.match(texts(v), /Pane layout/);
  assert.match(texts(v), /Setup commands/);
  cx.fire(80);
});

test("the startup section offers every agent, with icons, dimmed when not installed, and Shell first", async () => {
  const { v } = await open([proj("demo", "/r/demo")]);
  v.editSelected();
  v.showSection("startup");
  const tree = rendered(v);
  const chipEls = findAll(tree, (e) => e.tag === "h_flex" && /^pp-agent-/.test(e.op("id")?.[0] ?? ""));
  const names = chipEls.map(textOf);
  assert.deepEqual(names, ["Shell", "Claude Code", "Codex", "opencode", "Hermes", "pi"]);
  const byName = Object.fromEntries(chipEls.map((e) => [textOf(e), e]));
  assert.ok(!byName["Claude Code"].has("opacity"), "installed: full strength");
  assert.ok(byName["Codex"].has("opacity") && byName["opencode"].has("opacity"), "not installed: dimmed");
  const iconOf = (e) => findAll(e, (x) => x.tag === "svg" || x.tag === "image").map((x) => x.arg)[0];
  assert.equal(iconOf(byName["Shell"]), "icons/shell.svg");
  assert.equal(iconOf(byName["Codex"]), "icons/codex.svg");
  assert.equal(iconOf(byName["opencode"]), "icons/opencode.svg");
  assert.equal(iconOf(byName["Claude Code"]), "icons/claude.svg");
});

test("clicking an agent chip fills the agent field; Hermes switches the prompt to typed-after-start", async () => {
  const { v } = await open([proj("demo", "/r/demo")]);
  v.editSelected();
  v.showSection("startup");
  const click = (name) => {
    const el = findAll(rendered(v), (e) => e.tag === "h_flex" && textOf(e) === name && /^pp-agent-/.test(e.op("id")?.[0] ?? ""))[0];
    el.op("on_click")[0]();
  };
  const agent = () => v.fields.find(([k]) => k === "agent")[1].value();
  click("Codex");
  assert.equal(agent(), "codex");
  assert.equal(v.draft.startup.promptMode, "arg");
  click("Hermes");
  assert.equal(agent(), "hermes");
  assert.equal(v.draft.startup.promptMode, "send");
  click("Shell");
  assert.equal(agent(), "");
});

test("saving keeps a folder's trailing space, the layouts and other keys", async () => {
  const dir = join(scratch("pp-sp"), "Repo ");
  mkdirSync(dir);
  makeRepo({ dir });
  assert.ok(dir.endsWith("Repo "));
  const { v, cx } = await open([], LAYOUTS);
  writeFileSync(dataFile(), JSON.stringify({ note: "keep", layouts: LAYOUTS, projects: [] }));
  await v.reload(cx);
  await cx.settle();
  v.edit(normalize({ name: "Spacey", path: dir }), null);
  v.fields.find(([k]) => k === "layout")[1].set_value("coding");
  await v.save(cx);
  assert.equal(v.error, null);
  const saved = JSON.parse(readFileSync(dataFile(), "utf8"));
  assert.equal(saved.projects[0].path, dir);
  assert.equal(saved.projects[0].startup.layout, "coding");
  assert.deepEqual(saved.layouts, LAYOUTS);
  assert.equal(saved.note, "keep");
  assert.equal(v.mode, "list");
  assert.ok(sh(dir, "rev-parse", "--is-inside-work-tree") === "true");
});

test("saving refuses a nameless project and a folder that is not a checkout", async () => {
  const { v, cx } = await open([]);
  v.edit(normalize({ name: "", path: "/r/x" }), null);
  await v.save(cx);
  assert.match(v.error, /Give the project a name/);
  v.edit(normalize({ name: "x", path: scratch() }), null);
  await v.save(cx);
  assert.match(v.error, /not a git checkout/);
  assert.equal(v.mode, "edit");
});

test("deleting asks twice; the folder is untouched", async () => {
  const dir = makeRepo();
  const { v, cx } = await open([proj("demo", dir)]);
  press(v, cx, "d", { alt: true });
  assert.ok(v.pendingDelete);
  assert.match(texts(v), /Remove "demo" from the list/);
  press(v, cx, "d", { alt: true });
  await cx.settle();
  assert.deepEqual(JSON.parse(readFileSync(dataFile(), "utf8")).projects, []);
  assert.ok(existsSync(dir));
});

test("any other key cancels a pending delete", async () => {
  const { v, cx } = await open([proj("demo", "/r/demo")]);
  press(v, cx, "d", { alt: true });
  press(v, cx, "down");
  assert.equal(v.pendingDelete, null);
});

// ---------------------------------------------------------------- worktree cleanup

test("the worktree screen lists worktrees with badges and removes ticked ones", async () => {
  const dir = makeRepo({ name: "Ada" });
  const root = scratch("pp-ui-wt");
  sh(dir, "worktree", "add", "-q", "-b", "ada/merged", join(root, "merged"));
  sh(dir, "worktree", "add", "-q", "-b", "ada/dirty", join(root, "dirty"));
  writeFileSync(join(root, "dirty", "a.txt"), "changed\n");
  const { v, cx } = await open([proj("demo", dir)]);
  press(v, cx, "w", { alt: true });
  await cx.settle();
  assert.equal(v.mode, "worktrees");
  const t = texts(v);
  for (const s of ["ada/merged", "ada/dirty", "merged", "uncommitted"]) assert.ok(t.includes(s), s);
  press(v, cx, "m", { alt: true }); // tick merged
  assert.equal(v.wtSel.size, 1);
  press(v, cx, "r", { alt: true }); // ask
  assert.equal(v.wtConfirm, true);
  press(v, cx, "r", { alt: true }); // remove
  await cx.settle();
  assert.ok(!existsSync(join(root, "merged")));
  assert.ok(existsSync(join(root, "dirty")));
  assert.ok(!texts(v).includes("ada/merged"));
});

test("Escape steps back one screen at a time and then closes", async () => {
  const { v, cx } = await open([proj("demo", "/r/demo")]);
  press(v, cx, "e", { alt: true });
  assert.equal(v.mode, "edit");
  press(v, cx, "escape");
  assert.equal(v.mode, "list");
  assert.equal(state.closed, 0);
  press(v, cx, "escape");
  assert.equal(state.closed, 1);
});

test("a handler that throws is shown in the popup instead of vanishing", async () => {
  const { v } = await open([proj("demo", "/r/demo")]);
  v.guard("boom", () => { throw new Error("kaput"); })();
  assert.match(v.error, /boom: kaput/);
  assert.match(texts(v), /boom: kaput/);
});

test("projects are ordered: open spaces, pinned, recent, then by name", async () => {
  const { v } = await open([proj("zeta", "/r/z"), proj("alpha", "/r/a"), proj("pinned", "/r/p", { pinned: true }), proj("open", "/r/o")]);
  state.spaces = [{ id: "s", folder: "/r/o", machine: null }];
  assert.deepEqual(v.rows().map((r) => r.p.name), ["open", "pinned", "alpha", "zeta"]);
});

test("on macOS the hints use ⌘ and the layout key is ⌘⌥L", async () => {
  const { v } = await open([proj("a", "/r/a")]);
  state.platform = "macos";
  const t = texts(v);
  for (const s of ["⌘N", "⌘E", "⌘W", "⌘D", "⌘⌥L"]) assert.ok(t.includes(s), s);
  assert.ok(!t.includes("alt+n") && !t.includes("ctrl+alt+L"));
});

test("Browse… fills the folder and, when empty, the name", async () => {
  const dir = makeRepo();
  const { v, cx } = await open([]);
  v.edit(normalize({ name: "", path: "" }), null);
  state.picked = null;
  await v.browse(cx);
  assert.equal(v.fields.find(([k]) => k === "path")[1].value(), "");
  state.picked = dir;
  await v.browse(cx);
  assert.equal(v.fields.find(([k]) => k === "path")[1].value(), dir);
  assert.equal(v.fields.find(([k]) => k === "name")[1].value(), dir.split("/").pop());
});

test("a layout typed in the editor is saved with the project and used on the next open", async () => {
  const dir = makeRepo();
  const { v, cx } = await open([proj("demo", dir, { worktree: { mode: "never" } })]);
  v.editSelected();
  v.fields.find(([k]) => k === "layout")[1].set_value("agent-side-terminal");
  await v.save(cx);
  assert.equal(JSON.parse(readFileSync(dataFile(), "utf8")).projects[0].startup.layout, "agent-side-terminal");
  enter(v);
  await cx.settle();
  assert.equal(state.splits.length, 1);
  assert.equal(state.splits[0].direction, "right");
});

// ---------------------------------------------------------------- sections, git chips and the detail card

test("the list has Open now / Pinned / Everything else headers, and none while searching", async () => {
  const { v } = await open([proj("zeta", "/r/z"), proj("alpha", "/r/a"), proj("pinned", "/r/p", { pinned: true }), proj("open", "/r/o")]);
  state.spaces = [{ id: "s", folder: "/r/o", machine: null, status: "idle" }];
  const t = texts(v);
  for (const h of ["OPEN NOW", "PINNED", "EVERYTHING ELSE"]) assert.ok(t.includes(h), h);
  assert.ok(t.indexOf("OPEN NOW") < t.indexOf("PINNED") && t.indexOf("PINNED") < t.indexOf("EVERYTHING ELSE"));
  v.search.set_value("a");
  assert.ok(!texts(v).includes("OPEN NOW"));
});

test("section headers are shorter than rows, and arrow keys skip them", async () => {
  const { v, cx } = await open([proj("alpha", "/r/a"), proj("pinned", "/r/p", { pinned: true })]);
  const list = findAll(rendered(v), (e) => e.tag === "virtual_list")[0];
  assert.ok(list, "the projects list");
  assert.equal(list.arg, "pp-projects");
  assert.deepEqual(list.sizes, [30, 48, 30, 48], "header, row, header, row");
  press(v, cx, "down");
  assert.equal(v.at, 1);
  press(v, cx, "down");
  assert.equal(v.at, 0);
});

test("rows show the branch, changed files and worktree count once the git details load", async () => {
  const dir = makeRepo({ name: "Ada" });
  writeFileSync(join(dir, "a.txt"), "changed\n");
  sh(dir, "worktree", "add", "-q", "-b", "side", join(scratch("pp-ui-wt"), "side"));
  const { v, cx } = await open([proj("demo", dir)]);
  assert.ok(!texts(v).includes("1 changed"), "nothing yet while loading");
  await v.loadInfo(cx);
  const t = texts(v);
  assert.ok(t.includes("main") && t.includes("1 changed") && t.includes("1 wt"));
});

test("a clean project with no worktrees shows only its branch; an unreadable folder shows no chips", async () => {
  const { v, cx } = await open([proj("clean", makeRepo()), proj("gone", "/no/such/dir")]);
  await v.loadInfo(cx);
  const rowsText = findAll(rendered(v), (e) => /^pp-\d+$/.test(e.op?.("id")?.[0] ?? "")).map(textOf);
  const clean = rowsText.find((x) => x.includes("clean"));
  assert.ok(clean.includes("main") && !clean.includes("changed") && !clean.includes("wt"));
  const gone = rowsText.find((x) => x.includes("gone"));
  assert.ok(!gone.includes("main"));
});

test("a working agent's stripe pulses and an open space gets a status stripe", async () => {
  const { v } = await open([proj("busy", "/r/b"), proj("idle", "/r/i"), proj("closed", "/r/c")]);
  state.spaces = [{ id: "1", folder: "/r/b", machine: null, status: "working" }, { id: "2", folder: "/r/i", machine: null, status: "idle" }];
  const rows = findAll(rendered(v), (e) => /^pp-\d+$/.test(e.op?.("id")?.[0] ?? ""));
  const byName = (n) => rows.find((r) => textOf(r).includes(n));
  const pulses = (r) => findAll(r, (e) => e.has("loop")).length;
  const stripes = (r) => findAll(r, (e) => e.has("absolute") && e.op("w")?.[0] === 3).length;
  assert.equal(pulses(byName("busy")), 1);
  assert.equal(pulses(byName("idle")), 0);
  assert.equal(stripes(byName("busy")), 1);
  assert.equal(stripes(byName("idle")), 1);
  assert.equal(stripes(byName("closed")), 0);
});

test("the search box shows how many projects match", async () => {
  const { v } = await open([proj("alpha", "/r/a"), proj("beta", "/r/b"), proj("gamma", "/r/g")]);
  assert.ok(texts(v).includes("3 of 3"));
  v.search.set_value("alp");
  assert.ok(texts(v).includes("1 of 3"));
});

test("the detail card describes the highlighted project", async () => {
  const dir = makeRepo({ name: "Ada" });
  writeFileSync(join(dir, "a.txt"), "x\n");
  const { v, cx } = await open([proj("demo", dir, { group: "platform", pinned: true, startup: { agent: "claude" }, worktree: { mode: "always" } })]);
  state.spaces = [{ id: "s", folder: dir, machine: null, status: "working" }];
  await v.loadInfo(cx);
  const t = texts(v);
  for (const s of ["demo", "agent working", "pinned", "Agent", "Claude Code", "Group", "platform", "Branch", "main", "Changes", "1 file modified", "Worktrees", "Last opened", "never",
    "Enter creates a new worktree and opens the agent alone.", "Create worktree", "Checkout", "LAYOUT"]) assert.ok(t.includes(s), s);
});

test("the card follows the highlight and says what each mode does", async () => {
  const { v, cx } = await open([proj("a", "/r/a", { worktree: { mode: "never" } }), proj("b", "/r/b", { worktree: { mode: "ask" }, startup: { layout: "agent-terminal" } })]);
  assert.match(texts(v), /Enter opens the checkout and opens the agent alone\./);
  press(v, cx, "down");
  assert.match(texts(v), /Enter asks for a branch name and opens agent \+ terminal below\./);
  assert.ok(texts(v).includes("Open…"));
});

test("Last opened shows when the project was last used", async () => {
  const { v } = await open([proj("demo", "/r/demo")]);
  state.platform = "linux";
  const { setShared } = await import("./helpers/herdr-stub.mjs");
  setShared("project-presets.recent", { "/r/demo": Date.now() - 12 * 60_000 });
  assert.ok(texts(v).includes("12 min ago"));
});

test("clicking a layout picture picks it for this launch; clicking the project's own clears the pick", async () => {
  const { v, cx } = await open([proj("a", "/r/a", { startup: { layout: "agent-terminal" } })]);
  const click = (label) => chips(v)[label].op("on_click")[0]();
  click("Agent only");
  assert.equal(v.layoutPick, "");
  assert.ok(texts(v).includes("LAYOUT · PICKED"));
  click("Agent + terminal below");
  assert.equal(v.layoutPick, null);
  assert.ok(!texts(v).includes("PICKED"));
  assert.ok(chips(v)["Agent + terminal below"] && texts(v).includes("project default"));
});

test("the card's layout pictures draw each layout's panes", async () => {
  const { v } = await open([proj("a", "/r/a")], LAYOUTS);
  const thumb = (label) => findAll(chips(v)[label], (e) => e.tag === "div" && e.has("absolute"));
  assert.equal(thumb("Agent only").length, 1);
  assert.equal(thumb("Agent + terminal below").length, 2);
  assert.equal(thumb("Agent, files and a terminal").length, 2);
});

test("the Open and Checkout buttons in the card start the project", async () => {
  const dir = makeRepo();
  const { v, cx } = await open([proj("demo", dir, { worktree: { mode: "always" } })]);
  const button = (id) => findAll(rendered(v), (e) => e.op?.("id")?.[0] === id)[0];
  button("pp-checkout").op("on_click")[0]();
  await cx.settle();
  assert.equal(spaceNew()[0].args.folder, dir);
  assert.equal(state.closed, 1);
});

test("with no projects the card says nothing is selected", async () => {
  const { v } = await open([]);
  assert.ok(texts(v).includes("Nothing selected."));
});

test("the popup is wide enough for the list and the card", () => {
  const mod = JSON.parse(readFileSync(new URL("../mods/project-presets/mod.json", import.meta.url), "utf8"));
  assert.ok(mod.overlay.width >= 1000);
});

// ---------------------------------------------------------------- turning the detail card off

const hasId = (v, id) => findAll(rendered(v), (e) => e.op?.("id")?.[0] === id).length > 0;

test("ctrl+alt+I hides the detail card, and the buttons and layout choice move under the list", async () => {
  const { v, cx } = await open([proj("demo", "/r/demo", { worktree: { mode: "always" } })], LAYOUTS);
  assert.ok(texts(v).includes("Last opened"));
  press(v, cx, "i", CTRL_ALT);
  const t = texts(v);
  assert.ok(!t.includes("Last opened") && !t.includes("Enter creates a new worktree"), "no card");
  assert.ok(hasId(v, "pp-wt") && hasId(v, "pp-edit") && hasId(v, "pp-delete") && hasId(v, "pp-add"), "the action buttons are under the list");
  for (const s of ["Layout", "Agent only", "Agent + terminal below", "Agent, files and a terminal", "show details"]) assert.ok(t.includes(s), s);
  assert.deepEqual(findAll(rendered(v), (e) => /^pp-lay-/.test(e.op?.("id")?.[0] ?? "")), [], "no layout pictures");
});

test("with the card on, the buttons are in the card only once and the layout choice is the pictures", async () => {
  const { v } = await open([proj("demo", "/r/demo")]);
  for (const id of ["pp-wt", "pp-edit", "pp-delete", "pp-open", "pp-checkout", "pp-add", "pp-details"]) {
    assert.equal(findAll(rendered(v), (e) => e.op?.("id")?.[0] === id).length, 1, id);
  }
  assert.ok(texts(v).includes("hide details"));
});

test("a bare alt+I or ctrl+I does nothing", async () => {
  const { v, cx } = await open([proj("demo", "/r/demo")]);
  press(v, cx, "i", { alt: true });
  press(v, cx, "i", { control: true });
  assert.equal(v.detail, true);
});

test("the choice is remembered: a picker opened later starts the same way", async () => {
  const { v, cx } = await open([proj("demo", "/r/demo")]);
  press(v, cx, "i", CTRL_ALT);
  assert.equal(v.detail, false);
  const { shared } = await import("./helpers/herdr-stub.mjs");
  assert.equal(shared("project-presets.detail"), false);
  const pending = [];
  const cx2 = { timer: { after() {} }, spawn: (fn) => { const p = fn(cx2); pending.push(p); return p; }, focus_handle: () => ({}), notify() {}, stop_propagation() {} };
  const again = new Picker();
  again.init({}, cx2);
  await Promise.all(pending);
  assert.equal(again.detail, false);
  assert.ok(!texts(again).includes("Last opened"));
  press(again, cx2, "i", CTRL_ALT);
  assert.equal(again.detail, true);
  assert.ok(texts(again).includes("Last opened"));
});

test("the Hide details button toggles it both ways", async () => {
  const { v } = await open([proj("demo", "/r/demo")]);
  const click = () => findAll(rendered(v), (e) => e.op?.("id")?.[0] === "pp-details")[0].op("on_click")[0]();
  click();
  assert.equal(v.detail, false);
  assert.ok(texts(v).includes("Show details"));
  click();
  assert.equal(v.detail, true);
  assert.ok(texts(v).includes("Hide details"));
});

test("the layout key and Enter still work with the card hidden", async () => {
  const dir = makeRepo();
  const { v, cx } = await open([proj("demo", dir, { worktree: { mode: "never" } })], LAYOUTS);
  press(v, cx, "i", CTRL_ALT);
  for (let i = 0; i < 3; i++) press(v, cx, "l", CTRL_ALT); // agent-terminal, side, coding
  assert.equal(v.layoutPick, "coding");
  enter(v);
  await cx.settle();
  assert.equal(state.splits.length, 1);
  assert.equal(state.splits[0].direction, "right");
});

test("hiding the card keeps the buttons working: Edit opens the editor", async () => {
  const { v, cx } = await open([proj("demo", "/r/demo")]);
  press(v, cx, "i", CTRL_ALT);
  findAll(rendered(v), (e) => e.op?.("id")?.[0] === "pp-edit")[0].op("on_click")[0]();
  assert.equal(v.mode, "edit");
});

test("with no projects and the card hidden there are no action buttons to press", async () => {
  const { v, cx } = await open([]);
  press(v, cx, "i", CTRL_ALT);
  assert.ok(!hasId(v, "pp-wt") && !hasId(v, "pp-edit") && hasId(v, "pp-add"));
});

// ---------------------------------------------------------------- space colors

const avatarOf = (el) => findAll(el, (e) => e.tag === "h_flex" && e.has("font_bold") && e.has("rounded"))[0];
const rowOf = (v, name) => findAll(rendered(v), (e) => /^pp-\d+$/.test(e.op?.("id")?.[0] ?? "")).find((r) => textOf(r).includes(name));

test("an open project's avatar has its space's color and its initial, like the sidebar's", async () => {
  const { v } = await open([proj("alpha", "/r/a"), proj("beta", "/r/b"), proj("gamma", "/r/g"), proj("delta", "/r/d")]);
  state.spaces = [
    { id: "s1", folder: "/r/a", machine: null, status: "idle" },
    { id: "s2", folder: "/r/b", machine: null, status: "idle" },
    { id: "s3", folder: "/r/g", machine: null, status: "idle" },
  ];
  const { setShared } = await import("./helpers/herdr-stub.mjs");
  setShared("space.colors", { s1: "ansi4", s2: "#123456" });
  const a = avatarOf(rowOf(v, "alpha"));
  assert.equal(a.op("bg")[0], "#5b8def");
  assert.equal(textOf(a), "A");
  assert.equal(avatarOf(rowOf(v, "beta")).op("bg")[0], "#123456", "a stored hex color is used as is");
  assert.equal(avatarOf(rowOf(v, "gamma")).op("bg")[0], "#22a99a", "teal until herdr gives the space a color");
});

test("a project with no open space gets an outlined avatar without a color", async () => {
  const { v } = await open([proj("delta", "/r/d")]);
  const a = avatarOf(rowOf(v, "delta"));
  assert.ok(!a.has("bg"));
  assert.equal(a.op("border_color")[0], "#input");
  assert.equal(textOf(a), "D");
});

test("the card's header repeats the avatar in the same color", async () => {
  const { v } = await open([proj("alpha", "/r/a")]);
  state.spaces = [{ id: "s1", folder: "/r/a", machine: null, status: "idle" }];
  const { setShared } = await import("./helpers/herdr-stub.mjs");
  setShared("space.colors", { s1: "ansi5" });
  const card = findAll(rendered(v), (e) => e.tag === "v_flex" && e.has("border_1") && textOf(e).includes("LAYOUT"))[0];
  assert.equal(avatarOf(card).op("bg")[0], "#8b7cf6");
});

test("a color name the sidebar palette lacks falls back to the theme, then to teal", async () => {
  const { v } = await open([proj("alpha", "/r/a")]);
  state.spaces = [{ id: "s1", folder: "/r/a", machine: null, status: "idle" }];
  const { setShared } = await import("./helpers/herdr-stub.mjs");
  setShared("space.colors", { s1: "ansi7" });
  assert.equal(avatarOf(rowOf(v, "alpha")).op("bg")[0], "#ansi7", "the theme's own color");
});
