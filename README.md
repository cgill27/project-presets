# project-presets

A [Herdr](https://herdr.dev) app mod: a project picker where each project is a local git checkout with its own settings. Press `ctrl-alt-p`, fuzzy-search, Enter. Per project you choose whether to open the checkout or a fresh worktree (always, ask for a branch name, or never), the branch-name template, whether to fetch first, which agent to start with which arguments and first prompt, setup commands and extra tabs.

![Project presets](preview.png)

## Install

Copy `mods/project-presets/` to `~/.config/herdr-app/mods/` and merge `keys.json` into `~/.config/herdr-app/keys.json`. Or ask your agent to install it from this repo; `RECIPE.md` describes the whole mod.

Projects live in `~/.config/herdr-app/data/project-presets.json`; add them with the Add project button.

## Troubleshooting

Errors are logged to `~/.config/herdr-app/data/project-presets.log`. Create `~/.config/herdr-app/data/project-presets.debug` to also log keys, clicks and git commands.

## Development

`node --test test/` runs the pure-helper tests; `herdr-app check mods/project-presets` checks the mod. The `.d.ts` files in the mod folder are copied from `~/.config/herdr-app/` and not committed.

Setup commands and extra tabs run shell commands from your config, so read a shared config before using it.
