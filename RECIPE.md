# Project presets

A project picker for the Herdr app. You keep a list of local git checkouts, each with its own settings: whether selecting it opens the checkout or a fresh worktree, how the branch is named, what git does first, and what starts in the new space. `ctrl-alt-p` (`cmd-alt-p` on macOS) opens a fuzzy-searchable list; Enter does what that project is set up to do.

![Project presets](preview.png)

## What you see

A popup, 680px wide, top-aligned 40px down, up to 80% of the window high, on the theme's `popover` background.

- Title "Projects" with "Esc" on the right.
- A 36px search box with an `accent` border.
- One 48px row per project (a scrolling list with a scrollbar; the wheel and the arrow keys scroll): a marker (`●` in the agent-status color when the project's folder already has a space, `★` when pinned, else `·`), the name, the folder shortened with `~`, the group at the right, then `checkout`, `worktree?` or `worktree` for the project's mode.
- A footer: a line of the key hints, then buttons at the right: Worktrees, Edit, Delete (each only when a project is listed) and Add project.

Ordering with an empty search: projects with an open space, pinned ones, recently used, then by name. With a query: best fuzzy match first (subsequence match on name, group and folder name; consecutive and word-start letters score higher).

The editor replaces the list in the same popup, in four sections chosen by buttons under the title. **Project:** Name, Folder (+ Browse…), Group, Pin to top. **Worktree:** the mode button (ask / always / never), Branch name, Worktree folder, Space name, and an "Open the repo's space first" toggle. **Git:** Fetch first, Fast-forward checkout, Remote, Base branch. **Startup:** an Agent button per installed agent from `knownAgents()` plus Shell, Agent command, Agent arguments, First prompt with a Prompt delivery button, Setup commands, Extra tabs. Buttons: Delete (asks for a second click), Cancel, Save. Tab moves between the fields of the current section.

## How it behaves

- A single click highlights a row; a double-click (two clicks on the same row within 450 ms) or **Enter** opens it, following the project's mode:
  - `never`: focus the project's space if its folder already has one, otherwise fetch (if on), fast-forward (if on and safe), run setup, open a space on the checkout.
  - `always`: create a worktree and open a space on it. The `{slug}` part is the time (HHMMSS).
  - `ask`: a name step appears with a live preview of the resulting branch; Enter creates it. Empty name uses the time.
- **Shift+Enter** always means the main checkout, whatever the mode (same steps as `never`).
- With alt, ctrl or cmd held (⌘ on macOS): **w** (or the Worktrees button) opens worktree cleanup, **d** (or Delete) removes the project from the list after a second press, **n** (or Add project) adds a project, **e** (or Edit) edits the highlighted one, **s** saves, **Tab** moves between fields, **Esc** goes back one step, then closes.
- While working, the popup lists progress lines (`git fetch origin…`, `git worktree add …`, `$ <setup command>`) and Esc does nothing; for a "typed after start" prompt it stays open, with a "Waiting for the agent…" line, until the prompt is sent, then closes. An error stays on screen until Esc.
- Worktree creation: `git fetch <remote>` (a failure is logged and the local ref is used), then `git worktree add --no-track -b <branch> <folder> <remote>/<base>`. A taken branch or folder gets `-2`, `-3`… up to `-20`.
- Fast-forward only happens on the checkout when it is on the base branch, clean, and can fast-forward.
- **Worktree cleanup** has a filter box (fuzzy, on branch and folder name) over a scrolling list of the repo's linked worktrees (`git worktree list --porcelain`, main checkout excluded) with the branch, folder, and badges: `open` (a space shows it), `uncommitted`, `locked`, `merged` (branch is an ancestor of `<remote>/<base>`) or `unmerged`. Enter or a click ticks the highlighted row; m (or Tick merged) ticks every merged, clean, unlocked one, and again unticks them; r (or the Remove button, labelled with the count) asks for confirmation and the second press removes the ticked ones with `git worktree remove` (never `--force`, so dirty ones are refused and reported). A merged branch is then deleted with `git branch -d`; an unmerged one is kept. The space showing a removed worktree is closed with `space.close`.
- **Space name and repo space** (worktree modes only): the new worktree's space is named from `worktree.spaceName` (variables `{name}` the project's display name, `{branch}`, `{slug}`, `{user}`, `{date}`, `{repo}`; an empty result falls back to `<name> · <branch>`). When `worktree.repoSpace` is on and no space shows the project's main checkout, a plain-shell space named after the project is opened on it first, then the worktree space, which herdr nests under it. If the repo's space is already open nothing extra is created.
- **Delete** (the button or **d**) shows "Remove \"<name>\" from the list?" in red; pressing d or clicking Delete again removes the project from `project-presets.json`, any other key cancels. The folder and its worktrees are left alone. The editor's Delete button has its own two-click confirmation.
- Selecting a project records it in shared state `project-presets.recent` for ordering.

## Built from

