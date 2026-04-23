// Workspace Switcher Plugin for Obsidian
//
// Saved workspaces:
//   - Save / Load / Delete custom layouts via commands
//
// Key design: uses workspace.getLayout() to preserve sidebars,
// only modifies the "main" area of the layout.

const obsidian = require("obsidian");

const TASK_LINE_RE = /^(\s*)-\s*\[([^\]])\]/;

function getIndent(line) {
  const match = line.match(/^(\s*)/);
  return match ? match[1] : "";
}

function parseTaskTokens(lines, startIndex, baseIndent) {
  const tokens = [];
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      if (j < lines.length) {
        const nextTaskMatch = lines[j].match(TASK_LINE_RE);
        const nextIndent = getIndent(lines[j]);
        if (
          (nextTaskMatch && nextTaskMatch[1] === baseIndent) ||
          nextIndent.length > baseIndent.length
        ) {
          tokens.push({ type: "blank", lines: lines.slice(i, j) });
          i = j;
          continue;
        }
      }
      break;
    }

    const taskMatch = line.match(TASK_LINE_RE);
    if (taskMatch && taskMatch[1] === baseIndent) {
      const taskLines = [line];
      const isCompleted = taskMatch[2].toLowerCase() === "x";
      i += 1;

      while (i < lines.length) {
        if (lines[i].trim() === "") break;
        const indent = getIndent(lines[i]);
        if (indent.length > baseIndent.length) {
          taskLines.push(lines[i]);
          i += 1;
        } else {
          break;
        }
      }

      tokens.push({ type: "task", isCompleted, lines: taskLines });
      continue;
    }

    break;
  }

  return { tokens, nextIndex: i };
}

