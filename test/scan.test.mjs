// Folder scanning and repo preset files (.herdr/project-presets.json): the pure helpers, then the picker driven as in ui.test.mjs.
import "./helpers/setup.mjs";
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { makeRepo, scratch, sh } from "./helpers/repo.mjs";

const { state, reset } = await import("./helpers/herdr-stub.mjs");
const { textOf, findAll } = await import("./helpers/gpui-stub.mjs");
const { default: Picker } = await import("../mods/project-presets/main.js");
const lib = await import("../mods/project-presets/lib.js");
const { scanFolder, detectBase } = await import("../mods/project-presets/git.js");
const { normalize, parseRepoPreset, applyRepoPreset, presetSummary, repoPresetOf, normalizeScan, parseScan, dropNested, discoveredProject, savedProject, listItems, PRESET_FILE } = lib;

const dataFile = () => `${state.appHome}/data/project-presets.json`;
const trustFile = () => `${state.appHome}/data/project-presets.trust.json`;
beforeEach(reset);

/** A picker whose data file holds `data` (projects, scan…), loaded, scanned and rendered once. */
async function open(data = {}) {
  reset();
  Picker.scanCache.key = "";
  mkdirSync(`${state.appHome}/data`, { recursive: true });
  for (const f of [trustFile()]) if (existsSync(f) && !data.keepTrust) writeFileSync(f, "{}\n");
  const { keepTrust, ...rest } = data;
  writeFileSync(dataFile(), JSON.stringify({ hideTemplate: true, projects: [], ...rest }, null, 2));
  const pending = [];
  const cx = {
    timers: [],
    timer: { after: (ms, fn) => cx.timers.push({ ms, fn }), every: () => {} },
    spawn: (fn) => { const p = fn(cx); pending.push(p); return p; },
    focus_handle: () => ({}),
    notify() {},
    stop_propagation() {},
    settle: async () => { for (let i = 0; i < 12; i++) { await Promise.all(pending.splice(0)); await new Promise((r) => setTimeout(r, 15)); } },
  };
  const v = new Picker();
  v.init({}, cx);
  await cx.settle();
  return { v, cx };
}
const rendered = (v) => { v.refreshSnap(); return v.render(); };
const texts = (v) => textOf(rendered(v));
const click = async (v, cx, id) => {
  const el = findAll(rendered(v), (e) => e.op?.("id")?.[0] === id)[0];
  assert.ok(el, `no button ${id}`);
  await el.op("on_click")[0]({}, cx);
  await cx.settle();
};
const enter = (v) => v.search.emit("submit");
const press = (v, cx, key, m = {}) => v.keys({ key, modifiers: { control: false, alt: false, platform: false, shift: false, ...m } }, cx);
const names = (v) => v.rows().map((r) => r.p.name);

/** A folder holding checkouts `names` (each a real repo), as a scan folder. */
function codeFolder(...repos) {
  const root = scratch("pp-code");
  for (const name of repos) { mkdirSync(join(root, name), { recursive: true }); makeRepo({ dir: join(root, name) }); }
  return root;
}
const writePreset = (repo, preset) => { mkdirSync(join(repo, ".herdr"), { recursive: true }); writeFileSync(join(repo, PRESET_FILE), typeof preset === "string" ? preset : JSON.stringify(preset)); };

// ---------------------------------------------------------------- pure helpers

