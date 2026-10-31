# project-presets

A [Herdr](https://herdr.dev) app mod: a project picker where each project is a local git checkout with its own settings. Press `ctrl-alt-p` (`cmd-p` on macOS), fuzzy-search, Enter. Per project you choose whether to open the checkout or a fresh worktree (always, ask for a branch name, or never), the branch-name template, whether to fetch first, which agent to start with which arguments and first prompt, setup commands and extra tabs.

![Project presets](preview.png)

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

### Adding and editing a project

Settings are split into four sections.

| Project | Worktree |
|---|---|
| ![Editor, project](docs/screenshots/07-editor-project.png) | ![Editor, worktree](docs/screenshots/08-editor-worktree.png) |
| **Git** | **Startup** |
| ![Editor, git](docs/screenshots/09-editor-git.png) | ![Editor, startup](docs/screenshots/10-editor-startup.png) |

**Add project** opens the same editor with empty fields; Browse… picks the folder.

![Add project](docs/screenshots/11-add-project.png)

### Cleaning up worktrees

Worktrees lists a project's linked worktrees with whether each is merged into the base branch, has uncommitted changes, or is open in a space. Tick the ones to remove, or Tick merged for every merged, clean one. Removing asks once more. Worktrees with uncommitted changes are never removed, and a branch is deleted only when it is merged.

| List | Merged ticked | Confirm |
|---|---|---|
| ![Worktrees](docs/screenshots/12-worktrees.png) | ![Ticked](docs/screenshots/13-worktrees-ticked.png) | ![Confirm](docs/screenshots/14-worktrees-confirm.png) |

## Install

Copy `mods/project-presets/` to `~/.config/herdr-app/mods/` and merge `keys.json` into `~/.config/herdr-app/keys.json`. It binds `ctrl-alt-p` for Linux and Windows and `cmd-p` for macOS; change either to any key you like, since the key lives in your own `keys.json`, not in the mod. Inside the picker the shortcuts (add, edit, worktrees, delete) take alt, ctrl or cmd, and every one has a button too. Or ask your agent to install it from this repo; `RECIPE.md` describes the whole mod.

Projects live in `~/.config/herdr-app/data/project-presets.json`; add them with the Add project button.

## Troubleshooting

Only errors are logged by default. Debug logging is **off** unless you turn it on.

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

`node --test test/` runs the pure-helper tests; `herdr-app check mods/project-presets` checks the mod. The `.d.ts` files in the mod folder are copied from `~/.config/herdr-app/` and not committed.

See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute.

Setup commands and extra tabs run shell commands from your config, so read a shared config before using it.
