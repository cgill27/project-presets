import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const sh = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** A scratch directory that is not a repo. */
export const scratch = (name = "pp") => mkdtempSync(join(tmpdir(), `${name}-`));

/** A repo with one commit on main and a configured user. */
export function makeRepo({ name = "Test User", email = "test@example.com", dir = scratch("pp-repo") } = {}) {
  sh(dir, "init", "-q", "-b", "main");
  if (name) sh(dir, "config", "user.name", name);
  if (email) sh(dir, "config", "user.email", email);
  sh(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "a.txt"), "a\n");
  sh(dir, "add", ".");
  sh(dir, "commit", "-q", "-m", "first");
  return dir;
}

export function commit(dir, file = "b.txt", text = "b\n") {
  mkdirSync(join(dir, file, ".."), { recursive: true });
  writeFileSync(join(dir, file), text);
  sh(dir, "add", ".");
  sh(dir, "commit", "-q", "-m", `add ${file}`);
}

/** A bare "origin" plus a clone of it, so fetch and fast-forward have something to talk to. */
export function makeClone() {
  const upstream = makeRepo();
  const bare = scratch("pp-bare");
  execFileSync("git", ["clone", "-q", "--bare", upstream, bare]);
  const dir = scratch("pp-clone");
  execFileSync("git", ["clone", "-q", bare, dir]);
  sh(dir, "config", "user.name", "Test User");
  sh(dir, "config", "user.email", "test@example.com");
  sh(dir, "config", "commit.gpgsign", "false");
  return { dir, bare, upstream };
}
