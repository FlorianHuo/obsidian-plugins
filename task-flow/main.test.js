const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyStatusToLine,
  applyTaskStatusCommandToEditor,
  addDailyRefreshHeaderAction,
  buildRefreshedCurrentContent,
  completeDescendantTasksInLineArray,
  extractRhythmsDailyTasks,
  getTodayDateStr,
  isCurrentTracksFile,
  markAncestorTasksInLineArray,
  refreshCurrentDailySection,
  replaceCurrentDailySection,
  removeDailyRefreshHeaderAction,
  shouldRefreshCurrentDailySection,
  syncDailyRefreshHeaderActions,
  setTaskStatus,
  toggleStatusOnLine,
  toggleTaskStatus,
} = require("./main.js");

function createMockEditor(lines, selection) {
  return {
    lines: [...lines],
    selection: {
      from: { ...selection.from },
      to: { ...selection.to },
    },
    getCursor(which) {
      if (which === "to") return { ...this.selection.to };
      return { ...this.selection.from };
    },
    getLine(line) {
      return this.lines[line];
    },
    lineCount() {
      return this.lines.length;
    },
    setLine(line, value) {
      this.lines[line] = value;
    },
    setCursor(position) {
      this.selection = {
        from: { ...position },
        to: { ...position },
      };
    },
    setSelection(from, to) {
      this.selection = {
        from: { ...from },
        to: { ...to },
      };
    },
  };
}

function createMockActionElement() {
  return {
    isConnected: true,
    classList: {
      values: new Set(),
      add(value) {
        this.values.add(value);
      },
    },
    removeCalled: false,
    remove() {
      this.isConnected = false;
      this.removeCalled = true;
    },
  };
}

function createMockLeaf(filePath) {
  const actionElements = [];
  const callbacks = [];
  const view = {
    file: filePath ? { path: filePath } : null,
    addAction(icon, title, callback) {
      const action = createMockActionElement();
      action.icon = icon;
      action.title = title;
      actionElements.push(action);
      callbacks.push(callback);
      return action;
    },
  };

  return {
    view,
    actionElements,
    callbacks,
  };
}

test("applyStatusToLine converts supported line shapes into in-progress tasks", () => {
  const cases = [
    ["- [ ] task", "- [/] task"],
    ["- [x] task", "- [/] task"],
    ["- task", "- [/] task"],
    ["task", "- [/] task"],
    ["", "- [/] "],
    ["  - task", "  - [/] task"],
    ["1. task", "1. [/] task"],
  ];

  for (const [input, expected] of cases) {
    assert.equal(applyStatusToLine(input, "/"), expected);
  }
});

test("applyStatusToLine can set a line to done tasks", () => {
  const cases = [
    ["- [/] task", "- [x] task"],
    ["- [ ] task", "- [x] task"],
    ["- task", "- [x] task"],
    ["task", "- [x] task"],
    ["", "- [x] "],
  ];

  for (const [input, expected] of cases) {
    assert.equal(applyStatusToLine(input, "x"), expected);
  }
});

test("toggleStatusOnLine turns an in-progress marker back into an unchecked task", () => {
  const cases = [
    ["- [/] task", "- [ ] task"],
    ["1. [/] task", "1. [ ] task"],
    ["[/] task", "[ ] task"],
    ["- [/] ", "- [ ] "],
    ["- [x] task", "- [/] task"],
  ];

  for (const [input, expected] of cases) {
    assert.equal(toggleStatusOnLine(input, "/"), expected);
  }
});

test("toggleStatusOnLine turns a done marker back into an unchecked task", () => {
  const cases = [
    ["- [x] task", "- [ ] task"],
    ["1. [x] task", "1. [ ] task"],
    ["[x] task", "[ ] task"],
    ["- [x] ", "- [ ] "],
    ["- [/] task", "- [x] task"],
  ];

  for (const [input, expected] of cases) {
    assert.equal(toggleStatusOnLine(input, "x"), expected);
  }
});

test("setTaskStatus updates the current line and keeps the cursor near the original content", () => {
  const editor = createMockEditor(["task"], {
    from: { line: 0, ch: 2 },
    to: { line: 0, ch: 2 },
  });

  setTaskStatus(editor, "/");

  assert.deepEqual(editor.lines, ["- [/] task"]);
  assert.deepEqual(editor.selection, {
    from: { line: 0, ch: 8 },
    to: { line: 0, ch: 8 },
  });
});

