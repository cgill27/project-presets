import "./helpers/setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";

const { state, reset } = await import("./helpers/herdr-stub.mjs");
const { loadConfig, saveConfig } = await import("../mods/project-presets/config.js");
const file = `${state.appHome}/data/project-presets.json`;

test("a missing file is an empty list", async () => {
  reset();
  assert.deepEqual(await loadConfig(), { projects: [], layouts: [], raw: null });
});

test("save then load round-trips and fills defaults", async () => {
  const { raw } = await loadConfig();
  const text = await saveConfig([{ name: "api", path: "/r/api" }], raw);
  assert.equal(readFileSync(file, "utf8"), text);
  const loaded = await loadConfig();
  assert.equal(loaded.raw, text);
  assert.equal(loaded.projects[0].name, "api");
  assert.equal(loaded.projects[0].git.base, "main");
});

test("a hand edit between load and save is refused", async () => {
  const { raw, projects } = await loadConfig();
  writeFileSync(file, JSON.stringify({ projects: [] }));
  await assert.rejects(saveConfig(projects, raw), /changed/);
});

test("invalid JSON names the file", async () => {
  mkdirSync(`${state.appHome}/data`, { recursive: true });
  writeFileSync(file, "{ nope");
  await assert.rejects(loadConfig(), /project-presets\.json is not valid JSON/);
});

test("a file without a projects key is an empty list", async () => {
  writeFileSync(file, "{}");
  assert.deepEqual((await loadConfig()).projects, []);
});

test("layouts are loaded, and saving projects keeps them and other keys", async () => {
  const layouts = [{ name: "dev", panes: [{ type: "agent" }] }];
  writeFileSync(file, JSON.stringify({ note: "hi", layouts, projects: [] }));
  const loaded = await loadConfig();
  assert.deepEqual(loaded.layouts, layouts);
  await saveConfig([{ name: "api", path: "/r/api" }], loaded.raw);
  const data = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(data.layouts, layouts);
  assert.equal(data.note, "hi");
  assert.equal(data.projects[0].name, "api");
});

test("a missing or malformed layouts key is an empty list", async () => {
  writeFileSync(file, JSON.stringify({ layouts: "nope", projects: [] }));
  assert.deepEqual((await loadConfig()).layouts, []);
  rmSync(file);
  assert.deepEqual((await loadConfig()).layouts, []);
});
