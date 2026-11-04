// Troubleshooting log. Errors always go to console.error and ~/.config/herdr-app/data/project-presets.log.
// `touch ~/.config/herdr-app/data/project-presets.debug` (then reopen the picker) also logs every
// key, click, git command and step. Remove the file to go quiet again.
import * as fs from "fs/promises";
import { appHome } from "herdr";

const MAX = 64 * 1024;
const dir = () => `${appHome()}/data`;
let debug = false;
let queue = Promise.resolve();
let tail = null; // the last 64 KB, read from the file once and kept here
let pending = ""; // lines logged since the last write
let scheduled = false;

/** herdr's fs has exists(); plain node's fs/promises doesn't, so fall back to access(). */
async function missing(path) {
  try {
    if (typeof fs.exists === "function") return !(await fs.exists(path));
    await fs.access(path);
    return false;
  } catch { return true; }
}

/** Writes everything logged since the last write in one go: a burst of events costs one write, not a read and a write each. */
async function flush() {
  scheduled = false;
  const lines = pending;
  pending = "";
  if (!lines) return;
  const path = `${dir()}/project-presets.log`;
  try {
    // The kept tail is only trusted while the file is still there: someone clearing the log starts it afresh.
    if (tail === null || (await missing(path))) {
      tail = "";
      try { tail = await fs.readFile(path, "utf8"); } catch {}
    }
    const next = (tail + lines).slice(-MAX);
    await fs.writeFile(path, next);
    tail = next; // kept only once it is on disk
  } catch (e) {
    pending = (lines + pending).slice(-MAX); // a failed write: the lines wait for the next flush (bounded)
    console.error(`[project-presets] couldn't write the log: ${e?.message ?? e}`);
  }
}

export async function initLog() {
  try { debug = await fs.exists(`${dir()}/project-presets.debug`); } catch { debug = false; }
  log("debug", "picker opened", { debug });
}

export function log(level, message, data) {
  if (level === "debug" && !debug) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${data === undefined ? "" : " " + JSON.stringify(data)}`;
  (level === "error" ? console.error : console.log)(`[project-presets] ${line}`);
  pending += line + "\n";
  if (scheduled) return;
  scheduled = true;
  queue = queue.then(flush).catch(() => {});
}

export const logError = (where, e) => log("error", `${where}: ${e?.message ?? e}`, e?.stack ? { stack: String(e.stack).split("\n").slice(0, 4) } : undefined);