test("parseRepoPreset keeps only what the file sets and refuses wrong kinds of values", () => {
  const p = parseRepoPreset(JSON.stringify({ name: " Docs ", path: "/evil", pinned: true, worktree: { mode: "always" }, startup: { agent: "claude", setup: [" npm ci ", ""], nope: 1 } }));
  assert.deepEqual(p, { name: "Docs", worktree: { mode: "always" }, git: {}, startup: { agent: "claude", setup: ["npm ci"] }, layouts: [] });
  assert.throws(() => parseRepoPreset("{ nope"), /not valid JSON/);
  assert.throws(() => parseRepoPreset("[]"), /JSON object/);
  assert.throws(() => parseRepoPreset(JSON.stringify({ startup: { setup: "npm ci" } })), /"startup.setup" must be a list/);
  assert.throws(() => parseRepoPreset(JSON.stringify({ worktree: { mode: "sometimes" } })), /one of ask, always, never/);
  assert.throws(() => parseRepoPreset(JSON.stringify({ git: { fetch: "yes" } })), /true or false/);
  assert.throws(() => parseRepoPreset(JSON.stringify({ layouts: [{ name: "x", panes: [{ type: "agent" }, { type: "shell" }] }] })), /direction/);
});

test("applyRepoPreset changes only what the preset sets", () => {
  const mine = normalize({ name: "docs", path: "/r/docs", pinned: true, git: { base: "trunk" }, startup: { agent: "codex", args: "-x" } });
  const out = applyRepoPreset(mine, parseRepoPreset(JSON.stringify({ name: "Docs Site", startup: { agent: "claude", setup: ["make"] } })));
  assert.equal(out.name, "Docs Site");
  assert.equal(out.path, "/r/docs");
  assert.equal(out.pinned, true);
  assert.equal(out.git.base, "trunk");
  assert.deepEqual([out.startup.agent, out.startup.args, out.startup.setup], ["claude", "-x", ["make"]]);
  assert.equal(mine.startup.agent, "codex", "the input is not changed");
});

test("presetSummary lists every setting and marks the lines that run commands", () => {
  const lines = presetSummary(parseRepoPreset(JSON.stringify({
    name: "Docs", git: { base: "develop", fetch: false }, startup: { agent: "claude", setup: ["npm ci", "make"], tabs: [] },
    layouts: [{ name: "dev", panes: [{ type: "agent" }, { type: "command", command: "yazi .", direction: "right" }] }],
  })));
  const find = (label) => lines.filter((l) => l.label === label);
  assert.deepEqual(find("Setup commands").map((l) => [l.value, l.runs]), [["npm ci", true], ["make", true]]);
  assert.deepEqual(find("Agent").map((l) => [l.value, l.runs]), [["claude", true]]);
  assert.deepEqual(find("Base branch").map((l) => [l.value, l.runs]), [["develop", false]]);
  assert.deepEqual(find("Fetch first").map((l) => l.value), ["no"]);
  assert.deepEqual(find('Layout "dev"').map((l) => [l.value, l.runs]), [["agent · runs yazi .", true]]);
  assert.deepEqual(find("Extra tabs").map((l) => l.value), ["(none)"]);
});

test("repoPresetOf writes the shared settings and the layout the project names, not the personal ones; it reads back the same", () => {
  const layouts = [{ name: "dev", panes: [{ type: "agent" }, { type: "shell", direction: "down" }] }];
  const p = normalize({ name: "api", path: "/home/me/code/api", pinned: true, group: "platform", worktree: { root: "/home/me/wt/{branch}", spaceName: "{slug}", repoSpace: true, mode: "always" }, startup: { agent: "claude", layout: "dev", setup: ["make"] } });
  const file = repoPresetOf(p, layouts);
  const text = JSON.stringify(file);
  for (const personal of ["/home/me", "pinned", "spaceName", "repoSpace", "root"]) assert.ok(!text.includes(personal), personal);
  assert.deepEqual(file.layouts, layouts);
  assert.equal(repoPresetOf({ ...p, startup: { ...p.startup, layout: "agent-terminal" } }, layouts).layouts, undefined, "a built-in layout needs no definition");
  const back = applyRepoPreset(normalize({ path: "/elsewhere/api" }), parseRepoPreset(text));
  assert.deepEqual([back.name, back.group, back.worktree.mode, back.startup.agent, back.startup.layout, back.startup.setup], ["api", "platform", "always", "claude", "dev", ["make"]]);
});

