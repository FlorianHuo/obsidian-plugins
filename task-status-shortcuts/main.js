let PluginClass = class {};
let MarkdownViewClass = class {};
let NoticeClass = class {};
let ChangeSetClass = null;
let EditorSelectionClass = null;
let EditorStateClass = null;

try {
  ({
    Plugin: PluginClass,
    MarkdownView: MarkdownViewClass,
    Notice: NoticeClass,
  } = require("obsidian"));
} catch (error) {
  // Allow local checks and tests outside Obsidian.
}

try {
  ({
    ChangeSet: ChangeSetClass,
    EditorSelection: EditorSelectionClass,
    EditorState: EditorStateClass,
  } = require("@codemirror/state"));
} catch (error) {
  // Allow local checks and tests outside Obsidian.
}

function createInlineTaskSortHelpers() {
  const TASK_LINE_RE = /^(\s*)-\s*\[([^\]])\]/;
  const TASK_PARTS_RE = /^(\s*-\s*\[)([^\]])\](.*)$/;

  function matchTaskLine(line) {
    return line.match(TASK_LINE_RE);
  }

  function parseTaskLineParts(line) {
    return line.match(TASK_PARTS_RE);
  }

  function isCompletedTaskMarker(marker) {
    return typeof marker === "string" && marker.toLowerCase() === "x";
  }

  function isTaskLine(line) {
    return TASK_LINE_RE.test(line);
  }

  function getIndent(line) {
    const match = line.match(/^(\s*)/);
    return match ? match[1] : "";
  }

  function parseTokens(lines, startIndex, baseIndent) {
    const tokens = [];
    let i = startIndex;

    while (i < lines.length) {
      const line = lines[i];

      if (line.trim() === "") {
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === "") j++;
        if (j < lines.length) {
          const nextTaskMatch = matchTaskLine(lines[j]);
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

      const taskMatch = matchTaskLine(line);
      if (taskMatch && taskMatch[1] === baseIndent) {
        const isCompleted = isCompletedTaskMarker(taskMatch[2]);
        const taskLines = [line];
        i++;

        while (i < lines.length) {
          if (lines[i].trim() === "") break;
          const indent = getIndent(lines[i]);
          if (indent.length > baseIndent.length) {
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

  function annotateTokenLineRanges(tokens) {
    let startLine = 0;

    for (const token of tokens) {
      token.startLine = startLine;
      token.endLine = startLine + token.lines.length - 1;
      startLine = token.endLine + 1;
    }
  }

  function findTokenAtLine(tokens, lineOffset) {
    return (
      tokens.find(
        (token) => lineOffset >= token.startLine && lineOffset <= token.endLine
      ) || null
    );
  }

  function buildSortedTaskList(tokens, preferredFrontTasks, preferredBackTasks) {
    const tasks = tokens.filter((token) => token.type === "task");
    const preferredIncomplete = tasks.filter(
      (task) => preferredFrontTasks.has(task) && !task.isCompleted
    );
    const remainingIncomplete = tasks.filter(
      (task) => !task.isCompleted && !preferredFrontTasks.has(task)
    );
    const remainingComplete = tasks.filter(
      (task) => task.isCompleted && !preferredBackTasks.has(task)
    );
    const preferredComplete = tasks.filter(
      (task) => preferredBackTasks.has(task) && task.isCompleted
    );

    return [
      ...preferredIncomplete,
      ...remainingIncomplete,
      ...remainingComplete,
      ...preferredComplete,
    ];
  }

  function sortTaskRegionLines(
    regionLines,
    baseIndent,
    preferredFrontLineOffsets = [],
    preferredBackLineOffsets = []
  ) {
    const { tokens } = parseTokens(regionLines, 0, baseIndent);
    annotateTokenLineRanges(tokens);

    const preferredFrontTasks = new Set();
    for (const lineOffset of preferredFrontLineOffsets) {
      const token = findTokenAtLine(tokens, lineOffset);
      if (token && token.type === "task") {
        preferredFrontTasks.add(token);
      }
    }

    const preferredBackTasks = new Set();
    for (const lineOffset of preferredBackLineOffsets) {
      const token = findTokenAtLine(tokens, lineOffset);
      if (token && token.type === "task") {
        preferredBackTasks.add(token);
      }
    }

    const sortedTasks = buildSortedTaskList(
      tokens,
      preferredFrontTasks,
      preferredBackTasks
    );
    const newStartLineByToken = new Map();
    const newLines = [];
    let taskIndex = 0;
    let currentLine = 0;

    for (const token of tokens) {
      const emittedToken =
        token.type === "task" ? sortedTasks[taskIndex++] : token;
      newStartLineByToken.set(emittedToken, currentLine);
      newLines.push(...emittedToken.lines);
      currentLine += emittedToken.lines.length;
    }

    return {
      tokens,
      newLines,
      newStartLineByToken,
    };
  }

  function findSortableTaskRegionInLines(lines, lineIndex) {
    const line = lines[lineIndex];
    const taskMatch = line ? matchTaskLine(line) : null;
    if (!taskMatch) return null;

    const baseIndent = taskMatch[1];
    const baseIndentLength = baseIndent.length;
    let startLine = lineIndex;

    while (startLine > 0) {
      const prev = lines[startLine - 1];
      const prevTask = matchTaskLine(prev);
      const prevIndent = getIndent(prev);

      if (prev.trim() === "") {
        startLine -= 1;
        continue;
      }

      if (prevIndent.length > baseIndentLength) {
        startLine -= 1;
        continue;
      }

      if (prevTask && prevTask[1] === baseIndent) {
        startLine -= 1;
        continue;
      }

      break;
    }

    while (startLine <= lineIndex) {
      const startTask = matchTaskLine(lines[startLine]);
      if (startTask && startTask[1] === baseIndent) break;
      startLine += 1;
    }

    let endLine = lineIndex;
    while (endLine < lines.length - 1) {
      const next = lines[endLine + 1];
      const nextTask = matchTaskLine(next);
      const nextIndent = getIndent(next);

      if (next.trim() === "") {
        endLine += 1;
        continue;
      }

      if (nextIndent.length > baseIndentLength) {
        endLine += 1;
        continue;
      }

      if (nextTask && nextTask[1] === baseIndent) {
        endLine += 1;
        continue;
      }

      break;
    }

    while (endLine >= startLine && lines[endLine].trim() === "") {
      endLine -= 1;
    }

    if (endLine < startLine) return null;

    return {
      startLine,
      endLine,
      baseIndent,
    };
  }

  function mapPositionThroughSortedRegion(
    position,
    regionStartLine,
    regionEndLine,
    tokens,
    newStartLineByToken,
    sortedLines
  ) {
    if (position.line < regionStartLine || position.line > regionEndLine) {
      return position;
    }

    const lineOffset = position.line - regionStartLine;
    const token = findTokenAtLine(tokens, lineOffset);
    if (!token) return position;

    const newTokenStart = newStartLineByToken.get(token);
    if (typeof newTokenStart !== "number") return position;

    const lineInToken = lineOffset - token.startLine;
    const mappedLine = regionStartLine + newTokenStart + lineInToken;
    const mappedLineText = sortedLines[newTokenStart + lineInToken] || "";

    return {
      line: mappedLine,
      ch: Math.min(position.ch, mappedLineText.length),
    };
  }

  function sortTaskContent(content) {
    const lines = content.split("\n");
    const newLines = [];
    let i = 0;

    while (i < lines.length) {
      if (isTaskLine(lines[i])) {
        const match = lines[i].match(/^(\s*)-\s*\[/);
        const baseIndent = match[1];
        const { tokens, nextIndex } = parseTokens(lines, i, baseIndent);
        i = nextIndex;

        const sortedTasks = buildSortedTaskList(tokens, new Set(), new Set());
        let taskIndex = 0;

        for (const token of tokens) {
          if (token.type === "task") {
            const task = sortedTasks[taskIndex++];
            if (task.lines.length > 1) {
              const head = task.lines[0];
              const tail = task.lines.slice(1).join("\n");
              const sortedTail = sortTaskContent(tail);
              newLines.push(head);
              if (sortedTail !== "") {
                newLines.push(...sortedTail.split("\n"));
              }
            } else {
              newLines.push(...task.lines);
            }
          } else {
            newLines.push(...token.lines);
          }
        }
      } else {
        newLines.push(lines[i]);
        i += 1;
      }
    }

    return newLines.join("\n");
  }

  function isTaskCompletionChange(oldLine, newLine) {
    const oldParts = parseTaskLineParts(oldLine);
    const newParts = parseTaskLineParts(newLine);
    if (!oldParts || !newParts) return false;

    if (oldParts[1] !== newParts[1] || oldParts[3] !== newParts[3]) {
      return false;
    }

    return isCompletedTaskMarker(oldParts[2]) !== isCompletedTaskMarker(newParts[2]);
  }

  return {
    findSortableTaskRegionInLines,
    getIndent,
    isTaskCompletionChange,
    mapPositionThroughSortedRegion,
    matchTaskLine,
    parseTokens,
    sortTaskContent,
    sortTaskRegionLines,
  };
}

function loadTaskSortHelpers() {
  try {
    return require("./task-sort");
  } catch (error) {
    console.error(
      "task-status-shortcuts: failed to load task-sort.js, using inline fallback",
      error
    );
    return createInlineTaskSortHelpers();
  }
}

const {
  findSortableTaskRegionInLines,
  getIndent,
  isTaskCompletionChange,
  mapPositionThroughSortedRegion,
  matchTaskLine,
  parseTokens,
  sortTaskContent,
  sortTaskRegionLines,
} = loadTaskSortHelpers();

const TASK_ITEM_RE = /^(\s*(?:[-*+]|\d+\.)\s+)\[([^\]]?)\](.*)$/;
const BARE_TASK_RE = /^(\s*)\[([^\]]?)\](.*)$/;
const LIST_ITEM_RE = /^(\s*(?:[-*+]|\d+\.)\s+)(.*)$/;
const BLANK_LINE_RE = /^(\s*)$/;

function createMarkerReplacement(prefix, oldMarker, suffix, statusChar) {
  const updatedLine = `${prefix}[${statusChar}]${suffix}`;
  const markerStart = prefix.length + 1;
  const markerEnd = markerStart + oldMarker.length;
  const markerDelta = statusChar.length - oldMarker.length;

  return {
    line: updatedLine,
    mapColumn(ch) {
      if (ch <= markerStart) return ch;
      if (ch <= markerEnd) return markerStart + statusChar.length;
      return ch + markerDelta;
    },
  };
}

function createInsertedTask(prefix, remainder, statusChar) {
  const insertion = `[${statusChar}] `;
  const updatedLine = `${prefix}${insertion}${remainder}`;

  return {
    line: updatedLine,
    mapColumn(ch) {
      if (ch < prefix.length) return ch;
      return ch + insertion.length;
    },
  };
}

function createBlankTask(indent, statusChar) {
  const updatedLine = `${indent}- [${statusChar}] `;

  return {
    line: updatedLine,
    mapColumn(ch) {
      if (ch < indent.length) return ch;
      return updatedLine.length;
    },
  };
}

function createPrefixedTask(indent, content, statusChar) {
  const prefix = `- [${statusChar}] `;
  const updatedLine = `${indent}${prefix}${content}`;

  return {
    line: updatedLine,
    mapColumn(ch) {
      if (ch < indent.length) return ch;
      return ch + prefix.length;
    },
  };
}

function createIndentedBlankLine(indent) {
  return {
    line: indent,
    mapColumn(ch) {
      return Math.min(ch, indent.length);
    },
  };
}

function transformLine(line, statusChar) {
  const taskItemMatch = line.match(TASK_ITEM_RE);
  if (taskItemMatch) {
    return createMarkerReplacement(
      taskItemMatch[1],
      taskItemMatch[2],
      taskItemMatch[3],
      statusChar
    );
  }

  const bareTaskMatch = line.match(BARE_TASK_RE);
  if (bareTaskMatch) {
    return createMarkerReplacement(
      bareTaskMatch[1],
      bareTaskMatch[2],
      bareTaskMatch[3],
      statusChar
    );
  }

  const listItemMatch = line.match(LIST_ITEM_RE);
  if (listItemMatch) {
    return createInsertedTask(listItemMatch[1], listItemMatch[2], statusChar);
  }

  const blankLineMatch = line.match(BLANK_LINE_RE);
  if (blankLineMatch) {
    return createBlankTask(blankLineMatch[1], statusChar);
  }

  const indentMatch = line.match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[1] : "";
  const content = line.slice(indent.length).trimStart();
  return createPrefixedTask(indent, content, statusChar);
}

function applyStatusToLine(line, statusChar) {
  return transformLine(line, statusChar).line;
}

function transformToggledLine(line, statusChar) {
  const blankLineMatch = line.match(BLANK_LINE_RE);
  if (blankLineMatch) {
    const blankStatus = statusChar.toLowerCase() === "x" ? " " : statusChar;
    return createBlankTask(blankLineMatch[1], blankStatus);
  }

  const taskItemMatch = line.match(TASK_ITEM_RE);
  if (
    taskItemMatch &&
    statusChar.toLowerCase() === "x" &&
    taskItemMatch[2] === " " &&
    taskItemMatch[3].trim() === ""
  ) {
    const indentMatch = taskItemMatch[1].match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : "";
    return createIndentedBlankLine(indent);
  }

  if (taskItemMatch && taskItemMatch[2] === statusChar) {
    return createMarkerReplacement(
      taskItemMatch[1],
      taskItemMatch[2],
      taskItemMatch[3],
      " "
    );
  }

  const bareTaskMatch = line.match(BARE_TASK_RE);
  if (bareTaskMatch && bareTaskMatch[2] === statusChar) {
    return createMarkerReplacement(
      bareTaskMatch[1],
      bareTaskMatch[2],
      bareTaskMatch[3],
      " "
    );
  }

  return transformLine(line, statusChar);
}

function toggleStatusOnLine(line, statusChar) {
  return transformToggledLine(line, statusChar).line;
}

function getSelectedLineRange(editor) {
  const from = editor.getCursor("from");
  const to = editor.getCursor("to");
  const isSelection = from.line !== to.line || from.ch !== to.ch;

  let startLine = Math.min(from.line, to.line);
  let endLine = Math.max(from.line, to.line);

  if (isSelection && to.ch === 0) {
    endLine = Math.max(startLine, endLine - 1);
  }

  return { from, to, isSelection, startLine, endLine };
}

function remapPosition(position, startLine, transformedLines) {
  const lineInfo = transformedLines[position.line - startLine];
  if (!lineInfo) return position;

  return {
    line: position.line,
    ch: Math.min(lineInfo.mapColumn(position.ch), lineInfo.line.length),
  };
}

function getEditorLineCount(editor) {
  if (typeof editor.lineCount === "function") {
    return editor.lineCount();
  }

  if (Array.isArray(editor.lines)) {
    return editor.lines.length;
  }

  return 0;
}

function updateEditorLines(editor, lineTransformer) {
  const { from, to, isSelection, startLine, endLine } = getSelectedLineRange(editor);
  const transformedLines = [];
  const changedLineNumbers = [];

  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    const currentLine = editor.getLine(lineNumber);
    const transformed = lineTransformer(currentLine, lineNumber);
    transformedLines.push({
      ...transformed,
      previousLine: currentLine,
      lineNumber,
    });
    if (transformed.line !== currentLine) {
      editor.setLine(lineNumber, transformed.line);
      changedLineNumbers.push(lineNumber);
    }
  }

  const mappedFrom = remapPosition(from, startLine, transformedLines);
  const mappedTo = remapPosition(to, startLine, transformedLines);

  if (!isSelection) {
    editor.setCursor(mappedFrom);
  } else {
    editor.setSelection(mappedFrom, mappedTo);
  }

  return {
    changedLineNumbers,
    from: mappedFrom,
    isSelection,
    startLine,
    endLine,
    to: mappedTo,
    transformedLines,
  };
}

function setTaskStatus(editor, statusChar) {
  return updateEditorLines(editor, (line) => transformLine(line, statusChar));
}

function toggleTaskStatus(editor, statusChar) {
  return updateEditorLines(editor, (line) => transformToggledLine(line, statusChar));
}

function sortEditorTaskRegions(
  editor,
  lineNumbers,
  preferredFrontLineNumbers = [],
  preferredBackLineNumbers = []
) {
  if (!lineNumbers.length) return;

  const lineCount = getEditorLineCount(editor);
  if (lineCount === 0) return;

  const allLines = Array.from({ length: lineCount }, (_, index) =>
    editor.getLine(index)
  );
  const preferredFrontSet = new Set(preferredFrontLineNumbers);
  const preferredBackSet = new Set(preferredBackLineNumbers);
  const regions = new Map();

  for (const lineNumber of lineNumbers) {
    const region = findSortableTaskRegionInLines(allLines, lineNumber);
    if (!region) continue;

    const key = `${region.startLine}:${region.endLine}`;
    if (!regions.has(key)) {
      regions.set(key, {
        ...region,
        preferredBackLineOffsets: [],
        preferredFrontLineOffsets: [],
      });
    }

    if (preferredFrontSet.has(lineNumber)) {
      regions
        .get(key)
        .preferredFrontLineOffsets.push(lineNumber - region.startLine);
    }

    if (preferredBackSet.has(lineNumber)) {
      regions
        .get(key)
        .preferredBackLineOffsets.push(lineNumber - region.startLine);
    }
  }

  if (regions.size === 0) return;

  let from = editor.getCursor("from");
  let to = editor.getCursor("to");
  const isSelection = from.line !== to.line || from.ch !== to.ch;

  for (const region of [...regions.values()].sort((a, b) => a.startLine - b.startLine)) {
    const regionLines = allLines.slice(region.startLine, region.endLine + 1);
    const {
      tokens,
      newLines,
      newStartLineByToken,
    } = sortTaskRegionLines(
      regionLines,
      region.baseIndent,
      region.preferredFrontLineOffsets,
      region.preferredBackLineOffsets
    );

    const isUnchanged =
      regionLines.length === newLines.length &&
      regionLines.every((line, index) => line === newLines[index]);
    if (isUnchanged) continue;

    from = mapPositionThroughSortedRegion(
      from,
      region.startLine,
      region.endLine,
      tokens,
      newStartLineByToken,
      newLines
    );
    to = mapPositionThroughSortedRegion(
      to,
      region.startLine,
      region.endLine,
      tokens,
      newStartLineByToken,
      newLines
    );

    for (let index = 0; index < newLines.length; index += 1) {
      const lineNumber = region.startLine + index;
      if (allLines[lineNumber] !== newLines[index]) {
        editor.setLine(lineNumber, newLines[index]);
        allLines[lineNumber] = newLines[index];
      }
    }
  }

  if (!isSelection) {
    editor.setCursor(from);
    return;
  }

  editor.setSelection(from, to);
}

function applyTaskStatusCommandToEditor(editor, statusChar, isToggle) {
  const update = isToggle
    ? toggleTaskStatus(editor, statusChar)
    : setTaskStatus(editor, statusChar);
  const preferredBackLineNumbers = [];
  const preferredFrontLineNumbers = [];
  const affectedTaskLines = [];

  for (const transformed of update.transformedLines) {
    if (transformed.line === transformed.previousLine) continue;

    const taskMatch = matchTaskLine(transformed.line);
    if (!taskMatch) continue;

    affectedTaskLines.push(transformed.lineNumber);
    if (taskMatch[2] === "/") {
      preferredFrontLineNumbers.push(transformed.lineNumber);
    }
    if (taskMatch[2].toLowerCase() === "x") {
      preferredBackLineNumbers.push(transformed.lineNumber);
    }
  }

  sortEditorTaskRegions(
    editor,
    affectedTaskLines,
    preferredFrontLineNumbers,
    preferredBackLineNumbers
  );

  return update;
}

function getActiveMarkdownView(app) {
  if (
    !app ||
    !app.workspace ||
    typeof app.workspace.getActiveViewOfType !== "function"
  ) {
    return null;
  }

  const activeView = app.workspace.getActiveViewOfType(MarkdownViewClass);
  if (activeView) return activeView;

  if (typeof app.workspace.getMostRecentLeaf === "function") {
    const leaf = app.workspace.getMostRecentLeaf();
    if (leaf && leaf.view instanceof MarkdownViewClass) {
      return leaf.view;
    }
  }

  return null;
}

function getActiveMarkdownEditor(app) {
  const view = getActiveMarkdownView(app);
  if (!view) return null;
  if (typeof view.getMode === "function" && view.getMode() !== "source") {
    return null;
  }

  return view.editor || null;
}

function ensureEditableMarkdownEditor(app) {
  const view = getActiveMarkdownView(app);
  if (!view) return null;

  if (typeof view.getMode === "function" && view.getMode() === "preview") {
    app.commands.executeCommandById("markdown:toggle-preview");
  }

  app.commands.executeCommandById("editor:focus");
  return getActiveMarkdownEditor(app);
}

function getCheckboxToggleInfo(tr) {
  if (!tr.docChanged) return null;

  const toggles = [];
  let isValidToggle = true;

  tr.changes.iterChanges((fromA, toA, fromB) => {
    if (!isValidToggle) return;

    const oldLine = tr.startState.doc.lineAt(fromA);
    const newLine = tr.newDoc.lineAt(fromB);
    if (!isTaskCompletionChange(oldLine.text, newLine.text)) {
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

function findSortableTaskRegion(doc, lineNumber) {
  const line = doc.line(lineNumber);
  const taskMatch = matchTaskLine(line.text);
  if (!taskMatch) return null;

  const baseIndent = taskMatch[1];
  const baseIndentLength = baseIndent.length;
  let start = lineNumber;

  while (start > 1) {
    const prev = doc.line(start - 1);
    const prevTask = matchTaskLine(prev.text);
    const prevIndent = getIndent(prev.text);

    if (prev.text.trim() === "") {
      start -= 1;
      continue;
    }

    if (prevIndent.length > baseIndentLength) {
      start -= 1;
      continue;
    }

    if (prevTask && prevTask[1] === baseIndent) {
      start -= 1;
      continue;
    }

    break;
  }

  while (start <= lineNumber) {
    const startTask = matchTaskLine(doc.line(start).text);
    if (startTask && startTask[1] === baseIndent) break;
    start += 1;
  }

  let end = lineNumber;
  while (end < doc.lines) {
    const next = doc.line(end + 1);
    const nextTask = matchTaskLine(next.text);
    const nextIndent = getIndent(next.text);

    if (next.text.trim() === "") {
      end += 1;
      continue;
    }

    if (nextIndent.length > baseIndentLength) {
      end += 1;
      continue;
    }

    if (nextTask && nextTask[1] === baseIndent) {
      end += 1;
      continue;
    }

    break;
  }

  while (end >= start && doc.line(end).text.trim() === "") {
    end -= 1;
  }

  if (end < start) return null;

  return {
    from: doc.line(start).from,
    to: end < doc.lines ? doc.line(end + 1).from : doc.line(end).to,
    baseIndent,
  };
}

function collectTaskBlocks(regionText, baseIndent) {
  const lines = regionText.split("\n");
  const { tokens } = parseTokens(lines, 0, baseIndent);
  const tasks = [];
  const seen = new Map();
  let offset = 0;
  let consumedLines = 0;

  for (const token of tokens) {
    const text = token.lines.join("\n");
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

function mapPosIntoTask(pos, oldFrom, oldTo, newFrom, newTo) {
  const oldLength = Math.max(0, oldTo - oldFrom);
  const newLength = Math.max(0, newTo - newFrom);
  const offset = Math.min(Math.max(pos - oldFrom, 0), oldLength);
  return newFrom + Math.min(offset, newLength);
}

function remapSelectionIntoSortedTask(
  originalSelection,
  mappedSelection,
  region,
  regionText,
  sortedRegion,
  toggledPos
) {
  const oldTasks = collectTaskBlocks(regionText, region.baseIndent);
  const newTasks = collectTaskBlocks(sortedRegion, region.baseIndent);
  const relativeTogglePos = toggledPos - region.from;
  const oldTask = oldTasks.find(
    (task) => relativeTogglePos >= task.from && relativeTogglePos <= task.to
  );

  if (!oldTask) return mappedSelection;

  const newTask = newTasks.find(
    (task) => task.text === oldTask.text && task.occurrence === oldTask.occurrence
  );
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
  const anchor = mapPosIntoTask(
    originalMain.anchor,
    oldTaskFrom,
    oldTaskTo,
    newTaskFrom,
    newTaskTo
  );
  const head = mapPosIntoTask(
    originalMain.head,
    oldTaskFrom,
    oldTaskTo,
    newTaskFrom,
    newTaskTo
  );

  const ranges = mappedSelection.ranges.slice();
  ranges[mappedSelection.mainIndex] = EditorSelectionClass.range(
    anchor,
    head,
    originalMain.goalColumn,
    originalMain.bidiLevel,
    originalMain.assoc
  );

  return EditorSelectionClass.create(ranges, mappedSelection.mainIndex);
}

function buildTaskSortExtension() {
  if (!EditorStateClass || !ChangeSetClass || !EditorSelectionClass) {
    return null;
  }

  return EditorStateClass.transactionFilter.of((tr) => {
    const toggle = getCheckboxToggleInfo(tr);
    if (!toggle) return tr;

    const region = findSortableTaskRegion(tr.newDoc, toggle.lineNumber);
    if (!region) return tr;

    const regionText = tr.newDoc.sliceString(region.from, region.to);
    const sortedRegion = sortTaskContent(regionText);
    if (sortedRegion === regionText) return tr;

    const replacement = ChangeSetClass.of(
      [{ from: region.from, to: region.to, insert: sortedRegion }],
      tr.newDoc.length
    );
    const mappedSelection = tr.newSelection.map(replacement);
    const finalSelection = remapSelectionIntoSortedTask(
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

async function sortCurrentFile(app, silent = false) {
  const file = app.workspace.getActiveFile();
  if (!file || file.extension !== "md") return false;

  const content = await app.vault.read(file);
  const sorted = sortTaskContent(content);

  if (sorted !== content) {
    await app.vault.process(file, (data) => sortTaskContent(data));
    if (!silent) {
      new NoticeClass("Tasks auto-sorted (in-progress first, completed last)");
    }
    return true;
  }

  if (!silent) {
    new NoticeClass("No sort required: already up to date");
  }
  return false;
}

function runTaskStatusCommand(app, statusChar, isToggle) {
  const editor = ensureEditableMarkdownEditor(app);
  if (!editor) {
    new NoticeClass("Open a Markdown note in editing mode to use this command.");
    return;
  }

  applyTaskStatusCommandToEditor(editor, statusChar, isToggle);
}

class TaskStatusShortcutsPlugin extends PluginClass {
  async onload() {
    const taskSortExtension = buildTaskSortExtension();
    if (taskSortExtension) {
      this.registerEditorExtension(taskSortExtension);
    }

    this.addCommand({
      id: "set-task-status-in-progress",
      name: "Set task status to in progress ([/])",
      hotkeys: [
        {
          modifiers: ["Mod"],
          key: "/",
        },
      ],
      callback: () => {
        runTaskStatusCommand(this.app, "/", true);
      },
    });

    this.addCommand({
      id: "set-task-status-done",
      name: "Set task status to done ([x])",
      hotkeys: [
        {
          modifiers: ["Mod"],
          key: "L",
        },
      ],
      callback: () => {
        runTaskStatusCommand(this.app, "x", true);
      },
    });

    this.addCommand({
      id: "sort-current-file",
      name: "Sort tasks in current file",
      callback: () => void sortCurrentFile(this.app),
    });
  }
}

module.exports = TaskStatusShortcutsPlugin;
module.exports.default = TaskStatusShortcutsPlugin;
module.exports.applyStatusToLine = applyStatusToLine;
module.exports.applyTaskStatusCommandToEditor = applyTaskStatusCommandToEditor;
module.exports.buildTaskSortExtension = buildTaskSortExtension;
module.exports.ensureEditableMarkdownEditor = ensureEditableMarkdownEditor;
module.exports.getActiveMarkdownEditor = getActiveMarkdownEditor;
module.exports.getActiveMarkdownView = getActiveMarkdownView;
module.exports.runTaskStatusCommand = runTaskStatusCommand;
module.exports.setTaskStatus = setTaskStatus;
module.exports.sortCurrentFile = sortCurrentFile;
module.exports.sortEditorTaskRegions = sortEditorTaskRegions;
module.exports.toggleStatusOnLine = toggleStatusOnLine;
module.exports.toggleTaskStatus = toggleTaskStatus;
