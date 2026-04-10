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
const { ChangeSet, EditorSelection, EditorState } = require("@codemirror/state");

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

    // On startup: update stale journal paths and reset daily track
    this.app.workspace.onLayoutReady(() => this.onStartup());
    this.registerEditorExtension(this.buildTaskSortExtension());

    this.addCommand({
      id: "todo-workspace",
      name: "Switch to TODO workspace",
      callback: () => this.switchToTodoWorkspace(),
    });

    this.addCommand({
      id: "sort-current-file",
      name: "Sort tasks in current file",
      callback: () => this.sortCurrentFile(),
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

  // Called once when Obsidian layout is ready (startup / reload)
  async onStartup() {
    const todayPath = `journal/${this.getTodayDateStr()}.md`;
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

  parseTokens(lines, startIndex, baseIndent) {
    const tokens = [];
    let i = startIndex;
    while (i < lines.length) {
      const line = lines[i];
      
      if (line.trim() === '') {
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === '') j++;
        if (j < lines.length) {
          const nextTaskMatch = lines[j].match(/^(\s*)-\s*\[([xX ])\]/);
          const nextIndentMatch = lines[j].match(/^(\s*)/);
          const nextIndent = nextIndentMatch ? nextIndentMatch[1] : "";
          if ((nextTaskMatch && nextTaskMatch[1] === baseIndent) || nextIndent.length > baseIndent.length) {
            tokens.push({ type: "blank", lines: lines.slice(i, j) });
            i = j;
            continue;
          }
        }
        break;
      }
      
      const taskMatch = line.match(/^(\s*)-\s*\[([xX ])\]/);
      if (taskMatch && taskMatch[1] === baseIndent) {
        const isCompleted = taskMatch[2].toLowerCase() === 'x';
        const taskLines = [line];
        i++;
        while (i < lines.length) {
          if (lines[i].trim() === '') break;
          const indentMatch = lines[i].match(/^(\s*)/);
          if (indentMatch && indentMatch[1].length > baseIndent.length) {
            taskLines.push(lines[i]);
            i++;
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

  removeCompleted(content) {
    const lines = content.split('\n');
    const newLines = [];
    const isTask = (line) => /^(\s*)-\s*\[[xX ]\]/.test(line);
    
    let i = 0;
    while (i < lines.length) {
      if (isTask(lines[i])) {
        const match = lines[i].match(/^(\s*)-\s*\[/);
        const baseIndent = match[1];
        
        const { tokens, nextIndex } = this.parseTokens(lines, i, baseIndent);
        i = nextIndex;
        
        let prevWasDroppedTask = false;
        for (const tok of tokens) {
          if (tok.type === "task") {
            if (!tok.isCompleted) {
              prevWasDroppedTask = false;
              if (tok.lines.length > 1) {
                const head = tok.lines[0];
                const tail = tok.lines.slice(1).join('\n');
                const processedTail = this.removeCompleted(tail);
                newLines.push(head);
                if (processedTail !== "") newLines.push(...processedTail.split('\n'));
              } else {
                newLines.push(...tok.lines);
              }
            } else {
              prevWasDroppedTask = true;
            }
          } else {
            if (!prevWasDroppedTask) {
              newLines.push(...tok.lines);
            }
            prevWasDroppedTask = false;
          }
        }
      } else {
        newLines.push(lines[i]);
        i++;
      }
    }
    return newLines.join('\n');
  }

  sortContent(content) {
    const lines = content.split('\n');
    const newLines = [];
    const isTask = (line) => /^(\s*)-\s*\[[xX ]\]/.test(line);
    
    let i = 0;
    while (i < lines.length) {
      if (isTask(lines[i])) {
        const match = lines[i].match(/^(\s*)-\s*\[/);
        const baseIndent = match[1];
        
        const { tokens, nextIndex } = this.parseTokens(lines, i, baseIndent);
        i = nextIndex;
        
        const tasks = tokens.filter(t => t.type === "task");
        const incomplete = tasks.filter(t => !t.isCompleted);
        const complete = tasks.filter(t => t.isCompleted);
        const sortedTasks = [...incomplete, ...complete];
        
        let taskIdx = 0;
        for (const tok of tokens) {
          if (tok.type === "task") {
            const t = sortedTasks[taskIdx];
            taskIdx++;
            if (t.lines.length > 1) {
              const head = t.lines[0];
              const tail = t.lines.slice(1).join('\n');
              const sortedTail = this.sortContent(tail);
              newLines.push(head);
              if (sortedTail !== "") newLines.push(...sortedTail.split('\n'));
            } else {
              newLines.push(...t.lines);
            }
          } else {
            newLines.push(...tok.lines);
          }
        }
      } else {
        newLines.push(lines[i]);
        i++;
      }
    }
    return newLines.join('\n');
  }

  buildTaskSortExtension() {
    return EditorState.transactionFilter.of((tr) => {
      const toggle = this.getCheckboxToggleInfo(tr);
      if (!toggle) return tr;

      const region = this.findSortableTaskRegion(tr.newDoc, toggle.lineNumber);
      if (!region) return tr;

      const regionText = tr.newDoc.sliceString(region.from, region.to);
      const sortedRegion = this.sortContent(regionText);
      if (sortedRegion === regionText) return tr;

      const replacement = ChangeSet.of(
        [{ from: region.from, to: region.to, insert: sortedRegion }],
        tr.newDoc.length
      );
      const mappedSelection = tr.newSelection.map(replacement);
      const finalSelection = this.remapSelectionIntoSortedTask(
        tr.newSelection,
        mappedSelection,
        region,
        regionText,
        sortedRegion,
        toggle.pos
      );

      return [
        tr,
        {
          sequential: true,
          changes: [{ from: region.from, to: region.to, insert: sortedRegion }],
          selection: finalSelection,
        },
      ];
    });
  }

  getCheckboxToggleInfo(tr) {
    if (!tr.docChanged) return null;

    const toggles = [];
    let isValidToggle = true;

    tr.changes.iterChanges((fromA, toA, fromB) => {
      if (!isValidToggle) return;

      const oldLine = tr.startState.doc.lineAt(fromA);
      const newLine = tr.newDoc.lineAt(fromB);
      if (!this.isCheckboxToggleLineChange(oldLine.text, newLine.text)) {
        isValidToggle = false;
        return;
      }

      toggles.push({
        lineNumber: newLine.number,
        pos: newLine.from,
      });
    });

    if (!isValidToggle || toggles.length !== 1) return null;
    return toggles[0];
  }

  isCheckboxToggleLineChange(oldLine, newLine) {
    const oldTask = this.matchTaskLine(oldLine);
    const newTask = this.matchTaskLine(newLine);
    if (!oldTask || !newTask) return false;

    const oldParts = oldLine.match(/^(\s*-\s*\[)([xX ])\](.*)$/);
    const newParts = newLine.match(/^(\s*-\s*\[)([xX ])\](.*)$/);
    if (!oldParts || !newParts) return false;

    if (oldParts[1] !== newParts[1] || oldParts[3] !== newParts[3]) return false;

    const oldMarker = oldParts[2].toLowerCase();
    const newMarker = newParts[2].toLowerCase();
    return (
      (oldMarker === " " && newMarker === "x") ||
      (oldMarker === "x" && newMarker === " ")
    );
  }

  findSortableTaskRegion(doc, lineNumber) {
    const line = doc.line(lineNumber);
    const taskMatch = this.matchTaskLine(line.text);
    if (!taskMatch) return null;

    const baseIndent = taskMatch[1];
    const baseIndentLen = baseIndent.length;
    let start = lineNumber;

    while (start > 1) {
      const prev = doc.line(start - 1);
      const prevTask = this.matchTaskLine(prev.text);
      const prevIndent = this.getIndent(prev.text);

      if (prev.text.trim() === "") {
        start--;
        continue;
      }

      if (prevIndent.length > baseIndentLen) {
        start--;
        continue;
      }

      if (prevTask && prevTask[1] === baseIndent) {
        start--;
        continue;
      }

      break;
    }

    while (start <= lineNumber) {
      const startTask = this.matchTaskLine(doc.line(start).text);
      if (startTask && startTask[1] === baseIndent) break;
      start++;
    }

    let end = lineNumber;
    while (end < doc.lines) {
      const next = doc.line(end + 1);
      const nextTask = this.matchTaskLine(next.text);
      const nextIndent = this.getIndent(next.text);

      if (next.text.trim() === "") {
        end++;
        continue;
      }

      if (nextIndent.length > baseIndentLen) {
        end++;
        continue;
      }

      if (nextTask && nextTask[1] === baseIndent) {
        end++;
        continue;
      }

      break;
    }

    while (end >= start && doc.line(end).text.trim() === "") {
      end--;
    }

    if (end < start) return null;

    return {
      from: doc.line(start).from,
      to: end < doc.lines ? doc.line(end + 1).from : doc.line(end).to,
      baseIndent,
    };
  }

  remapSelectionIntoSortedTask(originalSelection, mappedSelection, region, regionText, sortedRegion, toggledPos) {
    const oldTasks = this.collectTaskBlocks(regionText, region.baseIndent);
    const newTasks = this.collectTaskBlocks(sortedRegion, region.baseIndent);
    const relativeTogglePos = toggledPos - region.from;
    const oldTask = oldTasks.find((task) => relativeTogglePos >= task.from && relativeTogglePos <= task.to);

    if (!oldTask) return mappedSelection;

    const newTask = newTasks.find((task) => {
      return task.text === oldTask.text && task.occurrence === oldTask.occurrence;
    });
    if (!newTask) return mappedSelection;

    const originalMain = originalSelection.main;
    const oldTaskFrom = region.from + oldTask.from;
    const oldTaskTo = region.from + oldTask.to;
    if (
      originalMain.anchor < oldTaskFrom ||
      originalMain.anchor > oldTaskTo ||
      originalMain.head < oldTaskFrom ||
      originalMain.head > oldTaskTo
    ) {
      return mappedSelection;
    }

    const newTaskFrom = region.from + newTask.from;
    const newTaskTo = region.from + newTask.to;
    const anchor = this.mapPosIntoTask(originalMain.anchor, oldTaskFrom, oldTaskTo, newTaskFrom, newTaskTo);
    const head = this.mapPosIntoTask(originalMain.head, oldTaskFrom, oldTaskTo, newTaskFrom, newTaskTo);

    const ranges = mappedSelection.ranges.slice();
    ranges[mappedSelection.mainIndex] = EditorSelection.range(
      anchor,
      head,
      originalMain.goalColumn,
      originalMain.bidiLevel,
      originalMain.assoc
    );

    return EditorSelection.create(ranges, mappedSelection.mainIndex);
  }

  collectTaskBlocks(regionText, baseIndent) {
    const lines = regionText.split('\n');
    const { tokens } = this.parseTokens(lines, 0, baseIndent);
    const tasks = [];
    const seen = new Map();
    let offset = 0;
    let consumedLines = 0;

    for (const token of tokens) {
      const text = token.lines.join('\n');
      if (token.type === "task") {
        const occurrence = seen.get(text) || 0;
        seen.set(text, occurrence + 1);
        tasks.push({
          from: offset,
          to: offset + text.length,
          text,
          occurrence,
        });
      }

      offset += text.length;
      consumedLines += token.lines.length;
      if (consumedLines < lines.length) {
        offset += 1;
      }
    }

    return tasks;
  }

  mapPosIntoTask(pos, oldFrom, oldTo, newFrom, newTo) {
    const oldLength = Math.max(0, oldTo - oldFrom);
    const newLength = Math.max(0, newTo - newFrom);
    const offset = Math.min(Math.max(pos - oldFrom, 0), oldLength);
    return newFrom + Math.min(offset, newLength);
  }

  matchTaskLine(line) {
    return line.match(/^(\s*)-\s*\[[xX ]\]/);
  }

  getIndent(line) {
    const match = line.match(/^(\s*)/);
    return match ? match[1] : "";
  }

  async sortCurrentFile(silent = false) {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") return;

    const content = await this.app.vault.read(file);
    const sorted = this.sortContent(content);

    if (sorted !== content) {
      await this.app.vault.process(file, (data) => this.sortContent(data));
      if (!silent) new obsidian.Notice("Tasks auto-sorted (completed items moved to bottom)");
    } else {
      if (!silent) new obsidian.Notice("No sort required: already up to date");
    }
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