test("normalizeScan tidies the scan settings", () => {
  assert.deepEqual(normalizeScan(), { folders: [], depth: 3, hidden: [] });
  assert.deepEqual(normalizeScan({ folders: ["~/code/", " ~/work ", "~/code", 3, ""], depth: 99, hidden: "x" }), { folders: ["~/code", "~/work"], depth: 6, hidden: [] });
  assert.equal(normalizeScan({ depth: 0 }).depth, 1);
  assert.equal(normalizeScan({ depth: "2" }).depth, 3);
});

test("parseScan and dropNested turn find's output into checkout folders", () => {
  assert.deepEqual(parseScan("./.git\0./a/.git\0./b/c d/.git\0", "/r/"), ["/r", "/r/a", "/r/b/c d"]);
  assert.deepEqual(parseScan("", "/r"), []);
  assert.deepEqual(dropNested(["/r/b", "/r/a/vendor/x", "/r/a", "/r/ab", "/r/a"]), ["/r/a", "/r/ab", "/r/b"]);
});

test("a found project takes the template's settings but its own name and folder, and saving strips the marks", () => {
  const template = normalize({ name: "Template", template: true, pinned: true, startup: { agent: "codex" }, worktree: { mode: "always" } });
  const p = discoveredProject("/code/api", template);
  assert.deepEqual([p.name, p.path, p.pinned, p.discovered, p.template, p.startup.agent, p.worktree.mode], ["api", "/code/api", false, true, undefined, "codex", "always"]);
  assert.equal(discoveredProject("/code/api").startup.agent, "", "no template: the blank settings");
  const saved = savedProject({ ...p, preset: "used", presetError: "x" });
  assert.ok(!("discovered" in saved) && !("preset" in saved) && !("presetError" in saved));
  assert.equal(p.discovered, true, "the input is not changed");
});

test("listItems gives found projects their own section before the template", () => {
  const row = (name, over = {}) => ({ p: { name, pinned: false, ...over } });
  const rows = [row("saved"), row("found", { discovered: true }), row("Template", { template: true })];
  assert.deepEqual(listItems(rows, false).map((i) => i.header ?? i.row.p.name), ["Everything else", "saved", "Found in your folders", "found", "Template", "Template"]);
  assert.deepEqual(listItems([{ p: { name: "open", discovered: true }, space: { id: "s" } }, row("f", { discovered: true })], false).map((i) => i.header ?? i.row.p.name), ["Open now", "open", "Found in your folders", "f"]);
});

// ---------------------------------------------------------------- git

test("scanFolder finds checkouts, skipping hidden folders, node_modules, linked worktrees and folders too deep", async () => {
  const root = codeFolder("api", "group/web", "a/b/c/deep", ".hidden/x", "node_modules/y");
  sh(join(root, "api"), "worktree", "add", "-q", "-b", "wt", join(root, "api-wt"));
  assert.deepEqual((await scanFolder(root, 3)).sort(), [join(root, "api"), join(root, "group/web")]);
  assert.deepEqual((await scanFolder(root, 4)).sort(), [join(root, "a/b/c/deep"), join(root, "api"), join(root, "group/web")]);
  assert.deepEqual(await scanFolder(join(root, "api"), 1), [join(root, "api")], "a scan folder that is itself a checkout");
  await assert.rejects(scanFolder(join(root, "nope"), 3));
});

test("detectBase finds the branch new work starts from", async () => {
  const main = makeRepo();
  assert.equal(await detectBase(main), "main");
  const master = scratch("pp-master");
  sh(master, "init", "-q", "-b", "master");
  sh(master, "config", "user.name", "T"); sh(master, "config", "user.email", "t@e.x"); sh(master, "config", "commit.gpgsign", "false");
  sh(master, "commit", "-q", "--allow-empty", "-m", "first");
  assert.equal(await detectBase(master), "master");
  sh(master, "checkout", "-q", "-b", "trunk"); sh(master, "branch", "-D", "master");
  assert.equal(await detectBase(master), "trunk", "neither main nor master: the current branch");
  assert.equal(await detectBase(scratch("pp-norepo")), null);
});

