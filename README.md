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
| [task-status-shortcuts](./task-status-shortcuts/) | Add task status shortcuts plus editor task sorting for Things-style workflows | v0.1.0 |
| [workspace-switcher](./workspace-switcher/) | Manage workspaces: built-in TODO/Focus layouts, save/load/delete custom workspaces, auto-update daily notes in Beijing time | v1.1.0 |

## Changelog

### task-status-shortcuts

#### Unreleased

- `Mod+L` now inserts a new unchecked task on blank lines, and on an empty unchecked task line it clears the line back to blank
- `Mod+/` now places a newly in-progress task below existing `[/]` siblings and above unchecked `[ ]` siblings instead of forcing it to the very top
- `Mod+L` keeps existing `[x]` siblings ahead of the newly completed task, so new done items append to the current completed group

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

- Daily note paths and daily resets now use `Asia/Shanghai` instead of the computer's local timezone
- While Obsidian stays open, the plugin checks for a new Beijing day every minute and refreshes the daily workspace state automatically
- Editor task sorting moved out to `task-status-shortcuts`, so this plugin only owns workspace and daily-layout behavior
- Single-tab panes now hide the tab strip without breaking drag-to-split, and the hidden header no longer leaks controls into the view header

#### v1.1.0 (2026-03-27)

- **Save/Load/Delete custom workspaces** with fuzzy-search picker and full layout persistence (including sidebars)
- **Auto-update daily notes on startup**: detects stale `journal/YYYY-MM-DD.md` paths and replaces with today's date
- **Auto-update daily notes on workspace load**: same detection when loading a saved workspace
- **Daily track auto-reset**: `tracks/daily.md` is archived and reset from template on new day
- **Hide single-tab headers**: CSS removes tab bar when a pane has only one tab
- Fix: daily track template reference (was pointing to non-existent file)
- Fix: journal path in `ensureFile()` no longer uses TODO template for daily notes

#### v1.0.0

- Initial release: TODO workspace (3 tracks + daily note) and Focus workspace (single panel)
