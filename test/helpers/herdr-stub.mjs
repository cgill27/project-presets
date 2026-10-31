// A stand-in for herdr's `herdr` module. exec runs real programs (so git tests use real repos);
// hc, run, spaces and focused are a small fake of the app that tests can inspect and steer.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "pp-herdr-"));
mkdirSync(join(root, "app", "data"), { recursive: true });

export const state = {
  home: join(root, "home"),
  appHome: join(root, "app"),
  spaces: [],
  focused: null,
  terminals: [],        // what `hc ls --json` reports
  foreground: "claude", // what `hc get` reports as the foreground program
  runs: [],             // every run(command, args)
  sent: [],             // every `hc send <terminal> <text>`
  agentStatus: "idle",  // status given to a terminal created by space.new
  nextId: 1,
};

export function reset() {
  Object.assign(state, { spaces: [], focused: null, terminals: [], foreground: "claude", runs: [], sent: [], agentStatus: "idle", nextId: 1, sendFails: false });
}

export const home = () => state.home;
export const appHome = () => state.appHome;
export const spaces = () => state.spaces;
export const focused = () => state.focused;

export function exec(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd: options.cwd, encoding: "utf8", maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== "number") return reject(err);
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}

// space.new makes a space and a live terminal in the folder, as herdr does; the rest is only recorded.
export function run(command, args = {}) {
  state.runs.push({ command, args });
  if (command === "space.new") {
    const id = `sp${state.nextId++}`;
    state.spaces.push({ id, name: args.name, folder: args.folder, machine: null });
    state.focused = { space: id };
    state.terminals.push({ address: `t${state.nextId++}`, cwd: args.folder, state: "live", status: state.agentStatus, agent: args.argv?.[0] ?? null, argv: args.argv ?? [] });
  } else if (command === "space.close") {
    state.spaces = state.spaces.filter((s) => s.id !== args.id);
  }
  return null;
}

export async function hc(args) {
  // The answer is read when hc is called and delivered later, like a real process: a slow `ls` shows old state.
  const answer = hcNow(args);
  await new Promise((r) => setImmediate(r));
  return answer;
}

function hcNow(args) {
  const [cmd, ...rest] = args;
  const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
  if (cmd === "ls") return ok(JSON.stringify({ terminals: state.terminals }));
  if (cmd === "get") {
    const t = state.terminals.find((x) => x.address === rest[0]);
    return t ? ok(JSON.stringify({ ...t, foreground: { name: state.foreground } })) : { code: 3, stdout: "", stderr: "not_found\n" };
  }
  if (cmd === "send") {
    state.sent.push({ terminal: rest[0], text: rest[1] });
    return state.sendFails ? { code: 1, stdout: "", stderr: "send failed\nmore" } : ok("{}");
  }
  return { code: 1, stdout: "", stderr: `unsupported: ${cmd}` };
}

// Same contract as herdr: a missing file reads as null; a write is refused when the file is no longer `expected`.
export async function readTextFile(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}
export async function writeTextFile(path, text, expected) {
  const now = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (now !== expected) throw new Error("the file changed since it was read");
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  return null;
}
