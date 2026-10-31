import test from "node:test";
import assert from "node:assert/strict";
import { fuzzy, slug, expand, branchName, expandHome, splitList, normalize, splitArgs, basename, parseWorktrees, fuzzyPositions, highlightRuns, commandName, agentOptions, allLayouts, layoutPlan, nextLayout, inFolder, BUILTIN_LAYOUTS, dateStamp, timeStamp, shortHome, joinList, blankProject } from "../mods/project-presets/lib.js";

test("fuzzy matches subsequences and ranks tighter matches higher", () => {
  assert.equal(fuzzy("zzz", "herdr"), -1);
  assert.ok(fuzzy("hdr", "herdr") >= 0);
  assert.ok(fuzzy("her", "herdr") > fuzzy("hdr", "herdr"));
  assert.ok(fuzzy("api", "my-api") > fuzzy("api", "xaxxpxxi"));
  assert.equal(fuzzy("", "anything"), 0);
});

test("slug", () => assert.equal(slug("  Ada Lovelace!  "), "ada-lovelace"));

test("expand fills variables and blanks unknown ones", () => {
  assert.equal(expand("{a}/{b}/{c}", { a: "x", b: "y" }), "x/y/");
});

test("branchName cleans the result", () => {
  assert.equal(branchName("{user}/{date}-{slug}", { user: "craig", date: "2026-10-30", slug: "fix login" }), "craig/2026-10-30-fix-login");
  assert.equal(branchName("{user}//{slug}", { user: "", slug: "x" }), "x");
});

test("expandHome", () => {
  assert.equal(expandHome("~/code/api/", "/home/c"), "/home/c/code/api");
  assert.equal(expandHome("/srv/x", "/home/c"), "/srv/x");
});

test("splitList", () => assert.deepEqual(splitList(" npm ci ;; cp a b ;;"), ["npm ci", "cp a b"]));

test("normalize keeps overrides and fills defaults", () => {
  const p = normalize({ path: "/r/x", git: { base: "develop" } });
  assert.equal(p.git.base, "develop");
  assert.equal(p.git.remote, "origin");
  assert.equal(p.worktree.mode, "ask");
});

test("splitArgs keeps quoted words together", () => {
  assert.deepEqual(splitArgs(`--model opus --append-system-prompt "be brief" 'x y'`), ["--model", "opus", "--append-system-prompt", "be brief", "x y"]);
  assert.deepEqual(splitArgs(""), []);
});

test("worktree defaults cover the space name and the repo space", () => {
  const p = normalize({ path: "/r/x", worktree: { mode: "always" } });
  assert.equal(p.worktree.mode, "always");
  assert.equal(p.worktree.spaceName, "{name} · {branch}");
  assert.equal(p.worktree.repoSpace, false);
  assert.equal(expand(p.worktree.spaceName, { name: "API", branch: "me/2026-10-31-x" }), "API · me/2026-10-31-x");
  assert.equal(expand("{slug}", { slug: "add-search" }), "add-search");
});


test("paths keep trailing spaces and accept backslashes", () => {
  assert.equal(expandHome("/srv/Repo  ", "/h"), "/srv/Repo  ");
  assert.equal(expandHome("~/x\n", "/h"), "/h/x");
  assert.equal(basename("C:\\work\\repo\\"), "repo");
  assert.equal(basename("/srv/repo/"), "repo");
});

test("fuzzy: case-insensitive, prefers word starts, rejects out-of-order letters", () => {
  assert.ok(fuzzy("API", "my-api") >= 0);
  assert.ok(fuzzy("ma", "my-api") > fuzzy("ma", "xxmxxa"));
  assert.equal(fuzzy("ba", "ab"), -1);
});

test("slug drops punctuation, accents and edge dashes; tolerates null", () => {
  assert.equal(slug("--Fix: login/page!!--"), "fix-login-page");
  assert.equal(slug(null), "");
  assert.equal(slug("***"), "");
});

test("dateStamp and timeStamp zero-pad", () => {
  const d = new Date(2026, 0, 2, 3, 4, 5);
  assert.equal(dateStamp(d), "2026-01-02");
  assert.equal(timeStamp(d), "030405");
});

