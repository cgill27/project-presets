# project-presets

A [Herdr](https://herdr.dev) app mod: a project picker where each project is a local git checkout with its own settings. Press `ctrl-alt-p`, fuzzy-search, Enter. Per project you choose whether to open the checkout or a fresh worktree (always, ask for a branch name, or never), the branch-name template, whether to fetch first, which agent to start with which arguments and first prompt, setup commands and extra tabs.

![Project presets](preview.png)

## Install

Copy `mods/project-presets/` to `~/.config/herdr-app/mods/` and merge `keys.json` into `~/.config/herdr-app/keys.json`. Or ask your agent to install it from this repo; `RECIPE.md` describes the whole mod.

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