test("toggleTaskStatus turns an in-progress marker back into an unchecked task", () => {
  const editor = createMockEditor(["- [/] task"], {
    from: { line: 0, ch: 6 },
    to: { line: 0, ch: 6 },
  });

  toggleTaskStatus(editor, "/");

  assert.deepEqual(editor.lines, ["- [ ] task"]);
  assert.deepEqual(editor.selection, {
    from: { line: 0, ch: 6 },
    to: { line: 0, ch: 6 },
  });
});

test("toggleTaskStatus turns a done marker back into an unchecked task", () => {
  const editor = createMockEditor(["- [x] task"], {
    from: { line: 0, ch: 6 },
    to: { line: 0, ch: 6 },
  });

  toggleTaskStatus(editor, "x");

  assert.deepEqual(editor.lines, ["- [ ] task"]);
  assert.deepEqual(editor.selection, {
    from: { line: 0, ch: 6 },
    to: { line: 0, ch: 6 },
  });
});

test("toggleTaskStatus inserts an unchecked task on blank lines for the done shortcut", () => {
  const editor = createMockEditor([""], {
    from: { line: 0, ch: 0 },
    to: { line: 0, ch: 0 },
  });

  toggleTaskStatus(editor, "x");

  assert.deepEqual(editor.lines, ["- [ ] "]);
  assert.deepEqual(editor.selection, {
    from: { line: 0, ch: 6 },
    to: { line: 0, ch: 6 },
  });
});

test("toggleTaskStatus clears an empty checkbox line for the done shortcut", () => {
  const editor = createMockEditor(["- [ ] "], {
    from: { line: 0, ch: 6 },
    to: { line: 0, ch: 6 },
  });

  toggleTaskStatus(editor, "x");

  assert.deepEqual(editor.lines, [""]);
  assert.deepEqual(editor.selection, {
    from: { line: 0, ch: 0 },
    to: { line: 0, ch: 0 },
  });
});

test("toggleTaskStatus applies line-by-line across a selection without touching the trailing line at ch 0", () => {
  const editor = createMockEditor(
    ["- [/] task", "plain text", "leave alone"],
    {
      from: { line: 0, ch: 0 },
      to: { line: 2, ch: 0 },
    }
  );

  toggleTaskStatus(editor, "/");

  assert.deepEqual(editor.lines, [
    "- [ ] task",
    "- [/] plain text",
    "leave alone",
  ]);
  assert.deepEqual(editor.selection, {
    from: { line: 0, ch: 0 },
    to: { line: 2, ch: 0 },
  });
});

test("applyTaskStatusCommandToEditor moves an in-progress task to the front of its current branch", () => {
  const editor = createMockEditor(
    ["- [ ] later", "- [ ] now", "- [x] done"],
    {
      from: { line: 1, ch: 4 },
      to: { line: 1, ch: 4 },
    }
  );

  applyTaskStatusCommandToEditor(editor, "/", true);

  assert.deepEqual(editor.lines, [
    "- [/] now",
    "- [ ] later",
    "- [x] done",
  ]);
  assert.deepEqual(editor.selection, {
    from: { line: 0, ch: 4 },
    to: { line: 0, ch: 4 },
  });
});

test("applyTaskStatusCommandToEditor places a new in-progress task after existing in-progress siblings", () => {
  const editor = createMockEditor(
    ["- [/] started", "- [ ] later", "- [ ] now", "- [x] done"],
    {
      from: { line: 2, ch: 4 },
      to: { line: 2, ch: 4 },
    }
  );

  applyTaskStatusCommandToEditor(editor, "/", true);

  assert.deepEqual(editor.lines, [
    "- [/] started",
    "- [/] now",
    "- [ ] later",
    "- [x] done",
  ]);
  assert.deepEqual(editor.selection, {
    from: { line: 1, ch: 4 },
    to: { line: 1, ch: 4 },
  });
});

test("applyTaskStatusCommandToEditor moves a done task to the bottom of its current branch", () => {
  const editor = createMockEditor(
    ["- [/] now", "- [ ] later", "- [x] done"],
    {
      from: { line: 0, ch: 6 },
      to: { line: 0, ch: 6 },
    }
  );

  applyTaskStatusCommandToEditor(editor, "x", true);

  assert.deepEqual(editor.lines, [
    "- [ ] later",
    "- [x] done",
    "- [x] now",
  ]);
  assert.deepEqual(editor.selection, {
    from: { line: 2, ch: 6 },
    to: { line: 2, ch: 6 },
  });
});

