let PluginClass = class {};

try {
  ({ Plugin: PluginClass } = require("obsidian"));
} catch (error) {
  // Allow local checks and tests outside Obsidian.
}

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

function setTaskStatus(editor, statusChar) {
  const { from, to, isSelection, startLine, endLine } = getSelectedLineRange(editor);
  const transformedLines = [];

  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    const currentLine = editor.getLine(lineNumber);
    const transformed = transformLine(currentLine, statusChar);
    transformedLines.push(transformed);
    if (transformed.line !== currentLine) {
      editor.setLine(lineNumber, transformed.line);
    }
  }

  const mappedFrom = remapPosition(from, startLine, transformedLines);
  const mappedTo = remapPosition(to, startLine, transformedLines);

  if (!isSelection) {
    editor.setCursor(mappedFrom);
    return;
  }

  editor.setSelection(mappedFrom, mappedTo);
}

class TaskStatusShortcutsPlugin extends PluginClass {
  async onload() {
    this.addCommand({
      id: "set-task-status-in-progress",
      name: "Set task status to in progress ([/])",
      hotkeys: [
        {
          modifiers: ["Mod"],
          key: "/",
        },
      ],
      editorCallback: (editor) => {
        setTaskStatus(editor, "/");
      },
    });
  }
}

module.exports = TaskStatusShortcutsPlugin;
module.exports.default = TaskStatusShortcutsPlugin;
module.exports.applyStatusToLine = applyStatusToLine;
module.exports.setTaskStatus = setTaskStatus;
