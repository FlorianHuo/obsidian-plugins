const test = require("node:test");
const assert = require("node:assert/strict");

const {
  findSortableTaskRegionInLines,
  matchTaskLine,
  sortTaskContent,
  sortTaskRegionText,
  sortTaskRegionLines,
} = require("./task-sort.js");

test("matchTaskLine recognizes in-progress tasks", () => {
  const match = matchTaskLine("- [/] task");

  assert.ok(match);
  assert.equal(match[1], "");
  assert.equal(match[2], "/");
});

test("sortTaskContent keeps in-progress tasks with incomplete tasks and moves done tasks last", () => {
  const input = ["- [x] done", "- [/] doing", "- [ ] todo"].join("\n");
  const expected = ["- [/] doing", "- [ ] todo", "- [x] done"].join("\n");

  assert.equal(sortTaskContent(input), expected);
});

test("findSortableTaskRegionInLines keeps sibling tasks in one branch", () => {
  const lines = [
    "- [ ] first",
    "  details",
    "",
    "- [/] second",
    "- [x] third",
    "outside",
  ];

  assert.deepEqual(findSortableTaskRegionInLines(lines, 3), {
    startLine: 0,
    endLine: 4,
    baseIndent: "",
  });
});

test("sortTaskRegionLines can prioritize the current in-progress task to the branch front", () => {
  const regionLines = ["- [ ] later", "- [/] now", "- [x] done"];
  const { newLines } = sortTaskRegionLines(regionLines, "", [1]);

  assert.deepEqual(newLines, [
    "- [/] now",
    "- [ ] later",
    "- [x] done",
  ]);
});

test("sortTaskRegionLines keeps a newly in-progress task below existing in-progress siblings", () => {
  const regionLines = [
    "- [/] started",
    "- [ ] later",
    "- [/] now",
    "- [x] done",
  ];
  const { newLines } = sortTaskRegionLines(regionLines, "", [2]);

  assert.deepEqual(newLines, [
    "- [/] started",
    "- [/] now",
    "- [ ] later",
    "- [x] done",
  ]);
});

test("sortTaskRegionLines keeps a newly completed task above existing completed siblings", () => {
  const regionLines = [
    "- [ ] later",
    "- [x] done",
    "- [x] now",
  ];
  const { newLines } = sortTaskRegionLines(regionLines, "", [], [1]);

  assert.deepEqual(newLines, [
    "- [ ] later",
    "- [x] done",
    "- [x] now",
  ]);
});

test("sortTaskRegionText keeps a newly completed subtask above existing completed siblings", () => {
  const input = [
    "  - [ ] later",
    "    later child",
    "  - [x] done",
    "    done child",
    "  - [x] now",
    "    now child",
  ].join("\n");
  const expected = [
    "  - [ ] later",
    "    later child",
    "  - [x] done",
    "    done child",
    "  - [x] now",
    "    now child",
  ].join("\n");

  assert.equal(sortTaskRegionText(input, "  ", [], [2]), expected);
});

test("sortTaskRegionText preserves the trailing newline of a partial region", () => {
  const input = [
    "  - [ ] later",
    "  - [x] done",
    "  - [x] now",
    "",
  ].join("\n");
  const expected = [
    "  - [ ] later",
    "  - [x] done",
    "  - [x] now",
    "",
  ].join("\n");

  assert.equal(sortTaskRegionText(input, "  ", [], [1]), expected);
});

test("sortTaskContent preserves a trailing newline", () => {
  const input = ["- [x] done", "- [ ] later", ""].join("\n");
  const expected = ["- [ ] later", "- [x] done", ""].join("\n");

  assert.equal(sortTaskContent(input), expected);
});