test("branchName cleans spaces, doubled slashes and leading or trailing junk", () => {
  assert.equal(branchName("  -/{slug}/.", { slug: "a b" }), "a-b");
  assert.equal(branchName("{a}", {}), "");
});

test("expandHome handles ~, $HOME and bare home", () => {
  assert.equal(expandHome("~", "/h"), "/h");
  assert.equal(expandHome("$HOME/x", "/h"), "/h/x");
  assert.equal(expandHome("~user/x", "/h"), "~user/x");
  assert.equal(expandHome(undefined, "/h"), "");
});

test("shortHome only shortens real home prefixes", () => {
  assert.equal(shortHome("/h", "/h"), "~");
  assert.equal(shortHome("/h/x/y", "/h"), "~/x/y");
  assert.equal(shortHome("/hx/y", "/h"), "/hx/y");
});

test("joinList and splitList round-trip", () => {
  assert.equal(joinList(["a", "b"]), "a ;; b");
  assert.equal(joinList(undefined), "");
  assert.deepEqual(splitList(joinList(["npm ci", "cp a b"])), ["npm ci", "cp a b"]);
});

test("splitArgs on unbalanced quotes keeps the words", () => {
  assert.deepEqual(splitArgs(`a "b c`), ["a", '"b', "c"]);
});

test("blankProject and normalize", () => {
  const b = blankProject("/r/api/");
  assert.equal(b.name, "api");
  assert.equal(b.worktree.mode, "ask");
  assert.deepEqual(b.startup.setup, []);
  const n = normalize({ name: "x", startup: { agent: "claude" } });
  assert.equal(n.startup.agent, "claude");
  assert.equal(n.startup.promptMode, "arg");
  assert.equal(normalize(undefined).path, "");
  assert.deepEqual(normalize({ path: "/a" }).git, { fetch: true, remote: "origin", base: "main", fastForward: false });
});


test("parseWorktrees reads plain porcelain output", () => {
  const text = "worktree /r/main\nHEAD aaa\nbranch refs/heads/main\n\nworktree /r/wt\nHEAD bbb\nbranch refs/heads/me/x\nlocked reason\n\nworktree /r/old\nHEAD ccc\ndetached\nprunable gitdir file points to non-existent location\n";
  const [main, wt, old] = parseWorktrees(text);
  assert.deepEqual(main, { path: "/r/main", branch: "main", locked: false, prunable: false });
  assert.deepEqual(wt, { path: "/r/wt", branch: "me/x", locked: true, prunable: false });
  assert.deepEqual(old, { path: "/r/old", branch: null, locked: false, prunable: true });
});

test("parseWorktrees reads -z output, where a path may hold a newline", () => {
  const text = "worktree /r/main\0HEAD aaa\0branch refs/heads/main\0\0worktree /r/line\nbreak\0HEAD bbb\0branch refs/heads/b\0\0";
  const list = parseWorktrees(text);
  assert.equal(list.length, 2);
  assert.equal(list[1].path, "/r/line\nbreak");
  assert.equal(list[1].branch, "b");
  assert.deepEqual(parseWorktrees(""), []);
});

test("allLayouts offers the built-ins and lets a user layout replace one of the same name", () => {
  assert.deepEqual(allLayouts(undefined).map((l) => l.name), BUILTIN_LAYOUTS.map((l) => l.name));
  const mine = { name: "agent-terminal", panes: [{ type: "agent" }] };
  const list = allLayouts([mine, { name: "dev", panes: [{ type: "agent" }] }, { name: "", panes: [] }, { panes: [] }, null, { name: "nopanes" }]);
  assert.deepEqual(list.map((l) => l.name), ["agent-side-terminal", "agent-terminal", "dev"]);
  assert.equal(list.find((l) => l.name === "agent-terminal"), mine);
});

test("layoutPlan lists the splits in order and defaults each to the previous pane", () => {
  const plan = layoutPlan({ name: "dev", panes: [
    { type: "agent" },
    { name: "files", command: "yazi .", direction: "right" },
    { name: "term", type: "shell", direction: "down" },
    { name: "logs", type: "command", command: " tail -f log ", direction: "down", from: "agent" },
  ] });
  assert.deepEqual(plan, [
    { name: "files", type: "command", command: "yazi .", direction: "right", from: "agent" },
    { name: "term", type: "shell", command: "", direction: "down", from: "files" },
    { name: "logs", type: "command", command: "tail -f log", direction: "down", from: "agent" },
  ]);
  assert.deepEqual(layoutPlan({ name: "solo", panes: [{ type: "agent" }] }), []);
  assert.deepEqual(layoutPlan(undefined), []);
});