// ---------------------------------------------------------------- the picker

test("a scan folder's checkouts are listed without being added, under their own header, and not twice when saved", async () => {
  const root = codeFolder("api", "web", "docs");
  const { v } = await open({ scan: { folders: [root] }, projects: [normalize({ name: "My API", path: join(root, "api") })] });
  assert.deepEqual(names(v), ["My API", "docs", "web"]);
  v.at = 1; // docs: the first found one
  const t = texts(v);
  for (const s of ["FOUND IN YOUR FOLDERS", "EVERYTHING ELSE", "3 of 3", "Save as project…", "Hide"]) assert.ok(t.includes(s), s);
  assert.equal(JSON.parse(readFileSync(dataFile(), "utf8")).projects.length, 1, "nothing was written");
});

test("a found project opens with the template's settings and the base branch git reports", async () => {
  const root = scratch("pp-code");
  const repo = join(root, "legacy");
  mkdirSync(repo);
  sh(repo, "init", "-q", "-b", "master"); sh(repo, "config", "user.name", "T"); sh(repo, "config", "user.email", "t@e.x"); sh(repo, "config", "commit.gpgsign", "false");
  sh(repo, "commit", "-q", "--allow-empty", "-m", "first");
  const template = normalize({ name: "Template", template: true, git: { fetch: false }, worktree: { mode: "always", branchTemplate: "{slug}", root: join(root, "..", "wt-{repo}-{branch}") }, startup: { agent: "codex" } });
  const { v, cx } = await open({ scan: { folders: [root] }, projects: [template], hideTemplate: false });
  assert.deepEqual(names(v), ["legacy", "Template"]);
  enter(v);
  await cx.settle();
  assert.equal(v.error, null);
  const made = state.runs.find((r) => r.command === "space.new");
  assert.deepEqual(made.args.argv, ["codex"]);
  assert.match(sh(repo, "worktree", "list"), /wt-legacy-/, "the worktree was cut from master, though the template says main");
});

test("a repo preset is shown before it is used: Enter asks, nothing runs, and the answer is remembered until the file changes", async () => {
  const root = codeFolder("docs");
  const repo = join(root, "docs");
  writePreset(repo, { name: "Docs Site", worktree: { mode: "never" }, git: { fetch: false }, startup: { agent: "claude", setup: ["touch setup-ran"] }, layouts: [{ name: "team", panes: [{ type: "agent" }, { type: "shell", direction: "down" }] }] });
  const { v, cx } = await open({ scan: { folders: [root] } });
  assert.deepEqual(names(v), ["docs"], "the file's name is not used before it is accepted");
  assert.match(texts(v), /repo preset: review/);
  enter(v);
  await cx.settle();
  assert.equal(v.mode, "trust");
  const t = texts(v);
  for (const s of ["Repo preset · docs", "touch setup-ran", "claude", "Docs Site", 'Layout "team"']) assert.ok(t.includes(s), s);
  assert.equal(state.runs.length, 0);
  assert.ok(!existsSync(join(repo, "setup-ran")));
  // Enter must not answer the question the same Enter opened.
  enter(v); press(v, cx, "enter");
  await cx.settle();
  assert.equal(v.mode, "trust");
  assert.equal(state.runs.length, 0);

  await click(v, cx, "pp-trust-use");
  assert.equal(v.error, null);
  assert.ok(existsSync(join(repo, "setup-ran")), "setup ran once the file was accepted");
  const made = state.runs.find((r) => r.command === "space.new");
  assert.deepEqual([made.args.name, made.args.argv], ["Docs Site", ["claude"]]);
  assert.deepEqual(JSON.parse(readFileSync(dataFile(), "utf8")).layouts.map((l) => l.name), ["team"], "its layout was added to mine");
  assert.equal(JSON.parse(readFileSync(trustFile(), "utf8"))[repo].use, true);

  // A new picker: no question, the preset is in use.
  const again = await open({ scan: { folders: [root] }, keepTrust: true });
  assert.deepEqual(names(again.v), ["Docs Site"]);
  assert.ok(!texts(again.v).includes("review"));
  // The file changes: asked again, and the old settings are not used meanwhile.
  writePreset(repo, { name: "Docs Site", startup: { agent: "claude", setup: ["touch other"] } });
  const changed = await open({ scan: { folders: [root] }, keepTrust: true });
  assert.deepEqual(names(changed.v), ["docs"]);
  enter(changed.v);
  await changed.cx.settle();
  assert.equal(changed.v.mode, "trust");
});

