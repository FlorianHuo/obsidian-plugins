const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyStatusToLine,
  applyTaskStatusCommandToEditor,
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
