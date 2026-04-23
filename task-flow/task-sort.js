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

function isInProgressTaskMarker(marker) {
  return marker === "/";
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
      const marker = taskMatch[2];
      const isCompleted = isCompletedTaskMarker(marker);
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

      tokens.push({
        type: "task",
        marker,
        isCompleted,
        isInProgress: isInProgressTaskMarker(marker),
        lines: taskLines,
      });
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
  return tokens.find(
    (token) => lineOffset >= token.startLine && lineOffset <= token.endLine
  ) || null;
}

function buildSortedTaskList(tokens, preferredFrontTasks, preferredBackTasks) {
  const tasks = tokens.filter((token) => token.type === "task");
  const currentInProgress = tasks.filter(
    (task) =>
      task.isInProgress &&
      !task.isCompleted &&
      !preferredFrontTasks.has(task)
  );
  const preferredIncomplete = tasks.filter(
    (task) => preferredFrontTasks.has(task) && !task.isCompleted
  );
  const remainingIncomplete = tasks.filter(
    (task) =>
      !task.isCompleted &&
      !task.isInProgress &&
      !preferredFrontTasks.has(task)
  );
  const remainingComplete = tasks.filter(
    (task) => task.isCompleted && !preferredBackTasks.has(task)
  );
  const preferredComplete = tasks.filter(
    (task) => preferredBackTasks.has(task) && task.isCompleted
  );

  return [
    ...currentInProgress,
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

function preserveTrailingNewlines(sourceText, sortedText) {
  const sourceTrailingNewlineCount = sourceText.match(/\n*$/)?.[0].length ?? 0;
  const sortedTrailingNewlineCount = sortedText.match(/\n*$/)?.[0].length ?? 0;

  if (sortedTrailingNewlineCount >= sourceTrailingNewlineCount) {
    return sortedText;
  }

  return `${sortedText}${"\n".repeat(sourceTrailingNewlineCount - sortedTrailingNewlineCount)}`;
}

function sortTaskRegionText(
  regionText,
  baseIndent,
  preferredFrontLineOffsets = [],
  preferredBackLineOffsets = []
) {
  const regionLines = regionText.split("\n");
  const { newLines } = sortTaskRegionLines(
    regionLines,
    baseIndent,
    preferredFrontLineOffsets,
    preferredBackLineOffsets
  );
  return preserveTrailingNewlines(regionText, newLines.join("\n"));
}

function findSortableTaskRegionInLines(lines, lineIndex) {
  const line = lines[lineIndex];
  const taskMatch = line ? matchTaskLine(line) : null;
  if (!taskMatch) return null;

  const baseIndent = taskMatch[1];
  const baseIndentLen = baseIndent.length;
  let startLine = lineIndex;

  while (startLine > 0) {
    const prev = lines[startLine - 1];
    const prevTask = matchTaskLine(prev);
    const prevIndent = getIndent(prev);

    if (prev.trim() === "") {
      startLine -= 1;
      continue;
    }

    if (prevIndent.length > baseIndentLen) {
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

    if (nextIndent.length > baseIndentLen) {
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

function removeCompletedContent(content) {
  const lines = content.split("\n");
  const newLines = [];

  let i = 0;
  while (i < lines.length) {
    if (isTaskLine(lines[i])) {
      const match = lines[i].match(/^(\s*)-\s*\[/);
      const baseIndent = match[1];
      const { tokens, nextIndex } = parseTokens(lines, i, baseIndent);
      i = nextIndex;

      let prevWasDroppedTask = false;
      for (const tok of tokens) {
        if (tok.type === "task") {
          if (!tok.isCompleted) {
            prevWasDroppedTask = false;
            if (tok.lines.length > 1) {
              const head = tok.lines[0];
              const tail = tok.lines.slice(1).join("\n");
              const processedTail = removeCompletedContent(tail);
              newLines.push(head);
              if (processedTail !== "") {
                newLines.push(...processedTail.split("\n"));
              }
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
      i += 1;
    }
  }

  return newLines.join("\n");
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
            if (sortedTail !== "") newLines.push(...sortedTail.split("\n"));
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

  return preserveTrailingNewlines(content, newLines.join("\n"));
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

module.exports = {
  getIndent,
  isCompletedTaskMarker,
  isInProgressTaskMarker,
  isTaskCompletionChange,
  isTaskLine,
  findSortableTaskRegionInLines,
  mapPositionThroughSortedRegion,
  matchTaskLine,
  parseTaskLineParts,
  parseTokens,
  removeCompletedContent,
  sortTaskContent,
  sortTaskRegionText,
  sortTaskRegionLines,
};