- `mods/project-presets/`: `main.js` (the View: list, name step, busy, editor and worktree modes), `git.js` (every git call, worktree creation and removal, launching), `config.js`, `lib.js` (pure helpers, tested with node), `log.js` (error and debug log), `demo.js` (optional screenshot hook), `mod.json` (`place: "none"`, popup overlay 680 x 0.8, `at: "top"`, `offset: 40`).
- `keys.json`: `"global": { "ctrl-alt-p": "mod.open:project-presets", "cmd-alt-p": "mod.open:project-presets" }` (ctrl-alt-p for Linux and Windows, cmd-alt-p for macOS; cmd-p is herdr's built-in space picker there, so it is not used), merged into the person's file. Ask before replacing a key they already use; `cmd-alt-p` is already the macOS default, so a clash there means choosing another key.
- Config file `~/.config/herdr-app/data/project-presets.json` (hand-editable, written with `writeTextFile` and its expected previous text):

```json
{ "projects": [{
  "name": "API", "path": "~/code/api", "group": "work", "pinned": true,
  "worktree": { "mode": "ask|always|never", "branchTemplate": "{user}/{date}-{slug}",
                "root": "~/.herdr/worktrees/{repo}/{branch}",
                "spaceName": "{name} · {branch}", "repoSpace": false },
  "git": { "fetch": true, "remote": "origin", "base": "main", "fastForward": false },
  "startup": { "agent": "claude", "args": "--model opus", "prompt": "", "promptMode": "arg|send",
               "setup": ["npm ci"], "tabs": ["lazygit"] }
}] }
```

- Template variables: `{user}` (slug of `git config user.name`, else the local part of `user.email`, else `user`), `{date}` (YYYY-MM-DD), `{slug}` (slug of the typed name, else HHMMSS), `{repo}` (checkout folder name), `{project}` (slug of the name), `{branch}` (folder template only).
- `herdr` functions: `knownAgents`, `window` (the platform, for ⌘ or alt hints), `exec`, `hc`, `run`, `focused`, `spaces`, `home`, `appHome`, `readTextFile`, `writeTextFile`, `pickFolder`, `props`, `theme`, `shared`, `setShared`, `closeOverlay`. `fs/promises` for the log and the demo file.
- Commands: `space.new {name, folder, argv, task}`, `space.select {id}`, `space.close {id}`, `tab.new {space, name, folder, argv}`. `hc ls --json`, `hc get <t> --json` and `hc send <t> <text>` for typed-after-start prompts.
- Programs run: `git`, `test`, `sleep`, `hc`, and `sh -c` for setup commands and extra tabs.
- Widgets from `gpui-base`: `InputState`, `Input`, `v_virtual_list`, `VirtualListScrollHandle` and `Scrollbar` (a handler can't be registered inside a virtual list's row renderer, so each list has one `on_item_click`; a double-click is two clicks timed by the mod).
- Colors: only theme names (`t.selected`, `t.dim`, …) or hex; a string like `"transparent"` is rejected and the whole view stops rendering.
- Logs: errors always go to `~/.config/herdr-app/data/project-presets.log`; `project-presets.debug` next to it turns on key, click and command logging. `project-presets.demo` (JSON) opens the picker in a given view for screenshots; see CONTRIBUTING.md.

## Watch out

- Setup commands and extra tabs run arbitrary shell from the config file. Tell the person before installing a shared config.
- `exec` stops after 30 seconds, so a slow `git fetch` or setup command is cut off; the picker logs it and carries on.
- A failed setup command stops the remaining ones but the space still opens.
- The first prompt goes to the agent as a command-line argument (`space.new {task}`) by default, which `hermes` and some other agents reject as an unknown subcommand. The Prompt button switches the project to "typed after start": the agent is started bare and the prompt is sent with `hc send` once `hc ls --json` shows it idle (6 s after start if it never reports a status, never while blocked). Picking the Hermes agent button sets this automatically.
- The agent command and its arguments are split into words, with '…' and "…" keeping spaces together; there's no other shell syntax. The first prompt is only sent when an agent is set.
- Herdr nests a worktree space under its repo's space only while a space on the main checkout is open (its sidebar groups by git common dir). With `repoSpace` off and no such space open, worktree spaces sit at the top level. Closing the repo's space later makes its worktrees top-level again.
- Extra tabs rely on the new space being the focused one right after `space.new`; the terminal for a typed prompt is found as the new live terminal that starts in the new folder, so two launches into one folder at once could confuse it.
- Local folders only: no `machine` field yet.
- Click handling and `cmd` shortcuts on macOS are untested: Herdr may use some cmd keys itself (e.g. cmd-n), so the buttons are the fallback.
- Typed-after-start needs `hc` on the PATH; an unknown agent counts as ready once something other than a shell has been in the foreground for 6 s.
- Shift+Enter relies on the search box passing Enter's key event through; plain Enter works either way.

## Done when

- `herdr-app check mods/project-presets` passes.
- `ctrl-alt-p` (or `cmd-alt-p` on macOS) opens the picker; typing `dmo` ranks a project named Demo first.
- Adding a project with Add project and Browse… writes it to `data/project-presets.json`; a folder that isn't a git checkout is refused with a message.
- With mode `ask`, typing "fix login" shows `<user>/<date>-fix-login` and Enter creates that worktree under the configured root, from `<remote>/<base>`, in a new space.
- Selecting the same project again with `always` gives `…-2`, not an error.
- Worktrees → m → r twice (with alt, ctrl or cmd held) removes merged, clean worktrees and their branches, closes their spaces, and refuses one with uncommitted changes.
- Delete asks once, then removes the project from the file.
- With "Open the repo's space first" on, opening a worktree for a project with no open space creates a space named after the project and, under it, the worktree space; with the worktree's Space name set to `{slug}` the nested row shows only the slug. Opening a second worktree creates no second repo space.
- With mode `never`, Enter focuses an already-open space instead of making another.
- With 15 or more projects the list scrolls with the wheel and a scrollbar, the arrow keys keep the highlight in view, a single click only highlights, and a double-click opens.
- The editor's four section buttons switch between Project, Worktree, Git and Startup; Save writes every section's fields.
- For a project set to "typed after start" with a prompt, the agent opens empty and the prompt is typed into it once ready (checked with hermes).
- The log at `data/project-presets.log` contains only errors until `project-presets.debug` exists.