test("applyTaskStatusCommandToEditor places a new done task after existing completed siblings", () => {
  const editor = createMockEditor(
    ["- [/] now", "- [x] done 1", "- [x] done 2"],
    {
      from: { line: 0, ch: 6 },
      to: { line: 0, ch: 6 },
    }
  );

  applyTaskStatusCommandToEditor(editor, "x", true);

  assert.deepEqual(editor.lines, [
    "- [x] done 1",
    "- [x] done 2",
    "- [x] now",
  ]);
  assert.deepEqual(editor.selection, {
    from: { line: 2, ch: 6 },
    to: { line: 2, ch: 6 },
  });
});

test("applyTaskStatusCommandToEditor places a new done subtask after existing completed siblings", () => {
  const editor = createMockEditor(
    [
      "- [ ] parent",
      "  - [ ] later",
      "    later child",
      "  - [x] done",
      "    done child",
      "  - [ ] now",
      "    now child",
    ],
    {
      from: { line: 5, ch: 6 },
      to: { line: 5, ch: 6 },
    }
  );

  applyTaskStatusCommandToEditor(editor, "x", true);

  assert.deepEqual(editor.lines, [
    "- [ ] parent",
    "  - [ ] later",
    "    later child",
    "  - [x] done",
    "    done child",
    "  - [x] now",
    "    now child",
  ]);
  assert.deepEqual(editor.selection, {
    from: { line: 5, ch: 6 },
    to: { line: 5, ch: 6 },
  });
});

test("markAncestorTasksInLineArray marks each ancestor as in progress", () => {
  const lines = [
    "- [ ] top",
    "  - [ ] middle",
    "    - [/] child",
    "      note that should stay as text",
    "- [ ] sibling",
  ];

  const changedLineNumbers = markAncestorTasksInLineArray(lines, 2);

  assert.deepEqual(changedLineNumbers, [1, 0]);
  assert.deepEqual(lines, [
    "- [/] top",
    "  - [/] middle",
    "    - [/] child",
    "      note that should stay as text",
    "- [ ] sibling",
  ]);
});

test("applyTaskStatusCommandToEditor marks ancestor tasks in progress when a child starts", () => {
  const editor = createMockEditor(
    [
      "- [ ] top later",
      "- [ ] parent",
      "  - [ ] child later",
      "  - [ ] child now",
      "- [x] done",
    ],
    {
      from: { line: 3, ch: 6 },
      to: { line: 3, ch: 6 },
    }
  );

  applyTaskStatusCommandToEditor(editor, "/", true);

  assert.deepEqual(editor.lines, [
    "- [/] parent",
    "  - [/] child now",
    "  - [ ] child later",
    "- [ ] top later",
    "- [x] done",
  ]);
  assert.deepEqual(editor.selection, {
    from: { line: 1, ch: 6 },
    to: { line: 1, ch: 6 },
  });
});

test("completeDescendantTasksInLineArray marks descendant tasks done without touching sibling branches", () => {
  const lines = [
    "- [x] parent",
    "  - [ ] child 1",
    "    note that should stay as text",
    "  - [/] child 2",
    "    - [ ] grandchild",
    "",
    "- [ ] sibling",
  ];

  const changedLineNumbers = completeDescendantTasksInLineArray(lines, 0);

  assert.deepEqual(changedLineNumbers, [1, 3, 4]);
  assert.deepEqual(lines, [
    "- [x] parent",
    "  - [x] child 1",
    "    note that should stay as text",
    "  - [x] child 2",
    "    - [x] grandchild",
    "",
    "- [ ] sibling",
  ]);
});

test("applyTaskStatusCommandToEditor marks descendant tasks done when a parent is completed", () => {
  const editor = createMockEditor(
    [
      "- [ ] parent",
      "  - [ ] child 1",
      "    child note",
      "  - [/] child 2",
      "    - [ ] grandchild",
      "- [ ] sibling",
    ],
    {
      from: { line: 0, ch: 6 },
      to: { line: 0, ch: 6 },
    }
  );

  applyTaskStatusCommandToEditor(editor, "x", true);

  assert.deepEqual(editor.lines, [
    "- [ ] sibling",
    "- [x] parent",
    "  - [x] child 1",
    "    child note",
    "  - [x] child 2",
    "    - [x] grandchild",
  ]);
  assert.deepEqual(editor.selection, {
    from: { line: 1, ch: 6 },
    to: { line: 1, ch: 6 },
  });
});

