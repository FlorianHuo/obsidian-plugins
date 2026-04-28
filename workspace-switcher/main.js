// Workspace Switcher Plugin for Obsidian
//
// Saved workspaces:
//   - Save / Load / Delete custom layouts via commands
//
// Key design: uses workspace.getLayout() to preserve sidebars,
// only modifies the "main" area of the layout.

const obsidian = require("obsidian");

const DAILY_TIME_ZONE = "Asia/Shanghai";
const DAILY_ROLLOVER_CHECK_INTERVAL_MS = 60 * 1000;
const DEFAULT_SETTINGS = {
  dailyNoteFolder: "journal",
  pathRewriteRules: "",
};

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeDailyNoteFolder(folder) {
  const normalized = String(folder || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  return normalized || DEFAULT_SETTINGS.dailyNoteFolder;
}

function normalizeSettings(settings = {}) {
  settings = settings || {};
  return {
    dailyNoteFolder: normalizeDailyNoteFolder(settings.dailyNoteFolder),
    pathRewriteRules: String(settings.pathRewriteRules || ""),
  };
}

function parsePathRewriteRules(rulesText) {
  return String(rulesText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const match = /^(?:(exact|prefix)\s*:)?\s*(.+?)\s*(?:=>|->)\s*(.+)$/i.exec(line);
      if (!match) return null;

      const from = match[2].trim();
      const to = match[3].trim();
      if (!from) return null;

      return {
        mode: (match[1] || (from.endsWith("/") ? "prefix" : "exact")).toLowerCase(),
        from,
        to,
      };
    })
    .filter(Boolean);
}

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

class WorkspaceSwitcherSettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Workspace Switcher" });

    new obsidian.Setting(contentEl)
      .setName("Daily note folder")
      .setDesc("Folder for dated daily notes, for example journal. Do not include a leading or trailing slash.")
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.dailyNoteFolder)
          .setValue(this.plugin.settings.dailyNoteFolder)
          .onChange(async (value) => {
            this.plugin.settings.dailyNoteFolder = normalizeDailyNoteFolder(value);
            await this.plugin.saveSettings();
          });
      });

    new obsidian.Setting(contentEl)
      .setName("Path rewrite rules")
      .setDesc("Optional local migration rules, one per line. Use 'prefix: old/ -> new/' or 'exact: old.md -> new.md'.")
      .addTextArea((text) => {
        text
          .setPlaceholder("prefix: old-folder/ -> new-folder/\nexact: old-file.md -> new-file.md")
          .setValue(this.plugin.settings.pathRewriteRules)
          .onChange(async (value) => {
            this.plugin.settings.pathRewriteRules = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 8;
        text.inputEl.style.width = "100%";
      });
  }
}

class WorkspaceSwitcherPlugin extends obsidian.Plugin {
  constructor(app) {
    super(app);
    this.settings = normalizeSettings();
  }

  async onload() {
    // Load persisted data for saved workspaces and rollover tracking.
    this.data = (await this.loadData()) || {};
    if (!this.data.workspaces) this.data.workspaces = {};
    this.settings = normalizeSettings(this.data.settings);
    this.data.settings = this.settings;
    this.lastSeenDate = this.getTodayDateStr();
    this.isDateRefreshInFlight = false;
    this.addSettingTab(new WorkspaceSwitcherSettingTab(this.app, this));

    // On startup: update stale journal paths only.
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

  async saveSettings() {
    this.settings = normalizeSettings(this.settings);
    this.data.settings = this.settings;
    await this.saveData(this.data);
  }

  async syncDailyState() {
    const today = this.getTodayDateStr();
    const todayPath = this.getDailyNotePath(today);
    const layout = this.app.workspace.getLayout();
    let changed = false;

    // Check if any leaf has a legacy vault path or stale journal path.
    const check = (node) => {
      if (!node) return;
      if (node.type === "leaf" && node.state && node.state.state &&
          typeof node.state.state.file === "string") {
        const normalizedPath = this.normalizeVaultPath(node.state.state.file);
        if (normalizedPath !== node.state.state.file) {
          node.state.state.file = normalizedPath;
          changed = true;
        }
        if (this.isDailyNotePath(node.state.state.file) &&
            node.state.state.file !== todayPath) {
          node.state.state.file = todayPath;
          changed = true;
        }
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) check(child);
      }
    };

    for (const key of Object.keys(layout)) {
      check(layout[key]);
    }

    // Ensure today's journal exists
    await this.ensureFile(todayPath);

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

  getDailyNoteFolder() {
    return normalizeDailyNoteFolder(this.settings && this.settings.dailyNoteFolder);
  }

  getDailyNotePath(date) {
    return `${this.getDailyNoteFolder()}/${date}.md`;
  }

  isDailyNotePath(path) {
    const re = new RegExp(`^${escapeRegExp(this.getDailyNoteFolder())}/\\d{4}-\\d{2}-\\d{2}\\.md$`);
    return re.test(path);
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

    // Update configured path rewrites and roll dated journal tabs to today's note.
    const todayPath = this.getDailyNotePath(this.getTodayDateStr());
    for (const key of Object.keys(layout)) {
      this.updateJournalPaths(layout[key], todayPath);
    }

    // Ensure today's daily note file exists
    await this.ensureFile(todayPath);

    await this.app.workspace.changeLayout(layout);
    new obsidian.Notice(`Workspace "${name}" loaded.`);
  }

  // Normalize vault paths through user-configured local rewrite rules.
  normalizeVaultPath(path) {
    for (const rule of parsePathRewriteRules(this.settings && this.settings.pathRewriteRules)) {
      if (rule.mode === "exact" && path === rule.from) {
        return rule.to;
      }
      if (rule.mode === "prefix" && path.startsWith(rule.from)) {
        return `${rule.to}${path.slice(rule.from.length)}`;
      }
    }
    return path;
  }

  // Recursively walk a layout tree and replace legacy paths and journal date paths.
  updateJournalPaths(node, todayPath) {
    if (!node) return;
    if (node.type === "leaf" && node.state && node.state.state &&
        typeof node.state.state.file === "string") {
      node.state.state.file = this.normalizeVaultPath(node.state.state.file);
      if (this.isDailyNotePath(node.state.state.file)) {
        node.state.state.file = todayPath;
      }
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
