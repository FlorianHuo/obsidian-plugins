// Workspace Switcher Plugin for Obsidian
//
// Built-in workspaces:
//   - "TODO workspace"  - 3 tracks (urgent/important/trivial) on top + daily note on bottom
//   - "Focus workspace" - single panel with the currently active file
//
// User-defined workspaces:
//   - Save / Load / Delete custom layouts via commands
//
// Key design: uses workspace.getLayout() to preserve sidebars,
// only modifies the "main" area of the layout.

const obsidian = require("obsidian");

// Modal for selecting a saved workspace from a fuzzy-search list
class WorkspacePickerModal extends obsidian.FuzzySuggestModal {
  constructor(app, workspaceNames, onChoose) {
    super(app);
    this.names = workspaceNames;
    this.onChoose = onChoose;
    this.setPlaceholder("Type to search workspaces...");
  }

  getItems() {
    return this.names;
  }

  getItemText(name) {
    return name;
  }

  onChooseItem(name) {
    this.onChoose(name);
  }
}

class WorkspaceSwitcherPlugin extends obsidian.Plugin {
  async onload() {
    // Load persisted data (tracks last reset date + saved workspaces)
    this.data = (await this.loadData()) || {};
    if (!this.data.workspaces) this.data.workspaces = {};

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

    this.addCommand({
      id: "save-workspace",
      name: "Save current workspace",
      callback: () => this.saveCurrentWorkspace(),
    });

    this.addCommand({
      id: "load-workspace",
      name: "Load workspace",
      callback: () => this.loadSavedWorkspace(),
    });

    this.addCommand({
      id: "delete-workspace",
      name: "Delete workspace",
      callback: () => this.deleteSavedWorkspace(),
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
                          file: "tracks/current.md",
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

  // ---- Custom workspace management ----

  async saveCurrentWorkspace() {
    const name = await this.promptForName("Save workspace as:");
    if (!name) return;

    // Capture the full layout (including sidebars)
    const layout = this.app.workspace.getLayout();
    this.data.workspaces[name] = layout;
    await this.saveData(this.data);
    new obsidian.Notice(`Workspace "${name}" saved.`);
  }

  async loadSavedWorkspace() {
    const names = Object.keys(this.data.workspaces);
    if (names.length === 0) {
      new obsidian.Notice("No saved workspaces.");
      return;
    }

    new WorkspacePickerModal(this.app, names, async (name) => {
      const savedLayout = this.data.workspaces[name];
      if (savedLayout) {
        // Deep clone to avoid mutating saved data
        const layout = JSON.parse(JSON.stringify(savedLayout));

        // Update any journal/YYYY-MM-DD.md paths to today's date
        const todayPath = `journal/${this.getTodayDateStr()}.md`;
        for (const key of Object.keys(layout)) {
          this.updateJournalPaths(layout[key], todayPath);
        }

        // Ensure today's daily note file exists
        await this.ensureFile(todayPath);

        // Reset daily track if a new day has started
        await this.resetDailyTrackIfNeeded();

        await this.app.workspace.changeLayout(layout);
        new obsidian.Notice(`Workspace "${name}" loaded.`);
      }
    }).open();
  }

  // Recursively walk a layout tree and replace journal date paths with today's
  updateJournalPaths(node, todayPath) {
    if (!node) return;
    if (node.type === "leaf" && node.state && node.state.state &&
        typeof node.state.state.file === "string" &&
        /^journal\/\d{4}-\d{2}-\d{2}\.md$/.test(node.state.state.file)) {
      node.state.state.file = todayPath;
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        this.updateJournalPaths(child, todayPath);
      }
    }
  }

  async deleteSavedWorkspace() {
    const names = Object.keys(this.data.workspaces);
    if (names.length === 0) {
      new obsidian.Notice("No saved workspaces.");
      return;
    }

    new WorkspacePickerModal(this.app, names, async (name) => {
      delete this.data.workspaces[name];
      await this.saveData(this.data);
      new obsidian.Notice(`Workspace "${name}" deleted.`);
    }).open();
  }

  // Show a prompt dialog and return the entered text (or null if cancelled)
  promptForName(message) {
    return new Promise((resolve) => {
      const modal = new PromptModal(this.app, message, resolve);
      modal.open();
    });
  }
}

// Simple text input modal for prompting a workspace name
class PromptModal extends obsidian.Modal {
  constructor(app, message, onSubmit) {
    super(app);
    this.message = message;
    this.onSubmit = onSubmit;
    this.result = null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("p", { text: this.message });

    const input = contentEl.createEl("input", { type: "text" });
    input.style.width = "100%";
    input.focus();

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        this.result = input.value.trim();
        this.close();
      } else if (e.key === "Escape") {
        this.close();
      }
    });

    const btnContainer = contentEl.createDiv({ cls: "modal-button-container" });
    const saveBtn = btnContainer.createEl("button", {
      text: "Save",
      cls: "mod-cta",
    });
    saveBtn.addEventListener("click", () => {
      this.result = input.value.trim();
      this.close();
    });

    const cancelBtn = btnContainer.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => {
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
    this.onSubmit(this.result || null);
  }
}

module.exports = WorkspaceSwitcherPlugin;
