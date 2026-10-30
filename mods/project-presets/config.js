// The project list: ~/.config/herdr-app/data/projects.json, hand-editable.
import { readTextFile, writeTextFile, appHome } from "herdr";
import { normalize } from "./lib.js";

const file = () => `${appHome()}/data/project-presets.json`;

/** { projects, raw }: raw is the file as read, handed back to saveConfig so a
 *  hand edit made in between is refused instead of overwritten. */
export async function loadConfig() {
  const raw = await readTextFile(file());
  if (raw == null) return { projects: [], raw: null };
  try {
    const data = JSON.parse(raw);
    return { projects: (data.projects ?? []).map(normalize), raw };
  } catch (e) {
    throw new Error(`${file()} is not valid JSON: ${e.message}`);
  }
}

export async function saveConfig(projects, raw) {
  const text = JSON.stringify({ projects }, null, 2) + "\n";
  await writeTextFile(file(), text, raw);
  return text;
}
