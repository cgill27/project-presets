// Everything that touches git or starts a space. `log(msg)` reports progress to the picker.
import { exec as rawExec, run, focused, spaces, home } from "herdr";
import { log } from "./log.js";
import { splitArgs, slug, branchName, expandHome, expand, basename, dateStamp, timeStamp } from "./lib.js";

/** exec, logged in debug mode: command, folder, exit code and the first line of stderr. */
async function exec(command, args = [], options = {}) {
  try {
    const r = await rawExec(command, args, options);
    log("debug", `exec ${command} ${args.join(" ")}`, { cwd: options.cwd, code: r.code, err: r.stderr.split("\n")[0] });
    return r;
  } catch (e) {
    log("error", `exec ${command} ${args.join(" ")} could not run: ${e.message}`, { cwd: options.cwd });
    throw e;
  }
}
const git = (cwd, args) => exec("git", args, { cwd });
const out = (r) => r.stdout.trim();

export const projectFolder = (p) => expandHome(p.path, home());

/** Checks the folder is a git checkout. Returns { top, branch }. Throws with the reason. */
export async function inspect(folder) {
  let r;
  try {
    r = await git(folder, ["rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"]);
  } catch {
    throw new Error(`Can't open ${folder}`);
  }
  if (r.code !== 0) throw new Error(`${folder} is not a git checkout`);
  const [top, branch] = out(r).split("\n");
  return { top, branch };
}

/** {user} is git config user.name, falling back to user.email's local part. */
export async function gitUser(folder) {
  for (const [key, pick] of [["user.name", (s) => s], ["user.email", (s) => s.split("@")[0]]]) {
    const r = await git(folder, ["config", key]);
    if (r.code === 0 && out(r)) return slug(pick(out(r)));
  }
  return "user";
}

export async function templateVars(project, slugText) {
  const folder = projectFolder(project);
  const { top } = await inspect(folder);
  return {
    user: await gitUser(folder),
    date: dateStamp(),
    slug: slug(slugText) || timeStamp(),
    repo: basename(top),
    project: slug(project.name),
  };
}

/** What the branch will be called, before collisions are resolved. */
export async function previewBranch(project, slugText) {
  return branchName(project.worktree.branchTemplate, await templateVars(project, slugText));
}

/** git fetch, tolerating failure (offline): the local ref is used instead. */
async function fetchRemote(folder, g, log) {
  if (!g.fetch) return;
  log(`git fetch ${g.remote}…`);
  try {
    const r = await git(folder, ["fetch", g.remote]);
    if (r.code !== 0) log(`fetch failed, using local refs: ${out({ stdout: r.stderr }).split("\n")[0]}`);
  } catch {
    log("fetch timed out, using local refs");
  }
}

async function baseRef(folder, g) {
  for (const ref of [`${g.remote}/${g.base}`, g.base]) {
    if ((await git(folder, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).code === 0) return ref;
  }
  throw new Error(`No base branch ${g.remote}/${g.base} or ${g.base} in this checkout`);
}

const exists = async (path) => (await exec("test", ["-e", path])).code === 0;

/** Creates the worktree. Returns { folder, branch }. Appends -2, -3… when the branch or path is taken. */
export async function createWorktree(project, slugText, log) {
  const folder = projectFolder(project);
  const { worktree: w, git: g } = project;
  await inspect(folder);
  await fetchRemote(folder, g, log);
  const base = await baseRef(folder, g);
  const vars = await templateVars(project, slugText);
  const wanted = branchName(w.branchTemplate, vars);
  if (!wanted) throw new Error("The branch name template produced an empty name");
  if ((await git(folder, ["check-ref-format", "--branch", wanted])).code !== 0) throw new Error(`"${wanted}" is not a valid branch name`);
  let branch = wanted;
  let path;
  for (let n = 1; ; n++) {
    branch = n === 1 ? wanted : `${wanted}-${n}`;
    path = expandHome(expand(w.root, { ...vars, branch }), home());
    const taken = (await git(folder, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0 || (await exists(path));
    if (!taken) break;
    if (n > 20) throw new Error(`Branch ${wanted} and its -N variants are all taken`);
  }
  log(`git worktree add ${branch} from ${base}…`);
  const r = await git(folder, ["worktree", "add", "--no-track", "-b", branch, path, base]);
  if (r.code !== 0) throw new Error(out({ stdout: r.stderr }) || "git worktree add failed");
  return { folder: path, branch };
}

/** The main checkout, brought up to date when fast-forward is on and that's safe. */
export async function prepareMain(project, log) {
  const folder = projectFolder(project);
  const { branch } = await inspect(folder);
  const g = project.git;
  await fetchRemote(folder, g, log);
  if (!g.fastForward) return;
  if (branch !== g.base) return log(`not fast-forwarding: on ${branch}, not ${g.base}`);
  if (out(await git(folder, ["status", "--porcelain"]))) return log("not fast-forwarding: uncommitted changes");
  const r = await git(folder, ["merge", "--ff-only", `${g.remote}/${g.base}`]);
  log(r.code === 0 ? `fast-forwarded ${g.base}` : "not fast-forwarding: local commits");
}

/** Setup commands, one after another, stopping at the first failure. exec has a 30 s limit each. */
export async function runSetup(project, folder, log) {
  for (const cmd of project.startup.setup) {
    log(`$ ${cmd}`);
    try {
      const r = await exec("sh", ["-c", cmd], { cwd: folder });
      if (r.code !== 0) return log(`setup failed (${r.code}): ${cmd}`);
    } catch {
      return log(`setup stopped (timed out or couldn't start): ${cmd}`);
    }
  }
}

export const findSpace = (project) => spaces().find((s) => !s.machine && s.folder === projectFolder(project));

/** Opens the folder as a space, with the project's agent, first prompt and extra tabs. */
export function launch(project, folder, name) {
  const { agent, args, prompt, tabs } = project.startup;
  const argv = agent.trim() ? [...splitArgs(agent), ...splitArgs(args)] : [];
  log("debug", "launch", { folder, name, argv, tabs });
  run("space.new", { name, folder, ...(argv.length ? { argv, ...(prompt ? { task: prompt } : {}) } : {}) });
  const space = focused()?.space;
  for (const cmd of tabs) run("tab.new", { space, name: cmd.split(/\s+/)[0], folder, argv: ["sh", "-c", cmd] });
}