test("layoutPlan names the problem in a bad layout", () => {
  const bad = (panes) => () => layoutPlan({ name: "x", panes });
  assert.throws(bad([{ type: "agent" }, { type: "shell" }]), /needs direction/);
  assert.throws(bad([{ type: "agent" }, { type: "shell", direction: "left" }]), /needs direction/);
  assert.throws(bad([{ type: "agent" }, { type: "tmux", direction: "down" }]), /unknown type/);
  assert.throws(bad([{ type: "agent" }, { type: "command", direction: "down" }]), /no command/);
  assert.throws(bad([{ type: "agent" }, { name: "a", direction: "down", from: "later" }, { name: "later", direction: "down" }]), /does not come before/);
  assert.throws(bad([{ name: "a" }, { name: "a", direction: "down" }]), /two panes are called "a"/);
});

test("nextLayout cycles none, then each layout, then none again", () => {
  assert.equal(nextLayout(["a", "b"], ""), "a");
  assert.equal(nextLayout(["a", "b"], "a"), "b");
  assert.equal(nextLayout(["a", "b"], "b"), "");
  assert.equal(nextLayout(["a", "b"], "gone"), "");
  assert.equal(nextLayout(["a"], undefined), "a");
});

test("inFolder wraps a command so it starts in the folder, or starts a shell without one", () => {
  const [sh, c, script, , folder, ...rest] = inFolder("/r/x", ["npm", "run", "dev"]);
  assert.deepEqual([sh, c, folder, rest], ["sh", "-c", "/r/x", ["npm", "run", "dev"]]);
  assert.match(script, /cd "\$1"/);
  assert.deepEqual(inFolder("/r/x").slice(4), ["/r/x"]);
});

test("normalize gives every project an empty layout", () => assert.equal(normalize({ path: "/a" }).startup.layout, ""));

test("fuzzyPositions marks the letters fuzzy matched, and none for a miss or an empty query", () => {
  assert.deepEqual(fuzzyPositions("apgw", "api-gateway"), [0, 1, 4, 8]);
  assert.deepEqual(fuzzyPositions("API", "my-api"), [3, 4, 5]);
  assert.deepEqual(fuzzyPositions("zzz", "api-gateway"), []);
  assert.deepEqual(fuzzyPositions("", "api"), []);
  assert.deepEqual(fuzzyPositions("ba", "ab"), []);
});

test("highlightRuns groups consecutive matched and unmatched characters", () => {
  assert.deepEqual(highlightRuns("api-gateway", [0, 1, 4, 8]), [
    { text: "ap", hit: true }, { text: "i-", hit: false }, { text: "g", hit: true }, { text: "ate", hit: false }, { text: "w", hit: true }, { text: "ay", hit: false },
  ]);
  assert.deepEqual(highlightRuns("abc", []), [{ text: "abc", hit: false }]);
  assert.deepEqual(highlightRuns("", [0]), []);
});

test("commandName is the program an agent command runs", () => {
  assert.equal(commandName("claude --model opus"), "claude");
  assert.equal(commandName("/usr/local/bin/hermes"), "hermes");
  assert.equal(commandName('"pi" --x'), "pi");
  assert.equal(commandName(""), "");
  assert.equal(commandName(undefined), "");
});

test("agentOptions keeps herdr's agents and adds the usual ones it lacks, marked not installed", () => {
  const known = [{ key: "claude", name: "Claude Code", run: ["claude"], installed: true }, { key: "x", name: "Hermes", run: ["/opt/bin/hermes"], installed: true }];
  const list = agentOptions(known);
  assert.deepEqual(list.slice(0, 2), known);
  assert.deepEqual(list.slice(2).map((a) => a.key), ["codex", "opencode", "pi"]);
  assert.ok(list.slice(2).every((a) => a.installed === false && a.icon === `icons/${a.key}.svg`));
  assert.deepEqual(agentOptions(undefined).map((a) => a.key), ["claude", "codex", "opencode", "hermes", "pi"]);
});
