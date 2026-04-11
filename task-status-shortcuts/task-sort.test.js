const test = require("node:test");
const assert = require("node:assert/strict");

const {
  findSortableTaskRegionInLines,
  matchTaskLine,
  sortTaskContent,
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
