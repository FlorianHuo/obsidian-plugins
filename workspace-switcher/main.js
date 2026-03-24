// Workspace Switcher Plugin for Obsidian
// Provides two commands:
//   1. "Switch to TODO workspace" - 3 tracks (urgent/important/trivial) on top + daily note on bottom
//   2. "Switch to Focus workspace" - single panel with the currently active file
//
// Key design: uses workspace.getLayout() to preserve sidebars,
// only modifies the "main" area of the layout.

const obsidian = require("obsidian");

class WorkspaceSwitcherPlugin extends obsidian.Plugin {
  async onload() {
    // Load persisted data (tracks last reset date)
    this.data = (await this.loadData()) || {};

    this.addCommand({
      id: "todo-workspace",
      name: "Switch to TODO workspace",
      callback: () => this.switchToTodoWorkspace(),
    });

    this.addCommand({
      id: "focus-workspace",
      name: "Switch to Focus workspace",
      callback: () => this.switchToFocusWorkspace(),
    });
  }

  // Build YYYY-MM-DD string in local timezone
  getTodayDateStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // Ensure a file exists; create it if missing
  async ensureFile(path) {
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      file = await this.app.vault.create(path, "");
    }
    return file;
  }

  // Get the current full layout, replace only the "main" part, then apply.
  // This preserves left sidebar, right sidebar, ribbon, etc.
  async applyMainLayout(newMain) {
    const currentLayout = this.app.workspace.getLayout();
    currentLayout.main = newMain;
    await this.app.workspace.changeLayout(currentLayout);
  }

  // Reset tracks/daily.md to the template if a new day has started.
  // Before resetting, archives the previous content to tracks/daily-log.md
  // so the user can track their habit completion history.
  async resetDailyTrackIfNeeded() {
    const today = this.getTodayDateStr();
    if (this.data.lastDailyReset === today) return;

    const templateFile =
      this.app.vault.getAbstractFileByPath("templates/daily.md");
    if (!templateFile) return;

    const dailyTrack =
      this.app.vault.getAbstractFileByPath("tracks/daily.md");

    // Archive the previous day's completion state before resetting
    if (dailyTrack) {
      const oldContent = await this.app.vault.read(dailyTrack);
      // Only archive if there is actual content
      if (oldContent.trim().length > 0) {
        const archiveDate = this.data.lastDailyReset || "unknown";
        const entry = `## ${archiveDate}\n${oldContent.trim()}\n\n`;
        const logPath = "tracks/daily-log.md";
        const logFile = this.app.vault.getAbstractFileByPath(logPath);
        if (logFile) {
          const existing = await this.app.vault.read(logFile);
          // Prepend new entry so most recent is at the top
          await this.app.vault.modify(logFile, entry + existing);
        } else {
          await this.app.vault.create(logPath, entry);
        }
      }
    }

    // Reset daily track to template
    const templateContent = await this.app.vault.read(templateFile);
    if (dailyTrack) {
      await this.app.vault.modify(dailyTrack, templateContent);
    } else {
      await this.app.vault.create("tracks/daily.md", templateContent);
    }

    this.data.lastDailyReset = today;
    await this.saveData(this.data);
  }

  async switchToTodoWorkspace() {
    const trackFiles = [
      "tracks/urgent.md",
      "tracks/important.md",
      "tracks/trivial.md",
    ];
    const dailyNotePath = `journal/${this.getTodayDateStr()}.md`;

    // Ensure all files exist
    for (const p of trackFiles) {
      await this.ensureFile(p);
    }
    await this.ensureFile(dailyNotePath);

    // Reset daily track if a new day has started
    await this.resetDailyTrackIfNeeded();

    // Layout structure:
    //   main split (direction: vertical)
    //     inner split (direction: horizontal) -- top/bottom rows
    //       top row: split (direction: vertical) -- 3 columns
    //         urgent | important | trivial
    //       bottom row: split (direction: vertical) -- 2 columns
    //         daily note (left) | tracks/daily.md (right)

    const newMain = {
      type: "split",
      children: [
        {
          type: "split",
          children: [
            {
              type: "split",
              children: trackFiles.map((f) => ({
                type: "tabs",
                children: [
                  {
                    type: "leaf",
                    state: {
                      type: "markdown",
                      state: { file: f, mode: "source", source: false },
                    },
                  },
                ],
              })),
              direction: "vertical",
            },
            {
              type: "split",
              children: [
                {
                  type: "tabs",
                  children: [
                    {
                      type: "leaf",
                      state: {
                        type: "markdown",
                        state: {
                          file: "tracks/tracks.md",
                          mode: "source",
                          source: false,
                        },
                      },
                    },
                  ],
                },
                {
                  type: "tabs",
                  children: [
                    {
                      type: "leaf",
                      state: {
                        type: "markdown",
                        state: {
                          file: dailyNotePath,
                          mode: "source",
                          source: false,
                        },
                      },
                    },
                  ],
                },
                {
                  type: "tabs",
                  children: [
                    {
                      type: "leaf",
                      state: {
                        type: "markdown",
                        state: {
                          file: "tracks/daily.md",
                          mode: "source",
                          source: false,
                        },
                      },
                    },
                  ],
                },
              ],
              direction: "vertical",
            },
          ],
          direction: "horizontal",
        },
      ],
      direction: "vertical",
    };

    await this.applyMainLayout(newMain);
  }

  async switchToFocusWorkspace() {
    // Remember the currently active file
    const activeFile = this.app.workspace.getActiveFile();
    const filePath = activeFile ? activeFile.path : null;

    // Single-pane layout
    const leafState = filePath
      ? {
          type: "markdown",
          state: { file: filePath, mode: "source", source: false },
        }
      : { type: "empty", state: {} };

    const newMain = {
      type: "split",
      children: [
        {
          type: "tabs",
          children: [
            {
              type: "leaf",
              state: leafState,
            },
          ],
        },
      ],
      direction: "vertical",
    };

    await this.applyMainLayout(newMain);
  }
}

module.exports = WorkspaceSwitcherPlugin;