test("extractRhythmsDailyTasks keeps only top-level Daily tasks and clears their status", () => {
  const tracksContent = [
    "## Active",
    "",
    "- something else",
    "",
    "## Rhythms",
    "",
    "**Daily**",
    "- [x] 起床任务",
    "  - [/] 子项目会被忽略",
    "    deeper child",
    "- [/] 读三篇论文",
    "",
    "**Weekly**",
    "- 周一讨论班",
  ].join("\n");

  assert.deepEqual(extractRhythmsDailyTasks(tracksContent), [
    "起床任务",
    "读三篇论文",
  ]);
});

test("replaceCurrentDailySection only rewrites the 日常 block", () => {
  const currentContent = [
    "",
    "**今日：不能偏离主线**",
    "",
    "**日常**",
    "",
    "- [x] 昨天的日常",
    "- [/] 另一个昨天的日常",
    "",
    "**主线**",
    "",
    "- [/] 重构 tracks 系统",
    "",
    "**支线**",
    "",
    "- [ ] 休学流程",
    "",
  ].join("\n");

  const updated = replaceCurrentDailySection(currentContent, [
    "起床任务",
    "读三篇论文",
  ]);

  assert.equal(updated, [
    "",
    "**今日：不能偏离主线**",
    "",
    "**日常**",
    "",
    "- [ ] 起床任务",
    "- [ ] 读三篇论文",
    "",
    "**主线**",
    "",
    "- [/] 重构 tracks 系统",
    "",
    "**支线**",
    "",
    "- [ ] 休学流程",
    "",
  ].join("\n"));
});

test("buildRefreshedCurrentContent rebuilds 日常 from Rhythms/Daily", () => {
  const currentContent = [
    "**日常**",
    "",
    "- [x] old",
    "  - [ ] child to drop",
    "",
    "**主线**",
    "",
    "- [x] drop done root",
    "  - [ ] dropped child",
    "- [/] keep parent",
    "  - [x] done child",
    "  - [ ] keep child",
    "- [ ] keep root",
    "",
    "**支线**",
    "",
    "- [x] drop done side root",
    "- [ ] keep side root",
    "  - [x] drop side child",
    "  - [/] keep side child",
  ].join("\n");
  const tracksContent = [
    "## Rhythms",
    "",
    "**Daily**",
    "- [x] 起床任务",
    "  - [ ] ignored child",
    "- 读三篇论文",
    "",
    "**Weekly**",
  ].join("\n");

  assert.equal(
    buildRefreshedCurrentContent(currentContent, tracksContent),
    [
      "**日常**",
      "",
      "- [ ] 起床任务",
      "- [ ] 读三篇论文",
      "",
      "**主线**",
      "",
      "- [/] keep parent",
      "  - [ ] keep child",
      "- [ ] keep root",
      "",
      "**支线**",
      "",
      "- [ ] keep side root",
      "  - [/] keep side child",
    ].join("\n")
  );
});

test("buildRefreshedCurrentContent keeps a single blank gap when Rhythms/Daily is empty", () => {
  const currentContent = [
    "**日常**",
    "",
    "- [x] old",
    "",
    "**主线**",
    "",
    "- [ ] keep",
    "",
    "**支线**",
    "",
    "- [x] drop",
  ].join("\n");
  const tracksContent = [
    "## Rhythms",
    "",
    "**Daily**",
    "",
    "**Weekly**",
  ].join("\n");

  assert.equal(
    buildRefreshedCurrentContent(currentContent, tracksContent),
    [
      "**日常**",
      "",
      "**主线**",
      "",
      "- [ ] keep",
      "",
      "**支线**",
      "",
    ].join("\n")
  );
});

test("shouldRefreshCurrentDailySection only allows one refresh per Beijing day", () => {
  assert.equal(shouldRefreshCurrentDailySection("2026-04-23", "2026-04-23"), false);
  assert.equal(shouldRefreshCurrentDailySection("2026-04-22", "2026-04-23"), true);
  assert.equal(shouldRefreshCurrentDailySection(undefined, "2026-04-23"), true);
});

test("getTodayDateStr uses the configured timezone instead of UTC", () => {
  const date = new Date("2026-04-22T16:30:00.000Z");

  assert.equal(getTodayDateStr("Asia/Shanghai", date), "2026-04-23");
  assert.equal(getTodayDateStr("UTC", date), "2026-04-22");
});

