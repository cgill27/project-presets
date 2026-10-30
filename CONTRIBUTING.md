# Contributing to project-presets

Thanks for helping out. This is a small [Herdr](https://herdr.dev) app mod, so contributing is lightweight: fork, change, test, open a pull request.

## Ways to contribute

- **Report a bug.** Open an issue with what you did, what you expected, and what happened. Include your Herdr version (`herdr-app --version`) and the relevant lines from `~/.config/herdr-app/data/project-presets.log`. Turn on debug logging first (see [Troubleshooting](README.md#troubleshooting)), reproduce the problem, and remove secrets and private paths before pasting.
- **Suggest a feature.** Open an issue describing the problem you want solved before writing code, so we can agree on the approach.
- **Send a fix or feature** as a pull request (below).
- **Improve the docs.** `README.md` and `RECIPE.md` are welcome targets.

## Getting set up

1. Fork the repository on GitHub, then clone your fork:

   ```sh
   git clone git@github.com:<your-username>/herdr-space-projects.git
   cd herdr-space-projects
   git remote add upstream git@github.com:cgill27/herdr-space-projects.git
   ```

2. Copy the type definitions Herdr generates into the mod folder (they are git-ignored):

   ```sh
   cp ~/.config/herdr-app/gpui-kit.d.ts ~/.config/herdr-app/herdr.d.ts mods/project-presets/
   ```

3. Link the mod into your Herdr home so edits reload live, and bind the key (see `keys.json`):

   ```sh
   ln -s "$PWD/mods/project-presets" ~/.config/herdr-app/mods/project-presets
   ```

Use a throwaway git repo as your test project so you don't create worktrees in real work.

## Making a change

1. Sync and branch from `main`:

   ```sh
   git fetch upstream
   git switch -c my-change upstream/main
   ```

2. Make your change. Keep each pull request to one fix or feature.
3. Run the checks:

   ```sh
   node --test test/                    # pure helpers in lib.js
   herdr-app check mods/project-presets # loads and renders the mod once
   ```

   Both must pass. `herdr-app check` doesn't run click handlers or later states, so also try your change in the running app. With debug logging on, the log shows every key, click and git command.
4. Add a test in `test/` when you change `lib.js`. Logic that needs `herdr` (`git.js`, `main.js`) can't run under plain node, so describe how you tried it in the pull request.
5. If behaviour changes, update `RECIPE.md` (and `README.md` if it is user-facing), including the "Done when" checks.

## Code conventions

- Match the style of the surrounding code: 2-space indent, double quotes, semicolons, ES modules.
- Keep pure logic (templates, matching, parsing) in `lib.js` so it can be tested. Keep `herdr` calls in `git.js`, `config.js` and `main.js`.
- Mods run in Herdr's own JavaScript runtime, not Node or a browser: there is no `setTimeout` or `structuredClone`. Check `~/.config/herdr-app/AGENTS.md` and the `.d.ts` files before reaching for a built-in.
- `render()` receives no `cx`; keep the one from `init`.
- Wrap handlers with `this.guard(...)` and report failures with `logError` so they show up in the popup and the log instead of vanishing.
- Anything that runs programs or reads outside the mod folder must stay obvious in the code and be listed under "Built from" and "Watch out" in `RECIPE.md`.
- Never run `git worktree remove --force` or otherwise discard a user's uncommitted work.

## Commits and pull requests

- Write commit messages in the imperative, with a short subject (about 50 characters) and a body saying why when it isn't obvious: "Fix prompt going to the wrong terminal".
- Push your branch to your fork and open a pull request against `main`.
- In the description, say what changed and why, how you tested it, and include a screenshot (`herdr-app shot`) for any UI change.
- Link the issue it fixes (`Fixes #12`).
- Be ready to adjust after review. Push follow-up commits to the same branch; they update the pull request. Rebase on `upstream/main` if it falls behind.

## Reporting security problems

Setup commands and extra tabs run shell commands from the project config, which is by design. If you find a way to run code without the user's configuration, or to damage a repository unexpectedly, please report it privately through GitHub's "Report a vulnerability" on the Security tab rather than a public issue.

## Conduct

Be kind and assume good faith. Harassment and personal attacks aren't tolerated; maintainers may remove comments or contributions that cross that line.

## License

By contributing you agree your contribution is licensed under the repository's [LICENSE](LICENSE).