function removeCompletedContent(content) {
  const lines = content.split("\n");
  const newLines = [];
  let i = 0;

  while (i < lines.length) {
    if (TASK_LINE_RE.test(lines[i])) {
      const match = lines[i].match(/^(\s*)-\s*\[/);
      const baseIndent = match[1];
      const { tokens, nextIndex } = parseTaskTokens(lines, i, baseIndent);
      i = nextIndex;

      let prevWasDroppedTask = false;
      for (const token of tokens) {
        if (token.type === "task") {
          if (!token.isCompleted) {
            prevWasDroppedTask = false;
            if (token.lines.length > 1) {
              const head = token.lines[0];
              const tail = token.lines.slice(1).join("\n");
              const processedTail = removeCompletedContent(tail);
              newLines.push(head);
              if (processedTail !== "") {
                newLines.push(...processedTail.split("\n"));
              }
            } else {
              newLines.push(...token.lines);
            }
          } else {
            prevWasDroppedTask = true;
          }
        } else {
          if (!prevWasDroppedTask) {
            newLines.push(...token.lines);
          }
          prevWasDroppedTask = false;
        }
      }
    } else {
      newLines.push(lines[i]);
      i += 1;
    }
  }

  return newLines.join("\n");
}

const DAILY_TIME_ZONE = "Asia/Shanghai";
const DAILY_ROLLOVER_CHECK_INTERVAL_MS = 60 * 1000;

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

class WorkspaceQuickSwitchModal extends obsidian.Modal {
  constructor(app, workspaceNames, onChoose) {
    super(app);
    this.names = workspaceNames;
    this.onChoose = onChoose;
    this.query = "";
    this.selected = 0;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "Switch workspace" });

    this.inputEl = contentEl.createEl("input", {
      type: "text",
      placeholder: "Type to filter workspaces...",
    });
    this.inputEl.style.width = "100%";
    this.inputEl.focus();

    this.listEl = contentEl.createDiv();
    this.listEl.addClass("workspace-switcher-quick-switch-list");

    this.inputEl.addEventListener("input", () => {
      this.query = this.inputEl.value.trim().toLowerCase();
      this.selected = 0;
      this.renderList();
    });

    this.inputEl.addEventListener("keydown", (evt) => {
      if (evt.key === "ArrowUp" || evt.key === "k") {
        evt.preventDefault();
        this.move(-1);
      } else if (evt.key === "ArrowDown" || evt.key === "j") {
        evt.preventDefault();
        this.move(1);
      } else if (evt.key === "Enter") {
        evt.preventDefault();
        this.chooseSelected();
      }
    });

    this.renderList();
  }

  getFilteredNames() {
    if (!this.query) return this.names;
    return this.names.filter((name) =>
      name.toLowerCase().includes(this.query)
    );
  }

  move(step) {
    const names = this.getFilteredNames();
    if (names.length === 0) return;

    this.selected = (this.selected + step + names.length) % names.length;
    this.renderList();
  }

  chooseSelected() {
    const names = this.getFilteredNames();
    if (names.length === 0) return;

    const name = names[this.selected];
    this.close();
    this.onChoose(name);
  }

  renderList() {
    const names = this.getFilteredNames();
    this.listEl.empty();

    if (names.length === 0) {
      this.listEl.createEl("p", { text: "No matching workspaces." });
      return;
    }

    if (this.selected >= names.length) {
      this.selected = names.length - 1;
    }

    names.forEach((name, index) => {
      const itemEl = this.listEl.createDiv();
      itemEl.setText(name);
      itemEl.addClass("workspace-switcher-quick-switch-item");
      if (index === this.selected) {
        itemEl.addClass("is-selected");
      }
      itemEl.addEventListener("click", () => {
        this.selected = index;
        this.chooseSelected();
      });
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class WorkspaceSwitcherPlugin extends obsidian.Plugin {
  async onload() {
    // Load persisted data (tracks last reset date + saved workspaces)
    this.data = (await this.loadData()) || {};
    if (!this.data.workspaces) this.data.workspaces = {};
    this.lastSeenDate = this.getTodayDateStr();
    this.isDateRefreshInFlight = false;

    // On startup: update stale journal paths and reset daily track
    this.app.workspace.onLayoutReady(() => void this.onStartup());
    this.registerInterval(window.setInterval(() => {
      void this.checkForDayRollover();
    }, DAILY_ROLLOVER_CHECK_INTERVAL_MS));
    this.registerDomEvent(window, "focus", () => {
      void this.checkForDayRollover();
    });

    this.addCommand({
      id: "quick-switch-workspace",
      name: "Quick switch workspace",
      hotkeys: [
        {
          modifiers: ["Alt"],
          key: "W",
        },
      ],
      callback: () => this.openWorkspaceQuickSwitch(),
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

  // Called once when Obsidian layout is ready (startup / reload)
  async onStartup() {
    await this.syncDailyState();
  }

  async syncDailyState() {
    const today = this.getTodayDateStr();
    const todayPath = `journal/${today}.md`;
    const layout = this.app.workspace.getLayout();
    let changed = false;

    // Check if any leaf has a stale journal path
    const check = (node) => {
      if (!node) return;
      if (node.type === "leaf" && node.state && node.state.state &&
          typeof node.state.state.file === "string" &&
          /^journal\/\d{4}-\d{2}-\d{2}\.md$/.test(node.state.state.file) &&
          node.state.state.file !== todayPath) {
        node.state.state.file = todayPath;
        changed = true;
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) check(child);
      }
    };

    for (const key of Object.keys(layout)) {
      check(layout[key]);
    }

    // Ensure today's journal exists and reset daily track
    await this.ensureFile(todayPath);
    await this.resetDailyTrackIfNeeded();

    if (changed) {
      await this.app.workspace.changeLayout(layout);
    }

    this.lastSeenDate = today;
  }

  async checkForDayRollover() {
    const today = this.getTodayDateStr();
    if (today === this.lastSeenDate || this.isDateRefreshInFlight) return;

    this.isDateRefreshInFlight = true;
    try {
      await this.syncDailyState();
    } finally {
      this.isDateRefreshInFlight = false;
    }
  }

  // Build YYYY-MM-DD string in the configured daily timezone.
  getTodayDateStr() {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: DAILY_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());

    const dateParts = {};
    for (const part of parts) {
      if (part.type !== "literal") {
        dateParts[part.type] = part.value;
      }
    }

    return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
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
  async resetDailyTrackIfNeeded() {
    const today = this.getTodayDateStr();
    if (this.data.lastDailyReset === today) return;

    const templateFile =
      this.app.vault.getAbstractFileByPath("templates/daily.md");
    if (!templateFile) return;

    const dailyTrack =
      this.app.vault.getAbstractFileByPath("tracks/daily.md");

    // Keep uncompleted tasks in current.md and remove completed ones
    const currentFile =
      this.app.vault.getAbstractFileByPath("tracks/current.md");
    if (currentFile) {
      const currentContent = await this.app.vault.read(currentFile);
      if (currentContent.trim().length > 0) {
        const filteredContent = this.removeCompleted(currentContent);
        await this.app.vault.modify(currentFile, filteredContent);
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

  removeCompleted(content) {
    return removeCompletedContent(content);
  }

  // ---- Saved workspace management ----

  async openWorkspaceQuickSwitch() {
    const names = Object.keys(this.data.workspaces).sort((a, b) =>
      a.localeCompare(b)
    );
    if (names.length === 0) {
      new obsidian.Notice("No saved workspaces.");
      return;
    }

    new WorkspaceQuickSwitchModal(this.app, names, async (name) => {
      await this.loadSavedWorkspaceByName(name);
    }).open();
  }

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
      await this.loadSavedWorkspaceByName(name);
    }).open();
  }

  async loadSavedWorkspaceByName(name) {
    const savedLayout = this.data.workspaces[name];
    if (!savedLayout) {
      new obsidian.Notice(`Workspace "${name}" not found.`);
      return;
    }

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