test("ignoring a repo preset opens with the template's settings and is remembered; alt+t uses one; back leaves it unanswered", async () => {
  const root = codeFolder("docs");
  const repo = join(root, "docs");
  writePreset(repo, { worktree: { mode: "never" }, git: { fetch: false }, startup: { agent: "claude", setup: ["touch setup-ran"] } });
  const template = normalize({ name: "Template", template: true, git: { fetch: false }, worktree: { mode: "never" }, startup: { agent: "" } });
  const { v, cx } = await open({ scan: { folders: [root] }, projects: [template] });
  enter(v);
  await cx.settle();
  press(v, cx, "b", { alt: true });
  assert.equal(v.mode, "list");
  assert.ok(!existsSync(trustFile()) || !JSON.parse(readFileSync(trustFile(), "utf8"))[repo]);
  enter(v);
  await cx.settle();
  await click(v, cx, "pp-trust-ignore");
  assert.ok(!existsSync(join(repo, "setup-ran")));
  assert.equal(state.runs.find((r) => r.command === "space.new").args.argv, undefined, "a plain shell, as the template says");
  const later = await open({ scan: { folders: [root] }, projects: [template], keepTrust: true });
  assert.match(texts(later.v), /repo preset ignored/);
  enter(later.v);
  await later.cx.settle();
  assert.notEqual(later.v.mode, "trust", "not asked again");

  const other = codeFolder("web");
  writePreset(join(other, "web"), { worktree: { mode: "never" }, git: { fetch: false }, startup: { agent: "codex" } });
  const b = await open({ scan: { folders: [other] } });
  enter(b.v);
  await b.cx.settle();
  press(b.v, b.cx, "t", { alt: true });
  await b.cx.settle();
  assert.deepEqual(state.runs.find((r) => r.command === "space.new").args.argv, ["codex"]);
});

test("a broken repo preset is reported on the row and the card, and the project still opens with the template's settings", async () => {
  const root = codeFolder("docs");
  writePreset(join(root, "docs"), "{ nope");
  const template = normalize({ name: "Template", template: true, git: { fetch: false }, worktree: { mode: "never" } });
  const { v, cx } = await open({ scan: { folders: [root] }, projects: [template] });
  const t = texts(v);
  assert.match(t, /repo preset: error/);
  assert.match(t, /not valid JSON/);
  enter(v);
  await cx.settle();
  assert.equal(v.error, null);
  assert.ok(state.runs.some((r) => r.command === "space.new"));
});

test("Hide removes a found project from the list after a second press, and Scan folders can show it again", async () => {
  const root = codeFolder("api", "web");
  const { v, cx } = await open({ scan: { folders: [root] } });
  press(v, cx, "d", { alt: true });
  assert.match(texts(v), /Hide "api" from the list\?/);
  press(v, cx, "d", { alt: true });
  await cx.settle();
  assert.deepEqual(names(v), ["web"]);
  assert.deepEqual(JSON.parse(readFileSync(dataFile(), "utf8")).scan.hidden, [join(root, "api")]);
  assert.ok(existsSync(join(root, "api", ".git")), "nothing on disk changed");
  press(v, cx, "f", { alt: true });
  assert.equal(v.mode, "scan");
  await click(v, cx, "pp-scan-unhide");
  assert.deepEqual(names(v), ["api", "web"]);
});

