import "./helpers/setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";

const { state } = await import("./helpers/herdr-stub.mjs");
const { log, logError, initLog } = await import("../mods/project-presets/log.js");
const file = `${state.appHome}/data/project-presets.log`;
mkdirSync(`${state.appHome}/data`, { recursive: true });

const settle = async (check) => {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise((r) => setTimeout(r, 20)); }
};
const text = () => (existsSync(file) ? readFileSync(file, "utf8") : "");

test("errors are written to the log file", async () => {
  log("error", "boom", { a: 1 });
  await settle(() => text().includes("boom"));
  assert.match(text(), /ERROR boom \{"a":1\}/);
});

test("debug lines are dropped while debug is off", async () => {
  await initLog();
  log("debug", "quiet");
  log("error", "marker");
  await settle(() => text().includes("marker"));
  assert.ok(!text().includes("quiet"));
});

test("logError records the message and the top of the stack", async () => {
  logError("save", new Error("disk full"));
  await settle(() => text().includes("disk full"));
  assert.match(text(), /ERROR save: disk full/);
  assert.match(text(), /stack/);
});

test("only the last 64 KB are kept", async () => {
  for (let i = 0; i < 700; i++) log("error", `line ${i} ${"x".repeat(100)}`);
  await settle(() => text().includes("line 699"));
  assert.ok(text().length <= 64 * 1024);
  assert.ok(!text().includes("line 0 "));
});

test("a burst of lines is written in order, once the file has all of them", async () => {
  for (let i = 0; i < 20; i++) log("error", `burst ${i}`);
  await settle(() => text().includes("burst 19"));
  const seen = [...text().matchAll(/burst (\d+)/g)].map((m) => Number(m[1]));
  assert.deepEqual(seen, Array.from({ length: 20 }, (_, i) => i));
});

test("a burst is written in a few writes, not one per line", async () => {
  // Count the distinct states the file goes through: a write per line would show about 200 of them.
  const sizes = new Set();
  const watch = setInterval(() => { if (existsSync(file)) sizes.add(readFileSync(file, "utf8").length); }, 0);
  for (let i = 0; i < 200; i++) log("error", `many ${i}`);
  await settle(() => text().includes("many 199"));
  clearInterval(watch);
  assert.ok(sizes.size <= 10, `${sizes.size} different file states seen for 200 lines`);
});

test("clearing the log file starts it afresh instead of bringing the old lines back", async () => {
  log("error", "before clear");
  await settle(() => text().includes("before clear"));
  rmSync(file);
  log("error", "after clear");
  await settle(() => text().includes("after clear"));
  assert.ok(!text().includes("before clear"));
});

test("emptying the log file in place starts it afresh instead of bringing the old lines back", async () => {
  const { writeFileSync } = await import("node:fs");
  log("error", "old line");
  await settle(() => text().includes("old line"));
  writeFileSync(file, ""); // like `: > project-presets.log`
  log("error", "new line");
  await settle(() => text().includes("new line"));
  assert.ok(!text().includes("old line"));
});