test("refreshCurrentDailySection only allows one manual refresh per Beijing day", async () => {
  const fileContents = new Map([
    [
      "tracks/tracks.md",
      [
        "## Rhythms",
        "",
        "**Daily**",
        "",
        "- [x] 起床任务",
        "  - [x] 不应保留的子项目",
        "- [/] 读三篇论文",
        "",
      ].join("\n"),
    ],
    [
      "tracks/current.md",
      [
        "**今日：验证手动刷新**",
        "",
        "**日常**",
        "",
        "- [x] 旧的日常",
        "  - [/] 旧的子项目",
        "",
        "**主线**",
        "",
        "- [x] 已完成主线",
        "- [/] 保留中的主线",
        "  - [x] 已完成子项目",
        "  - [ ] 未完成子项目",
        "",
        "**支线**",
        "",
        "- [ ] 保留中的支线",
        "",
      ].join("\n"),
    ],
  ]);

  const app = {
    vault: {
      getAbstractFileByPath(path) {
        return fileContents.has(path) ? { path } : null;
      },
      async read(file) {
        return fileContents.get(file.path);
      },
      async process(file, updater) {
        fileContents.set(file.path, updater(fileContents.get(file.path)));
      },
    },
  };
  const pluginData = {};
  const saveDataCalls = [];

  const expectedCurrent = [
    "**今日：验证手动刷新**",
    "",
    "**日常**",
    "",
    "- [ ] 起床任务",
    "- [ ] 读三篇论文",
    "",
    "**主线**",
    "",
    "- [/] 保留中的主线",
    "  - [ ] 未完成子项目",
    "",
    "**支线**",
    "",
    "- [ ] 保留中的支线",
    "",
  ].join("\n");

  assert.equal(await refreshCurrentDailySection(app, pluginData, async (data) => {
    saveDataCalls.push({ ...data });
  }), true);
  assert.equal(fileContents.get("tracks/current.md"), expectedCurrent);
  assert.equal(pluginData.lastCurrentDailySyncDate, getTodayDateStr());
  assert.deepEqual(saveDataCalls, [{ lastCurrentDailySyncDate: getTodayDateStr() }]);
  assert.equal(await refreshCurrentDailySection(app, pluginData, async (data) => {
    saveDataCalls.push({ ...data });
  }), false);
  assert.equal(fileContents.get("tracks/current.md"), expectedCurrent);
  assert.deepEqual(saveDataCalls, [{ lastCurrentDailySyncDate: getTodayDateStr() }]);
});

test("isCurrentTracksFile only matches tracks/current.md", () => {
  assert.equal(isCurrentTracksFile({ path: "tracks/current.md" }), true);
  assert.equal(isCurrentTracksFile({ path: "tracks/tracks.md" }), false);
  assert.equal(isCurrentTracksFile(null), false);
});

test("syncDailyRefreshHeaderActions adds a header action only for tracks/current.md and removes stale ones", () => {
  const currentLeaf = createMockLeaf("tracks/current.md");
  const otherLeaf = createMockLeaf("notes/other.md");
  const plugin = {
    app: {
      workspace: {
        iterateAllLeaves(callback) {
          callback(currentLeaf);
          callback(otherLeaf);
        },
      },
    },
    currentDailyHeaderActions: new Map(),
    data: {},
    saveDataCalls: [],
    async saveData(data) {
      this.saveDataCalls.push(data);
    },
  };

  syncDailyRefreshHeaderActions(plugin, plugin.data);

  assert.equal(currentLeaf.actionElements.length, 1);
  assert.equal(otherLeaf.actionElements.length, 0);
  assert.equal(plugin.currentDailyHeaderActions.get(currentLeaf), currentLeaf.actionElements[0]);

  currentLeaf.view.file = { path: "notes/switched.md" };
  syncDailyRefreshHeaderActions(plugin, plugin.data);

  assert.equal(currentLeaf.actionElements[0].removeCalled, true);
  assert.equal(plugin.currentDailyHeaderActions.has(currentLeaf), false);
});

test("addDailyRefreshHeaderAction reuses the existing connected action and removeDailyRefreshHeaderAction detaches it", () => {
  const leaf = createMockLeaf("tracks/current.md");
  const plugin = {
    app: {},
    data: {},
    currentDailyHeaderActions: new Map(),
    async saveData() {},
  };

  const firstAction = addDailyRefreshHeaderAction(plugin, leaf, plugin.data);
  const secondAction = addDailyRefreshHeaderAction(plugin, leaf, plugin.data);

  assert.equal(firstAction, secondAction);
  assert.equal(leaf.actionElements.length, 1);

  removeDailyRefreshHeaderAction(plugin, leaf);

  assert.equal(firstAction.removeCalled, true);
  assert.equal(plugin.currentDailyHeaderActions.has(leaf), false);
});
