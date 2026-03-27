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
| [workspace-switcher](./workspace-switcher/) | Manage workspaces: built-in TODO/Focus layouts, save/load/delete custom workspaces, auto-update daily notes | v1.1.0 |

## Changelog

### workspace-switcher

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