test("Save as project… opens the editor on the found checkout, filled in from its preset, and saving makes it a saved project", async () => {
  const root = codeFolder("docs");
  const repo = join(root, "docs");
  writePreset(repo, { name: "Docs Site", startup: { agent: "claude", setup: ["make"] }, layouts: [{ name: "team", panes: [{ type: "agent" }] }] });
  const { v, cx } = await open({ scan: { folders: [root] } });
  press(v, cx, "e", { alt: true });
  await cx.settle();
  assert.equal(v.mode, "edit");
  const t = texts(v);
  assert.match(t, /Add project/);
  assert.match(t, /Filled in from the repo's \.herdr\/project-presets\.json/);
  assert.deepEqual([v.draft.name, v.draft.path, v.draft.startup.setup, v.draft.git.base], ["Docs Site", repo, ["make"], "main"]);
  await click(v, cx, "pp-save");
  assert.equal(v.error, null);
  const data = JSON.parse(readFileSync(dataFile(), "utf8"));
  assert.deepEqual(data.projects.map((p) => [p.name, p.path, p.discovered, p.preset]), [["Docs Site", repo, undefined, undefined]]);
  assert.deepEqual(data.layouts.map((l) => l.name), ["team"]);
  assert.deepEqual(names(v), ["Docs Site"], "it is listed once, as a saved project");
  assert.ok(!texts(v).includes("FOUND IN YOUR FOLDERS"));
});

test("the Scan folders screen adds, refuses and removes folders, and says what it found", async () => {
  const root = codeFolder("api", "web");
  const { v, cx } = await open({});
  assert.match(texts(v), /Scan…/);
  await click(v, cx, "pp-scan");
  assert.match(texts(v), /No folders yet/);
  v.scanInput.set_value(join(root, "missing"));
  await click(v, cx, "pp-scan-add");
  assert.match(texts(v), /There is no folder at/);
  v.scanInput.set_value(`${root}/`);
  await click(v, cx, "pp-scan-add");
  assert.match(texts(v), /Found 2 git checkouts\. 2 are listed/);
  assert.deepEqual(JSON.parse(readFileSync(dataFile(), "utf8")).scan.folders, [root]);
  v.scanInput.set_value(root);
  await click(v, cx, "pp-scan-add");
  assert.match(texts(v), /already scanned/);
  state.picked = scratch("pp-empty");
  await click(v, cx, "pp-scan-browse");
  assert.equal(v.scan.folders.length, 2);
  await click(v, cx, "pp-scan-rm-0");
  assert.deepEqual(v.scan.folders, [state.picked]);
  await click(v, cx, "pp-scan-back");
  assert.deepEqual(names(v), []);
});

test("Browse… on a new project fills the editor from the repo's preset file; an existing project is left alone", async () => {
  const repo = makeRepo();
  writePreset(repo, { name: "Shared", git: { base: "develop" }, startup: { agent: "codex", tabs: ["npm run dev"] } });
  const mine = normalize({ name: "mine", path: makeRepo(), startup: { agent: "claude" } });
  const { v, cx } = await open({ projects: [mine] });
  press(v, cx, "n", { alt: true });
  state.picked = repo;
  await click(v, cx, "pp-browse");
  assert.deepEqual([v.draft.name, v.draft.path, v.draft.git.base, v.draft.startup.agent, v.draft.startup.tabs], ["Shared", repo, "develop", "codex", ["npm run dev"]]);
  assert.match(texts(v), /Filled in from the repo/);
  press(v, cx, "b", { alt: true });
  press(v, cx, "e", { alt: true });
  await click(v, cx, "pp-browse");
  assert.equal(v.draft.startup.agent, "claude");
});

test("Write repo preset puts the project's shared settings in the repo, asks before replacing other content, and needs no review afterwards", async () => {
  const root = codeFolder("api");
  const repo = join(root, "api");
  const layouts = [{ name: "dev", panes: [{ type: "agent" }, { type: "shell", direction: "right" }] }];
  const { v, cx } = await open({ layouts, projects: [normalize({ name: "API", path: repo, pinned: true, startup: { agent: "claude", layout: "dev", setup: ["make"] } })] });
  press(v, cx, "e", { alt: true });
  await click(v, cx, "pp-write-preset");
  assert.equal(v.error, null);
  const file = JSON.parse(readFileSync(join(repo, PRESET_FILE), "utf8"));
  assert.deepEqual([file.name, file.startup.agent, file.startup.setup, file.layouts, file.path, file.pinned], ["API", "claude", ["make"], layouts, undefined, undefined]);
  assert.match(texts(v), /Wrote .*project-presets\.json\. Commit it/);

  writeFileSync(join(repo, PRESET_FILE), "{}\n");
  await click(v, cx, "pp-write-preset");
  assert.equal(readFileSync(join(repo, PRESET_FILE), "utf8"), "{}\n", "the first click only asks");
  assert.match(texts(v), /already exists with other settings/);
  await click(v, cx, "pp-write-preset");
  assert.equal(JSON.parse(readFileSync(join(repo, PRESET_FILE), "utf8")).name, "API");

  // Someone without the project saved, scanning the folder: the file they wrote themselves is already accepted.
  const b = await open({ scan: { folders: [root] }, keepTrust: true });
  assert.deepEqual(names(b.v), ["API"]);
  assert.ok(!texts(b.v).includes("review"));
});

test("a demo file's steps stop at one that fails: a missing project is never replaced by another row", async () => {
  const dir = makeRepo();
  const { v, cx } = await open({ projects: [normalize({ name: "real", path: dir, git: { fetch: false }, worktree: { mode: "never" } })] });
  v.runDemoSteps([["select", "no-such-project"], ["activate", false]]);
  await cx.settle();
  assert.match(v.error, /no project called "no-such-project"/);
  assert.equal(state.runs.length, 0, "nothing was opened");
  assert.equal(v.mode, "list");
});

// ---------------------------------------------------------------- settings

const { setShared } = await import("./helpers/herdr-stub.mjs");
const sizes = (v) => findAll(rendered(v), (e) => e.has?.("text_size")).map((e) => e.op("text_size")[0]);

test("Settings changes the text size in steps between 80% and 150%, keeps it for next time, and Reset goes back to 100%", async () => {
  const { v, cx } = await open({ projects: [normalize({ name: "api", path: "/r/api" })] });
  const before = sizes(v);
  const rowBefore = findAll(rendered(v), (e) => e.op?.("id")?.[0] === "pp-0")[0].op("h")[0];
  assert.equal(rowBefore, 48);
  press(v, cx, "s", { alt: true });
  assert.equal(v.mode, "settings");
  assert.match(texts(v), /Text size/);
  assert.match(texts(v), /100%/);
  await click(v, cx, "pp-set-bigger");
  await click(v, cx, "pp-set-bigger");
  assert.match(texts(v), /120%/);
  await click(v, cx, "pp-set-back");
  const after = sizes(v);
  assert.equal(after.length, before.length);
  assert.ok(after.every((s, i) => Math.abs(s - before[i] * 1.2) < 0.06), "every text size grew by the same share");
  assert.equal(findAll(rendered(v), (e) => e.op?.("id")?.[0] === "pp-0")[0].op("h")[0], 57.6, "rows grow with the text");

  // A new picker starts at the kept size (reset() in open() clears herdr's shared state, so set it as herdr would have it).
  const again = await open({ projects: [normalize({ name: "api", path: "/r/api" })] });
  assert.deepEqual(sizes(again.v), before, "a fresh machine is at 100%");
  setShared("project-presets.scale", 0.8);
  const small = new Picker();
  small.init({}, again.cx);
  await again.cx.settle();
  assert.equal(findAll(rendered(small), (e) => e.op?.("id")?.[0] === "pp-0")[0].op("h")[0], 38.4);
  small.openSettings();
  for (let i = 0; i < 3; i++) await click(small, again.cx, "pp-set-smaller");
  assert.match(texts(small), /80%/, "it stops at the smallest step");
  for (let i = 0; i < 12; i++) press(small, again.cx, "=", { alt: true });
  assert.match(texts(small), /150%/, "and at the largest");
  press(small, again.cx, "0", { alt: true });
  assert.match(texts(small), /100%/);
  setShared("project-presets.scale", "huge");
  const odd = new Picker();
  odd.init({}, again.cx);
  await again.cx.settle();
  assert.deepEqual(sizes(odd), before, "a stored value that is not one of the steps is 100%");
});

test("Settings turns the git details and the detail card on and off", async () => {
  const { v, cx } = await open({ projects: [normalize({ name: "api", path: makeRepo() })] });
  setShared("project-presets.scale", 1);
  v.openSettings();
  await click(v, cx, "pp-set-git");
  assert.equal(JSON.parse(readFileSync(dataFile(), "utf8")).gitInfo, false);
  assert.match(texts(v), /○ Off/);
  await click(v, cx, "pp-set-git");
  assert.equal(JSON.parse(readFileSync(dataFile(), "utf8")).gitInfo, true);
  const shown = v.detail;
  await click(v, cx, "pp-set-detail");
  assert.equal(v.detail, !shown);
});

test("every screen has an × beside the key hints that closes the picker; a launch under way has none", async () => {
  const { v, cx } = await open({ projects: [normalize({ name: "api", path: "/r/api" })] });
  const closeButton = () => findAll(rendered(v), (e) => e.op?.("id")?.[0] === "pp-close");
  for (const go of [() => {}, () => v.openSettings(), () => v.openScan(), () => v.openBackup(), () => { v.mode = "list"; v.editSelected(); }]) {
    go();
    assert.equal(closeButton().length, 1, v.mode);
    assert.equal(textOf(closeButton()[0]), "×");
  }
  v.target = v.projects[0];
  v.mode = "busy"; v.error = null;
  assert.equal(closeButton().length, 0, "not while it is working");
  v.error = "it failed";
  assert.equal(closeButton().length, 1, "once it has failed there is something to close");
  v.mode = "list"; v.error = null;
  assert.equal(state.closed, 0);
  await click(v, cx, "pp-close");
  assert.equal(state.closed, 1);
});

test("the editor picks the pane layout from cards: a click sets it, Save keeps it, and an unknown name is shown rather than dropped", async () => {
  const root = codeFolder("api");
  const repo = join(root, "api");
  const layouts = [{ name: "dev", panes: [{ type: "agent" }, { type: "shell", direction: "right" }] }];
  const { v, cx } = await open({ layouts, projects: [normalize({ name: "API", path: repo, startup: { agent: "claude", layout: "gone" } })] });
  press(v, cx, "e", { alt: true });
  v.showSection("startup");
  const cards = () => findAll(rendered(v), (e) => String(e.op?.("id")?.[0] ?? "").startsWith("pp-edit-lay-"));
  const labels = cards().map((c) => textOf(c));
  assert.match(labels[0], /Agent only/);
  assert.ok(labels.some((l) => /dev/.test(l)), "the person's own layout has a card");
  assert.match(labels.at(-1), /gone.*not found/, "a name no layout has is still shown");
  assert.equal(/a layout name/.test(texts(v)), false, "no text box for the name any more");

  const dev = labels.findIndex((l) => /dev/.test(l));
  await click(v, cx, `pp-edit-lay-${dev}`);
  assert.equal(cards().length, labels.length - 1, "the missing name's card goes once another is picked");
  await click(v, cx, "pp-save");
  assert.equal(v.projects.find((p) => p.name === "API").startup.layout, "dev");

  press(v, cx, "e", { alt: true });
  v.showSection("startup");
  await click(v, cx, "pp-edit-lay-0");
  await click(v, cx, "pp-save");
  assert.equal(v.projects.find((p) => p.name === "API").startup.layout || "", "");
});
