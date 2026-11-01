# project-presets

A [Herdr](https://herdr.dev) app mod: a project picker where each project is a local git checkout with its own settings. Press `ctrl-alt-p` (`cmd-alt-p`, ⌘⌥P, on macOS; `cmd-p` is already herdr's own space picker there), fuzzy-search, Enter. Per project you choose whether to open the checkout or a fresh worktree (always, ask for a branch name, or never), the branch-name template, whether to fetch first, which agent to start with which arguments and first prompt, setup commands and extra tabs.

![A tour of project-presets: pick a project, name the branch, and get a new worktree with the agent running](docs/tour.gif)

## Screens

Every view of the popup. The projects shown are demo data.

### Project list

Type to filter; the match is fuzzy and covers the name, the group and the folder name. Open spaces come first, then pinned projects (★), then recent ones. Each row ends with what Enter will do: `worktree` (always a new one), `worktree?` (asks for a branch name) or `checkout` (opens the folder itself). Scroll with the wheel or the arrow keys.

![Project list](docs/screenshots/01-project-list.png)

| Search by name (`apgw`) | Search by group (`pers`) |
|---|---|
| ![Search by name](docs/screenshots/02-search-name.png) | ![Search by group](docs/screenshots/03-search-group.png) |

### Removing a project

Delete asks once, then removes the project from the list. Its folder and worktrees stay.

![Delete confirmation](docs/screenshots/04-delete-confirm.png)

### Opening a project

A project in `ask` mode asks for a name and shows the branch it will create before you press Enter. While it works the popup lists each step, then closes.

| Branch name | Starting |
|---|---|
| ![Branch name](docs/screenshots/05-branch-name.png) | ![Starting](docs/screenshots/06-starting.png) |

When it finishes you land in a new space on the new worktree, with the agent already running and your prompt sent. The space is named after the project and branch, and the sidebar nests it under the repository.

![The result: a new space on cgill27/2026-10-30-add-search-page with Claude Code running and the first prompt answered](docs/screenshots/15-result.png)

### Sections and the detail card

The list is split into **Open now**, **Pinned** and **Everything else** (no headers while you search, or when only one group has projects). Each row starts with an avatar drawn like herdr's sidebar draws a space: a tile in the space's own color with the project's initial (an outline for a project with no open space). Then come the agent icon and, when git details are on, its branch, a `N changed` chip when files are modified, and `N wt` for linked worktrees. The git details run git in every project each time the picker opens; turn them off with `"gitInfo": false` next to `projects` in `~/.config/herdr-app/data/project-presets.json` (the card then also drops its Branch, Changes and Worktrees rows). An open space gets a status stripe on the left edge, and the marker pulses while its agent is working. Typing highlights the letters that matched, and the search box counts matches (`3 of 12`).

**The toolbar** under the search box holds the buttons: Add project, then Duplicate, Worktrees, Edit and Delete for the highlighted project (it says "acts on <name>"), and at the right Import / export… and Show/Hide details. Each has a key, listed in the line at the bottom.

**The detail card** sits beside the list: agent, branch, changes, worktrees, when you last opened the project, and the layout choices as small pictures of their panes (click one, or press **ctrl+alt+L**). It says what Enter will do ("Enter asks for a branch name and opens agent + terminal below") and holds the Open, Checkout, Worktrees, Edit and Delete buttons. Hide it with **ctrl+alt+I** (**⌘⌥I** on macOS) or the Hide details button, if it is too large or not wanted; the choice is remembered. Without it the layout choice sits under the list as text chips and the buttons sit under the list. The popup is 1060 px wide; narrow `overlay.width` in `mod.json` if you never use the card.

**If the picker is slow or the app's CPU jumps when you open it, update herdr-core.** Older versions of herdr-core burned a full CPU core while this popup (and any popup like it) was open; the herdr-core release notes mention the fix. If you can't update, hide the card and set `"gitInfo": false`.

| The card, with a layout picked for this launch | The card hidden |
|---|---|
| ![The detail card with a layout picked for this launch](docs/screenshots/18-layout-picked.png) | ![The list with the detail card hidden](docs/screenshots/17-details-hidden.png) |

### Pane layouts

A project can open its space with more than the agent: a terminal below it, a file manager beside it, a log tail. Name a layout in the project's **Startup → Pane layout** field, or press **ctrl+alt+L** (**⌘⌥L** on macOS) in the list or the branch-name step to pick one for this launch: it steps through none (the agent alone) and then every layout. A selector under the projects shows them all with the one this launch will use lit, and it briefly turns bold with an accent ring after each change.

Two layouts ship: `agent-terminal` (a shell below the agent) and `agent-side-terminal` (a shell to its right). Add your own, or replace one of those, with a `layouts` list in `~/.config/herdr-app/data/project-presets.json`, next to `projects`:

```json
{
  "layouts": [
    {
      "name": "coding",
      "label": "Agent, files and a terminal",
      "panes": [
        { "type": "agent" },
        { "name": "files", "type": "command", "command": "yazi .", "direction": "right" },
        { "name": "term", "type": "shell", "direction": "down", "from": "agent" }
      ]
    }
  ],
  "projects": []
}
```

The first pane is always the agent. Every other pane needs a `direction` (`right` or `down`) and splits the previous pane, or the pane named in `from`. `type` is `shell` (your shell), `command` (runs `command`) or `agent`. All panes start in the project's folder, or the new worktree. Herdr splits evenly; sizes can't be set. A bad layout is reported before anything is created, and if a split fails the space still opens with the panes made so far. Saving a project from the editor keeps your `layouts`.

### Keeping the sidebar tidy

Herdr nests a worktree's space under its repository's own space, but only while the repo's space is open. Two settings in a project's **Worktree** section control how that looks:

- **Open the repo's space first:** when you open a worktree and the project's main checkout isn't open as a space, the mod opens it first (a plain shell, no agent). The new worktree space then nests under it, so each project is one row with its worktrees beneath it. Off by default.
- **Space name:** a template for the worktree space's name. The default `{name} · {branch}` gives `Docs Site · cgill27/2026-10-30-add-search-page`; once nested, `{slug}` (just `add-search-page`) or `{branch}` is shorter and easier to read. You can use `{name}`, `{branch}`, `{slug}`, `{user}`, `{date}` and `{repo}`.

![A worktree space nested under its repo's space, named by its slug](docs/screenshots/16-nested-worktree.png)

### Adding and editing a project

Settings are split into four sections.

| Project | Worktree |
|---|---|
| ![Editor, project](docs/screenshots/07-editor-project.png) | ![Editor, worktree](docs/screenshots/08-editor-worktree.png) |
| **Git** | **Startup** |
| ![Editor, git](docs/screenshots/09-editor-git.png) | ![Editor, startup](docs/screenshots/10-editor-startup.png) |

**Add project** opens the same editor with empty fields; Browse… picks the folder.

![Add project](docs/screenshots/11-add-project.png)

### The template, and duplicating a project

The last row of the list is a **Template**: a project with no folder and some starting settings (Claude Code, the agent + terminal-below layout, ask for a branch name). It is a starting point, not something you open.

- **Make your defaults once.** Select the Template and press **alt+e** (**⌘E**), set the agent, layout, worktree and git settings you want your projects to share, and save. A saved template has no folder, so saving never asks for one.
- **Make a project from it.** Select the Template and press **Enter** (or click Use template). The editor opens on a new project with the template's settings; give it a name and a folder (Browse…) and save. The Template stays for the next one. Once you have saved the template, **Add project** (**alt+n**) starts from its settings too.
- **Duplicate any project** with **alt+u** (**⌘U**) or the Duplicate button. The editor opens on a copy named `<name> copy` (then `copy 2`, …) with the same folder and settings, not pinned; change what differs and save. It is the quick way to open one repository with another agent, layout or worktree mode.
- **Remove the template** with Delete if you don't want the row; it stays gone. To bring it back, delete `"hideTemplate"` from `~/.config/herdr-app/data/project-presets.json`.

### Importing and exporting your config

**Import / export…** (**alt+x**, **⌘X**) opens a screen with a file box (default `~/Downloads/project-presets-config-<date>-<time>.json`, so each export gets its own file; Browse… picks the folder) and three buttons:

- **Export** writes your whole project list, your layouts and your settings to that file. Paths under your home folder are saved as `~`, so the exported file works on a machine with a different user name. If the file already exists, Export asks you to click again before it replaces it.
- **Import: merge** adds the projects in the file that you don't have (same name and folder) and any layouts with new names. Yours are never changed or removed.
- **Import: replace** makes your list exactly the exported file. It asks you to click again, and first saves your current file as `project-presets.json.bak` next to it.

After an import the screen lists any project whose folder doesn't exist on this machine; go back (**alt+b**) and press **alt+e** on it to point it at the right folder. To move to a new machine: Export on the old one, copy the file across, Import on the new one (merge is enough if it's empty).

### Cleaning up worktrees

Worktrees lists a project's linked worktrees with whether each is merged into the base branch, has uncommitted changes, or is open in a space. Tick the ones to remove, or Tick merged for every merged, clean one. Removing asks once more. Worktrees with uncommitted changes are never removed, and a branch is deleted only when it is merged.

| List | Merged ticked | Confirm |
|---|---|---|
| ![Worktrees](docs/screenshots/12-worktrees.png) | ![Ticked](docs/screenshots/13-worktrees-ticked.png) | ![Confirm](docs/screenshots/14-worktrees-confirm.png) |

## Install

Copy `mods/project-presets/` to `~/.config/herdr-app/mods/` and merge `keys.json` into `~/.config/herdr-app/keys.json`. It binds `ctrl-alt-p` for Linux and Windows and `cmd-alt-p` for macOS (`cmd-p` is herdr's built-in space picker); change either to any key you like, since the key lives in your own `keys.json`, not in the mod. Inside the picker the shortcuts (add, edit, worktrees, delete) take alt, ctrl or cmd, and every one has a button too. Or ask your agent to install it from this repo; `RECIPE.md` describes the whole mod.

Projects live in `~/.config/herdr-app/data/project-presets.json`; add them with the Add project button.

## Updating

Herdr doesn't update community mods for you, so how you update depends on how you installed. Your projects live in `~/.config/herdr-app/data/project-presets.json`, outside the mod folder, so an update never touches them.

**Installed as a symlink to a clone (easiest).** Install it this way once:

```sh
git clone https://github.com/cgill27/project-presets.git ~/code/project-presets
ln -s ~/code/project-presets/mods/project-presets ~/.config/herdr-app/mods/project-presets
```

Then update with a pull. Herdr reloads a mod as soon as its files change, so there is nothing to restart:

```sh
git -C ~/code/project-presets pull --ff-only
```

**Installed by copying the folder.** Get the new version (a clone you have pulled, or the zip from the [latest release](https://github.com/cgill27/project-presets/releases/latest)) and replace the installed folder, keeping the `.d.ts` files herdr generates there:

```sh
rsync -a --delete --exclude='*.d.ts' ~/code/project-presets/mods/project-presets/ ~/.config/herdr-app/mods/project-presets/
```

**Check the release notes.** The key bindings in `keys.json` are merged into your own `~/.config/herdr-app/keys.json`, so an update never changes them. When a release changes a key, the notes say so; edit your file by hand.

## Troubleshooting

Only errors are logged by default. Debug logging is **off** unless you turn it on.

**Esc closes the whole popup instead of going back.** Herdr closes a popup on Esc itself and never passes the key to the mod, so the picker can't use it to go back. Use **alt+b** (**⌘B**) to go back one screen (from the editor, Worktrees, Import / export…), or click Back / Cancel. Esc still closes the picker.

**The shortcut does nothing right after launching herdr-app with no space open.** The window has no pane to hold the keyboard yet, so herdr doesn't see the key. Click once in the window (the "No space open." area), then press the shortcut; once you've had a space open it keeps working. This is herdr-app, not the mod: the shortcut is handled by herdr before the mod runs. Running `herdr-app do mod.open '{"name":"project-presets"}'` from a terminal is another way to open the picker.

**The picker is slow to open, keys lag, or `herdr-app` uses a lot of CPU while it is open, and you may see "This view could not be re-rendered … interrupted".** This is an old herdr-core bug, not the mod: with an older core, `herdr-app` used a full CPU core whenever a popup like this one was open, and herdr cut slow draws off. It is fixed in a later herdr-core (see its release notes). Update it (`hc update`, or your package manager if herdr was installed with one) and restart herdr-app. On herdr-core `hc 0.1.16` with `herdr-app 0.1.11` the picker used about 10% CPU while open, against about 99% before the update. If you cannot update, hide the detail card (ctrl+alt+I, ⌘⌥I on macOS) and set `"gitInfo": false` next to `projects` in `project-presets.json`.

**Where the log is:** `~/.config/herdr-app/data/project-presets.log` (the last 64 KB are kept). Errors also appear in the popup.

**Turn debug logging on** to capture a problem:

1. Create the flag file:

   ```sh
   touch ~/.config/herdr-app/data/project-presets.debug
   ```

2. Close and reopen the picker (`ctrl-alt-p`). The flag is read each time the picker opens, so no restart is needed.
3. Reproduce the problem. With debug on, the log records every key, click, git command (with exit code and the first line of any error), and the steps of sending a prompt to an agent.
4. Attach the relevant lines of the log to your issue. Remove private paths or names you don't want to share first.

**Turn it off again:**

```sh
rm ~/.config/herdr-app/data/project-presets.debug
```

To start a fresh log before reproducing, empty it with `: > ~/.config/herdr-app/data/project-presets.log`.

## Development

`node --test test/` runs the tests (helpers, git, config, log and the picker's view, against real temporary git repos and stand-ins for `herdr` and gpui; how things look still needs a check by eye); `herdr-app check mods/project-presets` checks the mod. The `.d.ts` files in the mod folder are copied from `~/.config/herdr-app/` and not committed.

See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute.

Setup commands and extra tabs run shell commands from your config, so read a shared config before using it.
