import test from "node:test";
import assert from "node:assert/strict";
import { fuzzy, slug, expand, branchName, expandHome, splitList, normalize, splitArgs, basename, unquotePath } from "../mods/project-presets/lib.js";

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

test("unquotePath decodes git's quoted paths", () => {
  assert.equal(unquotePath("/srv/plain"), "/srv/plain");
  assert.equal(unquotePath('"/srv/a\\nb"'), "/srv/a\nb");
  assert.equal(unquotePath('"/srv/say \\"hi\\" \\\\ x"'), '/srv/say "hi" \\ x');
  assert.equal(unquotePath('"/srv/caf\\303\\251"'), "/srv/café");
});

test("paths keep trailing spaces and accept backslashes", () => {
  assert.equal(expandHome("/srv/Repo  ", "/h"), "/srv/Repo  ");
  assert.equal(expandHome("~/x\n", "/h"), "/h/x");
  assert.equal(basename("C:\\work\\repo\\"), "repo");
  assert.equal(basename("/srv/repo/"), "repo");
});
