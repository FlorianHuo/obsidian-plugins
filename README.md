# Obsidian Plugins

A monorepo for managing and developing my Obsidian plugins.

## Structure

Each plugin lives in its own subdirectory:

```
obsidian-plugins/
  plugin-name/
    main.ts
    manifest.json
    styles.css
    ...
```

## Development

### Prerequisites

- Node.js (v18+)
- npm or pnpm

### Getting Started

```bash
# Navigate to a plugin directory
cd plugin-name

# Install dependencies
npm install

# Build the plugin
npm run build

# Watch for changes during development
npm run dev
```

## Plugins

| Plugin | Description | Status |
|--------|-------------|--------|
| [task-flow](./task-flow/) | Add task status shortcuts plus editor task sorting for Things-style workflows | v0.1.0 |
| [workspace-switcher](./workspace-switcher/) | Manage workspaces: built-in TODO/Focus layouts, save/load/delete custom workspaces, auto-update daily notes in Beijing time | v1.1.0 |

## Changelog

### task-flow

#### Unreleased

- Fix `Mod+L` / done-sorting behavior when Obsidian runs `task-flow` through the inline task-sort fallback
- Starting a child task now marks each ancestor task as in progress before sorting the affected branches
- Completing a parent task now marks all descendant tasks as done before sorting the branch
- Add a repeatable `01-tracks/current.md` refresh action with the existing header icon and default `Alt+C` command: cache completed items to `01-tracks/cache/YYYY-MM-DD.md`, keep completed `日常` items out of `current.md` for the rest of the day, and prune completed `[x]` items out of `主线 / 支线`
- Add `Preview current day settlement`, a read-only command that lists completed top-level `主线` items from today's cache without modifying `shop.md`
- Add `Settle current day`, a manual command that records completed top-level `主线` items in `04-governance/shop.md` and updates the shop balance
- `Mod+L` now inserts a new unchecked task on blank lines, and on an empty unchecked task line it clears the line back to blank
- `Mod+/` now places a newly in-progress task below existing `[/]` siblings and above unchecked `[ ]` siblings instead of forcing it to the very top
- `Mod+L` moves a newly completed task to the top of the current completed group, preserving the relative order of older `[x]` siblings
- Native checkbox toggles now follow the same completed-group ordering rules as `Mod+L`, including nested sublists
- Sorting a partial nested task region now preserves the trailing newline, so the next task no longer gets merged into the previous line
- Native checkbox auto-sorting now runs as a follow-up edit instead of a same-transaction rewrite, which avoids Live Preview conflict markers

#### v0.1.0 (2026-04-10)

- Add `Set task status to in progress ([/])` for the active line or current multi-line selection
- Add default hotkey `Mod+/`
- Add `Set task status to done ([x])` with default hotkey `Mod+L`
- Auto-sort native checkbox toggles and `Set task status to done ([x])` so completed tasks move to the bottom of the current branch
- Auto-sort `Set task status to in progress ([/])` so the current task moves to the top of the current branch
- Add `Sort tasks in current file`
- Convert existing task items, list items, plain text, and blank lines into Things-compatible `[/]` task syntax
- Press the same shortcut again on `[/]` or `[x]` items to turn them back into unchecked tasks `[ ]`

### workspace-switcher

#### Unreleased

- Daily journal path updates use `Asia/Shanghai` instead of the computer's local timezone
- While Obsidian stays open, the plugin checks for a new Beijing day every minute and refreshes stale daily workspace journal paths automatically
- Daily note folder and optional saved-layout path rewrites are configurable in plugin settings; local vault migrations no longer require hard-coded paths in source
- Remove the legacy daily content reset code; `workspace-switcher` now only owns workspace and journal-layout behavior
- Single-tab panes now hide the tab strip without breaking drag-to-split, and the hidden header no longer leaks controls into the view header

#### v1.1.0 (2026-03-27)

- **Save/Load/Delete custom workspaces** with fuzzy-search picker and full layout persistence (including sidebars)
- **Auto-update daily notes on startup**: detects stale `journal/YYYY-MM-DD.md` paths and replaces with today's date
- **Auto-update daily notes on workspace load**: same detection when loading a saved workspace
- **Hide single-tab headers**: CSS removes tab bar when a pane has only one tab
- Fix: journal path in `ensureFile()` no longer uses TODO template for daily notes

#### v1.0.0

- Initial release: TODO workspace (3 tracks + daily note) and Focus workspace (single panel)
