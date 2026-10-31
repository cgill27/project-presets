// Documentation screenshots: `~/.config/herdr-app/data/project-presets.demo` (JSON) opens the picker
// already in a given view, so each screen can be captured the same way every time. Absent by default.
//   { "view": "list|edit|delete|name|worktrees|busy", "project": "api-gateway", "query": "apgw",
//     "focus": "agent", "text": "fix login", "tick": true, "confirm": true, "notes": ["…"] }
import * as fs from "fs/promises";
import { appHome } from "herdr";

export async function readDemo() {
  const path = `${appHome()}/data/project-presets.demo`;
  try {
    if (!(await fs.exists(path))) return null;
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch { return null; }
}
