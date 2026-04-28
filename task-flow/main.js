let PluginClass = class {};
let MarkdownViewClass = class {};
let NoticeClass = class {};
let ChangeSetClass = null;
let EditorSelectionClass = null;
let EditorStateClass = null;
let EditorViewClass = null;

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

try {
  ({
    EditorView: EditorViewClass,
  } = require("@codemirror/view"));
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
    return (
      tokens.find(
        (token) => lineOffset >= token.startLine && lineOffset <= token.endLine
      ) || null
    );
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
      ...preferredComplete,
      ...remainingComplete,
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

    return preserveTrailingNewlines(content, newLines.join("\n"));
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
    isCompletedTaskMarker,
    isTaskCompletionChange,
    mapPositionThroughSortedRegion,
    matchTaskLine,
    parseTokens,
    removeCompletedContent,
    sortTaskContent,
    sortTaskRegionText,
    sortTaskRegionLines,
  };
}

function loadTaskSortHelpers() {
  try {
    return require("./task-sort");
  } catch (error) {
    console.error("task-flow: failed to load task-sort.js, using inline fallback", error);
    return createInlineTaskSortHelpers();
  }
}

const {
  findSortableTaskRegionInLines,
  getIndent,
  isCompletedTaskMarker,
  isTaskCompletionChange,
  mapPositionThroughSortedRegion,
  matchTaskLine,
  parseTokens,
  removeCompletedContent,
  sortTaskContent,
  sortTaskRegionText,
  sortTaskRegionLines,
} = loadTaskSortHelpers();

const TASK_ITEM_RE = /^(\s*(?:[-*+]|\d+\.)\s+)\[([^\]]?)\](.*)$/;
const BARE_TASK_RE = /^(\s*)\[([^\]]?)\](.*)$/;
const LIST_ITEM_RE = /^(\s*(?:[-*+]|\d+\.)\s+)(.*)$/;
const BLANK_LINE_RE = /^(\s*)$/;
const CURRENT_TRACKS_FILE_PATH = "01-tracks/current.md";
const TRACKS_FILE_PATH = "01-tracks/tracks.md";
const CURRENT_DAILY_CACHE_FOLDER_PATH = "01-tracks/cache";
const SHOP_FILE_PATH = "04-governance/shop.md";
const DAILY_TIME_ZONE = "Asia/Shanghai";
const DAILY_REFRESH_ICON = "refresh-cw";
const DAILY_HEADER_ACTION_CLASS = "task-flow-refresh-current-daily";
const CURRENT_DAILY_CACHE_SECTION_NAMES = ["日常", "主线", "支线"];

function preserveTrailingNewlines(sourceText, updatedText) {
  const sourceTrailingNewlineCount = sourceText.match(/\n*$/)?.[0].length ?? 0;
  const updatedTrailingNewlineCount = updatedText.match(/\n*$/)?.[0].length ?? 0;

  if (updatedTrailingNewlineCount >= sourceTrailingNewlineCount) {
    return updatedText;
  }

  return `${updatedText}${"\n".repeat(sourceTrailingNewlineCount - updatedTrailingNewlineCount)}`;
}

function getTodayDateStr(timeZone = DAILY_TIME_ZONE, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const dateParts = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      dateParts[part.type] = part.value;
    }
  }

  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

function getCurrentDailyCacheFilePath(date = getTodayDateStr()) {
  return `${CURRENT_DAILY_CACHE_FOLDER_PATH}/${date}.md`;
}

function normalizeDailyRhythmTask(line) {
  const bulletMatch = line.match(/^\s*-\s+(.*)$/);
  if (!bulletMatch) return null;

  const rawText = bulletMatch[1].trim();
  if (rawText === "") return null;

  const checkboxMatch = rawText.match(/^\[[^\]]?\]\s*(.*)$/);
  const taskText = checkboxMatch ? checkboxMatch[1].trim() : rawText;
  return taskText === "" ? null : taskText;
}

function extractRhythmsDailyTasks(tracksContent) {
  const lines = tracksContent.split("\n");
  let foundRhythms = false;
  let foundDaily = false;
  const tasks = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!foundRhythms) {
      if (trimmed === "## Rhythms") {
        foundRhythms = true;
      }
      continue;
    }

    if (!foundDaily) {
      if (/^##\s+/.test(trimmed) && trimmed !== "## Rhythms") {
        return null;
      }
      if (trimmed === "**Daily**") {
        foundDaily = true;
      }
      continue;
    }

    if (trimmed === "") {
      continue;
    }

    if (/^##\s+/.test(trimmed) || /^\*\*.+\*\*$/.test(trimmed)) {
      break;
    }

    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : "";
    if (indent.length > 0) {
      continue;
    }

    const taskText = normalizeDailyRhythmTask(line);
    if (taskText === null) {
      return null;
    }

    tasks.push(taskText);
  }

  if (!foundRhythms || !foundDaily) {
    return null;
  }

  return tasks;
}

function renderCurrentDailySectionLines(tasks) {
  const taskLines = tasks.map((task) => `- [ ] ${task}`);
  if (taskLines.length === 0) {
    return [""];
  }

  return ["", ...taskLines, ""];
}

function findCurrentSectionRange(lines, headingText, nextHeadingText = null) {
  const headingIndex = lines.findIndex((line) => line.trim() === headingText);
  if (headingIndex === -1) return null;

  let nextHeadingIndex = lines.length;
  if (nextHeadingText !== null) {
    nextHeadingIndex = lines.findIndex(
      (line, index) => index > headingIndex && line.trim() === nextHeadingText
    );
    if (nextHeadingIndex === -1) return null;
  }

  return {
    headingIndex,
    bodyStartIndex: headingIndex + 1,
    nextHeadingIndex,
  };
}

function getSectionBodyText(lines, sectionRange) {
  return lines
    .slice(sectionRange.bodyStartIndex, sectionRange.nextHeadingIndex)
    .join("\n");
}

function replaceCurrentSectionBody(lines, sectionRange, newBodyText) {
  const newBodyLines = newBodyText === "" ? [""] : newBodyText.split("\n");
  return [
    ...lines.slice(0, sectionRange.bodyStartIndex),
    ...newBodyLines,
    ...lines.slice(sectionRange.nextHeadingIndex),
  ];
}

function replaceCurrentDailySectionLines(lines, dailyTasks) {
  const dailySection = findCurrentSectionRange(lines, "**日常**", "**主线**");
  if (!dailySection) return null;

  return replaceCurrentSectionBody(
    lines,
    dailySection,
    renderCurrentDailySectionLines(dailyTasks).join("\n")
  );
}

function replaceCurrentDailySection(currentContent, dailyTasks) {
  const lines = currentContent.split("\n");
  const updatedLines = replaceCurrentDailySectionLines(lines, dailyTasks);
  if (!updatedLines) return null;

  return preserveTrailingNewlines(currentContent, updatedLines.join("\n"));
}

function cleanCarryoverSection(lines, headingText, nextHeadingText = null) {
  const sectionRange = findCurrentSectionRange(lines, headingText, nextHeadingText);
  if (!sectionRange) return null;

  const cleanedBody = removeCompletedContent(getSectionBodyText(lines, sectionRange));
  return replaceCurrentSectionBody(lines, sectionRange, cleanedBody);
}

function normalizeTaskTextKey(text) {
  return text.trim();
}

function buildCurrentRefreshLines(currentContent, dailyTasks, options = {}) {
  const lines = currentContent.split("\n");
  const excludedDailyTasks = options.excludedDailyTasks || new Set();
  const visibleDailyTasks = dailyTasks.filter(
    (task) => !excludedDailyTasks.has(normalizeTaskTextKey(task))
  );
  const withDailyReset = replaceCurrentDailySectionLines(lines, visibleDailyTasks);
  if (!withDailyReset) return null;

  const withMainCleaned = cleanCarryoverSection(
    withDailyReset,
    "**主线**",
    "**支线**"
  );
  if (!withMainCleaned) return null;

  const withSideCleaned = cleanCarryoverSection(withMainCleaned, "**支线**");
  if (!withSideCleaned) return null;

  return withSideCleaned;
}

function buildRefreshedCurrentContent(currentContent, tracksContent, options = {}) {
  const dailyTasks = extractRhythmsDailyTasks(tracksContent);
  if (dailyTasks === null) {
    return null;
  }

  const refreshedLines = buildCurrentRefreshLines(currentContent, dailyTasks, options);
  if (!refreshedLines) {
    return null;
  }

  return preserveTrailingNewlines(currentContent, refreshedLines.join("\n"));
}

function trimBlankLines(lines) {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start].trim() === "") start += 1;
  while (end > start && lines[end - 1].trim() === "") end -= 1;

  return lines.slice(start, end);
}

function buildTaskTree(content) {
  const lines = content.split("\n");
  const root = { children: [], indentLength: -1 };
  const stack = [root];
  const nodes = [];

  for (let index = 0; index < lines.length; index += 1) {
    const taskMatch = matchTaskLine(lines[index]);
    if (!taskMatch) continue;

    const indentLength = taskMatch[1].length;
    while (
      stack.length > 1 &&
      stack[stack.length - 1].indentLength >= indentLength
    ) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    const node = {
      children: [],
      endIndex: index,
      indentLength,
      isCompleted: isCompletedTaskMarker(taskMatch[2]),
      line: lines[index],
      parent,
      startIndex: index,
    };

    parent.children.push(node);
    nodes.push(node);
    stack.push(node);
  }

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    let endIndex = lines.length - 1;

    for (let nextIndex = index + 1; nextIndex < nodes.length; nextIndex += 1) {
      if (nodes[nextIndex].indentLength <= node.indentLength) {
        endIndex = nodes[nextIndex].startIndex - 1;
        break;
      }
    }

    while (endIndex > node.startIndex && lines[endIndex].trim() === "") {
      endIndex -= 1;
    }

    node.endIndex = endIndex;
  }

  return { lines, roots: root.children };
}

function getNodeAncestorLines(node) {
  const ancestors = [];
  let current = node.parent;

  while (current && typeof current.line === "string") {
    ancestors.unshift(current.line);
    current = current.parent;
  }

  return ancestors;
}

function renderCompletedNodeCacheBlock(lines, node) {
  return [
    ...getNodeAncestorLines(node),
    ...lines.slice(node.startIndex, node.endIndex + 1),
  ].join("\n");
}

function collectCompletedTaskCacheBlocksFromNodes(lines, nodes, blocks = []) {
  for (const node of nodes) {
    if (node.isCompleted) {
      blocks.push(renderCompletedNodeCacheBlock(lines, node));
      continue;
    }

    collectCompletedTaskCacheBlocksFromNodes(lines, node.children, blocks);
  }

  return blocks;
}

function collectCompletedTaskCacheBlocks(content) {
  const { lines, roots } = buildTaskTree(content);
  return collectCompletedTaskCacheBlocksFromNodes(lines, roots).filter(
    (block) => block.trim() !== ""
  );
}

function createEmptyCurrentDailyCacheEntries() {
  return Object.fromEntries(
    CURRENT_DAILY_CACHE_SECTION_NAMES.map((sectionName) => [sectionName, []])
  );
}

function extractCurrentRefreshCacheEntries(currentContent) {
  const lines = currentContent.split("\n");
  const entries = createEmptyCurrentDailyCacheEntries();
  const sections = [
    { cacheSection: "日常", heading: "**日常**", nextHeading: "**主线**" },
    { cacheSection: "主线", heading: "**主线**", nextHeading: "**支线**" },
    { cacheSection: "支线", heading: "**支线**", nextHeading: null },
  ];

  for (const section of sections) {
    const range = findCurrentSectionRange(lines, section.heading, section.nextHeading);
    if (!range) continue;

    entries[section.cacheSection] = collectCompletedTaskCacheBlocks(
      getSectionBodyText(lines, range)
    );
  }

  return entries;
}

function hasCurrentDailyCacheEntries(entries) {
  return CURRENT_DAILY_CACHE_SECTION_NAMES.some(
    (sectionName) => (entries[sectionName] || []).length > 0
  );
}

function findCacheSectionRange(lines, sectionName) {
  const headingText = `## ${sectionName}`;
  const headingIndex = lines.findIndex((line) => line.trim() === headingText);
  if (headingIndex === -1) return null;

  const nextHeadingIndex = lines.findIndex(
    (line, index) => index > headingIndex && /^##\s+/.test(line.trim())
  );

  return {
    bodyStartIndex: headingIndex + 1,
    headingIndex,
    nextHeadingIndex: nextHeadingIndex === -1 ? lines.length : nextHeadingIndex,
  };
}

function splitCacheBlocks(lines) {
  const sectionLines = trimBlankLines(lines);
  if (sectionLines.length === 0) {
    return [];
  }

  const { lines: taskLines, roots } = buildTaskTree(sectionLines.join("\n"));

  return roots.map((root) =>
    taskLines.slice(root.startIndex, root.endIndex + 1).join("\n")
  );
}

function parseCurrentDailyCacheEntries(cacheContent) {
  const entries = createEmptyCurrentDailyCacheEntries();
  if (!cacheContent || cacheContent.trim() === "") {
    return entries;
  }

  const lines = cacheContent.split("\n");
  for (const sectionName of CURRENT_DAILY_CACHE_SECTION_NAMES) {
    const range = findCacheSectionRange(lines, sectionName);
    if (!range) continue;

    entries[sectionName] = splitCacheBlocks(
      lines.slice(range.bodyStartIndex, range.nextHeadingIndex)
    );
  }

  return entries;
}

function normalizeCacheBlock(block) {
  return trimBlankLines(block.split("\n")).join("\n");
}

function mergeCurrentDailyCacheEntries(existingEntries, incomingEntries) {
  const mergedEntries = createEmptyCurrentDailyCacheEntries();

  for (const sectionName of CURRENT_DAILY_CACHE_SECTION_NAMES) {
    const seen = new Set();
    for (const block of [
      ...(existingEntries[sectionName] || []),
      ...(incomingEntries[sectionName] || []),
    ]) {
      const normalizedBlock = normalizeCacheBlock(block);
      if (normalizedBlock === "" || seen.has(normalizedBlock)) continue;

      seen.add(normalizedBlock);
      mergedEntries[sectionName].push(normalizedBlock);
    }
  }

  return mergedEntries;
}

function renderCurrentDailyCacheContent(date, entries) {
  const lines = [`# ${date}`, ""];

  for (let index = 0; index < CURRENT_DAILY_CACHE_SECTION_NAMES.length; index += 1) {
    const sectionName = CURRENT_DAILY_CACHE_SECTION_NAMES[index];
    if (index > 0) {
      lines.push("");
    }

    lines.push(`## ${sectionName}`);
    for (const block of entries[sectionName] || []) {
      if (lines[lines.length - 1] === `## ${sectionName}`) {
        lines.push("");
      }
      lines.push(...normalizeCacheBlock(block).split("\n"));
    }
  }

  return `${trimBlankLines(lines).join("\n")}\n`;
}

function mergeCurrentDailyCacheContent(existingContent, date, incomingEntries) {
  const existingEntries = parseCurrentDailyCacheEntries(existingContent);
  const mergedEntries = mergeCurrentDailyCacheEntries(
    existingEntries,
    incomingEntries
  );

  return renderCurrentDailyCacheContent(date, mergedEntries);
}

function extractCachedCompletedDailyTaskTexts(cacheContent) {
  const entries = parseCurrentDailyCacheEntries(cacheContent);
  const completedTexts = new Set();

  for (const block of entries["日常"] || []) {
    const firstLine = block.split("\n").find((line) => matchTaskLine(line));
    const taskMatch = firstLine ? matchTaskLine(firstLine) : null;
    if (!taskMatch || !isCompletedTaskMarker(taskMatch[2])) continue;

    const taskText = normalizeDailyRhythmTask(firstLine);
    if (taskText !== null) {
      completedTexts.add(normalizeTaskTextKey(taskText));
    }
  }

  return completedTexts;
}

function extractTaskTextFromTaskLine(line) {
  const taskMatch = line.match(/^\s*-\s*\[[^\]]?\]\s*(.*)$/);
  if (!taskMatch) return null;

  const taskText = taskMatch[1].trim();
  return taskText === "" ? null : taskText;
}

function extractCompletedMainlineSettlementItems(cacheContent) {
  const entries = parseCurrentDailyCacheEntries(cacheContent);
  const items = [];
  const seen = new Set();

  for (const block of entries["主线"] || []) {
    const firstLine = block.split("\n").find((line) => line.trim() !== "");
    const taskMatch = firstLine ? matchTaskLine(firstLine) : null;
    if (!taskMatch || taskMatch[1] !== "" || !isCompletedTaskMarker(taskMatch[2])) {
      continue;
    }

    const title = extractTaskTextFromTaskLine(firstLine);
    if (!title || seen.has(title)) continue;

    seen.add(title);
    items.push({
      points: 3,
      title,
    });
  }

  return items;
}

function renderCurrentDaySettlementPreview(date, items) {
  if (items.length === 0) {
    return `Settle ${date}: no completed mainline items.`;
  }

  const lines = [
    `Settle ${date}: ${items.length} completed mainline item(s), +${items.length * 3} points.`,
  ];

  for (const item of items) {
    lines.push(`+${item.points} 完成主线：${item.title}`);
  }

  return lines.join("\n");
}

function parseShopBalanceLine(line) {
  const match = line.match(/^\*\*余额：(-?\d+)\s*\|\s*当前连续：(\d+)\s*天\s*\|\s*最长记录：(\d+)\s*天\*\*$/);
  if (!match) return null;

  return {
    balance: Number(match[1]),
    currentStreak: Number(match[2]),
    longestStreak: Number(match[3]),
  };
}

function renderShopBalanceLine(balanceInfo) {
  return `**余额：${balanceInfo.balance} | 当前连续：${balanceInfo.currentStreak} 天 | 最长记录：${balanceInfo.longestStreak} 天**`;
}

function findShopBalanceLineIndex(lines) {
  return lines.findIndex((line) => parseShopBalanceLine(line) !== null);
}

function findShopLedgerInsertIndex(lines) {
  const ledgerHeadingIndex = lines.findIndex((line) => line.trim() === "**流水**");
  if (ledgerHeadingIndex === -1) return -1;

  const actionHeadingIndex = lines.findIndex(
    (line, index) =>
      index > ledgerHeadingIndex &&
      /^\*\*.+\*\*$/.test(line.trim()) &&
      line.trim() !== "**流水**"
  );

  if (actionHeadingIndex === -1) {
    return ledgerHeadingIndex + 1;
  }

  return actionHeadingIndex + 1;
}

function getSettledMainlineTitlesFromShopContent(shopContent) {
  const titles = new Set();
  const lineRe = /^\d{4}-\d{2}-\d{2}\s+\|\s+[+-]?\d+\s+\|\s+完成主线：(.+?)\s+\|\s+余额\s+-?\d+\s*$/;

  for (const line of shopContent.split("\n")) {
    const match = line.match(lineRe);
    if (match) {
      titles.add(match[1].trim());
    }
  }

  return titles;
}

function filterUnsettledSettlementItems(items, shopContent) {
  const settledTitles = getSettledMainlineTitlesFromShopContent(shopContent);
  return items.filter((item) => !settledTitles.has(item.title));
}

function applyCurrentDaySettlementToShopContent(shopContent, date, items) {
  if (items.length === 0) {
    return {
      changed: false,
      content: shopContent,
      settledItems: [],
    };
  }

  const lines = shopContent.split("\n");
  const balanceLineIndex = findShopBalanceLineIndex(lines);
  const insertIndex = findShopLedgerInsertIndex(lines);
  if (balanceLineIndex === -1 || insertIndex === -1) {
    return null;
  }

  const balanceInfo = parseShopBalanceLine(lines[balanceLineIndex]);
  const settledItems = filterUnsettledSettlementItems(items, shopContent);
  if (settledItems.length === 0) {
    return {
      changed: false,
      content: shopContent,
      settledItems: [],
    };
  }

  let runningBalance = balanceInfo.balance;
  const ledgerLines = [];

  for (const item of settledItems) {
    runningBalance += item.points;
    ledgerLines.push(
      `${date} | +${item.points} | 完成主线：${item.title} | 余额 ${runningBalance}`
    );
  }

  const updatedBalanceInfo = {
    ...balanceInfo,
    balance: runningBalance,
  };

  lines[balanceLineIndex] = renderShopBalanceLine(updatedBalanceInfo);
  lines.splice(insertIndex, 0, ...ledgerLines);

  return {
    changed: true,
    content: lines.join("\n"),
    settledItems,
  };
}

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

function findTaskSubtreeEndInLines(lines, lineNumber) {
  const taskMatch = matchTaskLine(lines[lineNumber]);
  if (!taskMatch) return lineNumber;

  const baseIndentLength = taskMatch[1].length;
  let endLine = lineNumber;

  while (endLine < lines.length - 1) {
    const nextLine = lines[endLine + 1];
    if (nextLine.trim() === "") {
      endLine += 1;
      continue;
    }

    if (getIndent(nextLine).length > baseIndentLength) {
      endLine += 1;
      continue;
    }

    break;
  }

  return endLine;
}

function completeDescendantTasksInLineArray(lines, parentLineNumber) {
  const parentTask = matchTaskLine(lines[parentLineNumber]);
  if (!parentTask || parentTask[2].toLowerCase() !== "x") {
    return [];
  }

  const parentIndentLength = parentTask[1].length;
  const subtreeEndLine = findTaskSubtreeEndInLines(lines, parentLineNumber);
  const changedLineNumbers = [];

  for (let lineNumber = parentLineNumber + 1; lineNumber <= subtreeEndLine; lineNumber += 1) {
    const taskMatch = matchTaskLine(lines[lineNumber]);
    if (!taskMatch || taskMatch[1].length <= parentIndentLength) {
      continue;
    }

    if (taskMatch[2].toLowerCase() === "x") {
      continue;
    }

    lines[lineNumber] = applyStatusToLine(lines[lineNumber], "x");
    changedLineNumbers.push(lineNumber);
  }

  return changedLineNumbers;
}

function completeDescendantTasksInEditor(editor, parentLineNumbers) {
  const lineCount = getEditorLineCount(editor);
  if (lineCount === 0 || parentLineNumbers.length === 0) {
    return [];
  }

  const lines = Array.from({ length: lineCount }, (_, index) => editor.getLine(index));
  const changedLineNumbers = new Set();

  for (const parentLineNumber of [...new Set(parentLineNumbers)].sort((a, b) => a - b)) {
    if (parentLineNumber < 0 || parentLineNumber >= lineCount) {
      continue;
    }

    for (const changedLineNumber of completeDescendantTasksInLineArray(lines, parentLineNumber)) {
      changedLineNumbers.add(changedLineNumber);
    }
  }

  for (const lineNumber of changedLineNumbers) {
    editor.setLine(lineNumber, lines[lineNumber]);
  }

  return [...changedLineNumbers].sort((a, b) => a - b);
}

function markAncestorTasksInLineArray(lines, childLineNumber) {
  const childTask = matchTaskLine(lines[childLineNumber]);
  if (!childTask || childTask[2] !== "/") {
    return [];
  }

  let currentIndentLength = childTask[1].length;
  if (currentIndentLength === 0) {
    return [];
  }

  const changedLineNumbers = [];

  for (let lineNumber = childLineNumber - 1; lineNumber >= 0; lineNumber -= 1) {
    const line = lines[lineNumber];
    if (line.trim() === "") {
      continue;
    }

    const taskMatch = matchTaskLine(line);
    if (!taskMatch) {
      continue;
    }

    const indentLength = taskMatch[1].length;
    if (indentLength >= currentIndentLength) {
      continue;
    }

    if (taskMatch[2] !== "/") {
      lines[lineNumber] = applyStatusToLine(lines[lineNumber], "/");
      changedLineNumbers.push(lineNumber);
    }

    currentIndentLength = indentLength;
    if (currentIndentLength === 0) {
      break;
    }
  }

  return changedLineNumbers;
}

function markAncestorTasksInEditor(editor, childLineNumbers) {
  const lineCount = getEditorLineCount(editor);
  if (lineCount === 0 || childLineNumbers.length === 0) {
    return [];
  }

  const lines = Array.from({ length: lineCount }, (_, index) => editor.getLine(index));
  const changedLineNumbers = new Set();

  for (const childLineNumber of [...new Set(childLineNumbers)].sort((a, b) => a - b)) {
    if (childLineNumber < 0 || childLineNumber >= lineCount) {
      continue;
    }

    for (const changedLineNumber of markAncestorTasksInLineArray(lines, childLineNumber)) {
      changedLineNumbers.add(changedLineNumber);
    }
  }

  for (const lineNumber of changedLineNumbers) {
    editor.setLine(lineNumber, lines[lineNumber]);
  }

  return [...changedLineNumbers].sort((a, b) => a - b);
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

  for (const region of [...regions.values()].sort((a, b) => b.startLine - a.startLine)) {
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
  const completedParentLineNumbers = [];
  const inProgressLineNumbers = [];

  for (const transformed of update.transformedLines) {
    if (transformed.line === transformed.previousLine) continue;

    const taskMatch = matchTaskLine(transformed.line);
    if (!taskMatch) continue;

    affectedTaskLines.push(transformed.lineNumber);
    if (taskMatch[2] === "/") {
      preferredFrontLineNumbers.push(transformed.lineNumber);
      inProgressLineNumbers.push(transformed.lineNumber);
    }
    if (isCompletedTaskMarker(taskMatch[2])) {
      preferredBackLineNumbers.push(transformed.lineNumber);
      completedParentLineNumbers.push(transformed.lineNumber);
    }
  }

  for (const changedLineNumber of markAncestorTasksInEditor(
    editor,
    inProgressLineNumbers
  )) {
    affectedTaskLines.push(changedLineNumber);
    preferredFrontLineNumbers.push(changedLineNumber);
  }

  for (const changedLineNumber of completeDescendantTasksInEditor(
    editor,
    completedParentLineNumbers
  )) {
    affectedTaskLines.push(changedLineNumber);
    preferredBackLineNumbers.push(changedLineNumber);
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
    startLine: start,
    endLine: end,
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
  const seenHeadLines = new Map();
  let offset = 0;
  let consumedLines = 0;

  for (const token of tokens) {
    const text = token.lines.join("\n");
    const headText = token.lines[0] || "";
    if (token.type === "task") {
      const occurrence = seen.get(text) || 0;
      const headOccurrence = seenHeadLines.get(headText) || 0;
      seen.set(text, occurrence + 1);
      seenHeadLines.set(headText, headOccurrence + 1);
      tasks.push({
        from: offset,
        headOccurrence,
        headText,
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
  const fallbackTask =
    newTask ||
    newTasks.find(
      (task) =>
        task.headText === oldTask.headText &&
        task.headOccurrence === oldTask.headOccurrence
    );
  if (!fallbackTask) return mappedSelection;

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

  const newTaskFrom = region.from + fallbackTask.from;
  const newTaskTo = region.from + fallbackTask.to;
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

function buildSortedToggleTransactionSpec(doc, selection, toggle) {
  if (!ChangeSetClass || !EditorSelectionClass) {
    return null;
  }

  const region = findSortableTaskRegion(doc, toggle.lineNumber);
  if (!region) return null;

  const regionText = doc.sliceString(region.from, region.to);
  const toggledTask = matchTaskLine(doc.line(toggle.lineNumber).text);
  const toggledLineOffset = toggle.lineNumber - region.startLine;
  const preferredFrontLineOffsets = [];
  const preferredBackLineOffsets = [];

  if (toggledTask) {
    if (toggledTask[2] === "/") {
      preferredFrontLineOffsets.push(toggledLineOffset);
    }
    if (isCompletedTaskMarker(toggledTask[2])) {
      preferredBackLineOffsets.push(toggledLineOffset);
    }
  }

  let regionContent = regionText;
  if (isCompletedTaskMarker(toggledTask?.[2])) {
    const regionLines = regionText.split("\n");
    const changedLineOffsets = completeDescendantTasksInLineArray(
      regionLines,
      toggledLineOffset
    );
    if (changedLineOffsets.length > 0) {
      regionContent = preserveTrailingNewlines(regionText, regionLines.join("\n"));
    }
  }

  const sortedRegion = sortTaskRegionText(
    regionContent,
    region.baseIndent,
    preferredFrontLineOffsets,
    preferredBackLineOffsets
  );
  if (sortedRegion === regionText) return null;

  const replacement = ChangeSetClass.of(
    [{ from: region.from, to: region.to, insert: sortedRegion }],
    doc.length
  );
  const mappedSelection = selection.map(replacement);
  const finalSelection = remapSelectionIntoSortedTask(
    selection,
    mappedSelection,
    region,
    regionText,
    sortedRegion,
    toggle.pos
  );

  return {
    changes: [{ from: region.from, to: region.to, insert: sortedRegion }],
    filter: false,
    selection: finalSelection,
  };
}

function buildTaskSortExtension() {
  if (!EditorViewClass || !ChangeSetClass || !EditorSelectionClass) {
    return null;
  }

  return EditorViewClass.updateListener.of((update) => {
    if (!update.docChanged) return;

    let toggle = null;
    for (const transaction of update.transactions) {
      const currentToggle = getCheckboxToggleInfo(transaction);
      if (!currentToggle) continue;
      if (toggle) return;
      toggle = currentToggle;
    }

    if (!toggle) return;

    const spec = buildSortedToggleTransactionSpec(
      update.state.doc,
      update.state.selection,
      toggle
    );
    if (!spec) return;

    update.view.dispatch(spec);
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

async function readVaultFileIfExists(app, path) {
  const file = app.vault.getAbstractFileByPath(path);
  if (!file) return null;

  return app.vault.read(file);
}

async function ensureVaultFolder(app, folderPath) {
  if (app.vault.getAbstractFileByPath(folderPath)) {
    return;
  }

  if (typeof app.vault.createFolder === "function") {
    await app.vault.createFolder(folderPath);
  }
}

async function writeCurrentDailyCache(app, date, incomingEntries) {
  if (!hasCurrentDailyCacheEntries(incomingEntries)) {
    return false;
  }

  const cachePath = getCurrentDailyCacheFilePath(date);
  await ensureVaultFolder(app, CURRENT_DAILY_CACHE_FOLDER_PATH);

  const cacheFile = app.vault.getAbstractFileByPath(cachePath);
  if (cacheFile) {
    await app.vault.process(cacheFile, (data) =>
      mergeCurrentDailyCacheContent(data, date, incomingEntries)
    );
    return true;
  }

  await app.vault.create(
    cachePath,
    mergeCurrentDailyCacheContent(null, date, incomingEntries)
  );
  return true;
}

async function refreshCurrentDailySection(
  app,
  pluginData = {},
  saveData = async () => {}
) {
  const today = getTodayDateStr();
  const tracksFile = app.vault.getAbstractFileByPath(TRACKS_FILE_PATH);
  const currentFile = app.vault.getAbstractFileByPath(CURRENT_TRACKS_FILE_PATH);

  if (!tracksFile || !currentFile) {
    new NoticeClass("Missing tracks.md or current.md for daily refresh.");
    return false;
  }

  const tracksContent = await app.vault.read(tracksFile);
  const currentContent = await app.vault.read(currentFile);
  const cacheEntries = extractCurrentRefreshCacheEntries(currentContent);
  const cachePath = getCurrentDailyCacheFilePath(today);
  const existingCacheContent = await readVaultFileIfExists(app, cachePath);
  const mergedCacheContent = mergeCurrentDailyCacheContent(
    existingCacheContent,
    today,
    cacheEntries
  );
  const excludedDailyTasks = extractCachedCompletedDailyTaskTexts(mergedCacheContent);
  const preview = buildRefreshedCurrentContent(currentContent, tracksContent, {
    excludedDailyTasks,
  });

  if (preview === null) {
    new NoticeClass("Daily refresh needs a valid Rhythms/Daily block and current.md sections.");
    return false;
  }

  await writeCurrentDailyCache(app, today, cacheEntries);

  let replaced = false;
  let failed = false;

  await app.vault.process(currentFile, (data) => {
    const updated = buildRefreshedCurrentContent(data, tracksContent, {
      excludedDailyTasks,
    });
    if (updated === null) {
      failed = true;
      return data;
    }

    replaced = true;
    return updated;
  });

  if (failed || !replaced) {
    new NoticeClass("Daily refresh failed because current.md changed while updating.");
    return false;
  }

  new NoticeClass("current.md daily section refreshed.");
  return true;
}

async function previewCurrentDaySettlement(app, date = getTodayDateStr()) {
  const cachePath = getCurrentDailyCacheFilePath(date);
  const cacheContent = await readVaultFileIfExists(app, cachePath);
  if (cacheContent === null) {
    new NoticeClass(`No current.md cache found for ${date}.`);
    return null;
  }

  const items = extractCompletedMainlineSettlementItems(cacheContent);
  const preview = renderCurrentDaySettlementPreview(date, items);
  new NoticeClass(preview);
  return {
    date,
    items,
    preview,
  };
}

async function settleCurrentDay(app, date = getTodayDateStr()) {
  const cachePath = getCurrentDailyCacheFilePath(date);
  const cacheContent = await readVaultFileIfExists(app, cachePath);
  if (cacheContent === null) {
    new NoticeClass(`No current.md cache found for ${date}.`);
    return false;
  }

  const items = extractCompletedMainlineSettlementItems(cacheContent);
  if (items.length === 0) {
    new NoticeClass(`Settle ${date}: no completed mainline items.`);
    return false;
  }

  const shopFile = app.vault.getAbstractFileByPath(SHOP_FILE_PATH);
  if (!shopFile) {
    new NoticeClass("Missing 04-governance/shop.md for settlement.");
    return false;
  }

  let result = null;
  await app.vault.process(shopFile, (data) => {
    result = applyCurrentDaySettlementToShopContent(data, date, items);
    if (result === null || !result.changed) {
      return data;
    }

    return result.content;
  });

  if (result === null) {
    new NoticeClass("Settlement failed: shop.md format was not recognized.");
    return false;
  }

  if (!result.changed) {
    new NoticeClass(`Settle ${date}: no new completed mainline items.`);
    return false;
  }

  new NoticeClass(
    `Settle ${date}: recorded ${result.settledItems.length} mainline item(s), +${result.settledItems.length * 3} points.`
  );
  return true;
}

function runTaskStatusCommand(app, statusChar, isToggle) {
  const editor = ensureEditableMarkdownEditor(app);
  if (!editor) {
    new NoticeClass("Open a Markdown note in editing mode to use this command.");
    return;
  }

  applyTaskStatusCommandToEditor(editor, statusChar, isToggle);
}

function isCurrentTracksFile(file) {
  return !!file && file.path === CURRENT_TRACKS_FILE_PATH;
}

function getMarkdownLeaves(app) {
  if (!app?.workspace) {
    return [];
  }

  const leaves = [];
  const isMarkdownLeaf = (leaf) =>
    !!leaf?.view &&
    (leaf.view instanceof MarkdownViewClass || typeof leaf.view.addAction === "function");

  if (typeof app.workspace.iterateAllLeaves === "function") {
    app.workspace.iterateAllLeaves((leaf) => {
      if (isMarkdownLeaf(leaf)) {
        leaves.push(leaf);
      }
    });
    return leaves;
  }

  if (typeof app.workspace.getLeavesOfType === "function") {
    return app.workspace.getLeavesOfType("markdown").filter(isMarkdownLeaf);
  }

  return leaves;
}

function addDailyRefreshHeaderAction(plugin, leaf, pluginData) {
  const view = leaf?.view;
  if (!view || typeof view.addAction !== "function") {
    return null;
  }

  const existingAction = plugin.currentDailyHeaderActions.get(leaf);
  if (existingAction?.isConnected) {
    return existingAction;
  }

  const action = view.addAction(
    DAILY_REFRESH_ICON,
    "Refresh current.md daily section",
    () => void refreshCurrentDailySection(plugin.app, pluginData, (data) => plugin.saveData(data))
  );
  action?.classList?.add(DAILY_HEADER_ACTION_CLASS);
  plugin.currentDailyHeaderActions.set(leaf, action);
  return action;
}

function removeDailyRefreshHeaderAction(plugin, leaf) {
  const existingAction = plugin.currentDailyHeaderActions.get(leaf);
  if (existingAction?.remove) {
    existingAction.remove();
  }
  plugin.currentDailyHeaderActions.delete(leaf);
}

function syncDailyRefreshHeaderActions(plugin, pluginData) {
  const leaves = getMarkdownLeaves(plugin.app);
  const activeLeaves = new Set(leaves);

  for (const [leaf] of plugin.currentDailyHeaderActions) {
    if (!activeLeaves.has(leaf) || !isCurrentTracksFile(leaf?.view?.file)) {
      removeDailyRefreshHeaderAction(plugin, leaf);
    }
  }

  for (const leaf of leaves) {
    if (!isCurrentTracksFile(leaf?.view?.file)) {
      continue;
    }

    addDailyRefreshHeaderAction(plugin, leaf, pluginData);
  }
}

function registerDailyRefreshHeaderActions(plugin) {
  if (!plugin?.app?.workspace?.onLayoutReady) {
    return;
  }

  const sync = () => syncDailyRefreshHeaderActions(plugin, plugin.data);

  plugin.app.workspace.onLayoutReady(() => {
    sync();
  });

  plugin.registerEvent(plugin.app.workspace.on("file-open", sync));
  plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", sync));
  plugin.registerEvent(plugin.app.workspace.on("layout-change", sync));

  plugin.register(() => {
    for (const [leaf] of plugin.currentDailyHeaderActions) {
      removeDailyRefreshHeaderAction(plugin, leaf);
    }
  });
}

function runCurrentDailyRefresh(plugin) {
  return refreshCurrentDailySection(
    plugin.app,
    plugin.data,
    (data) => plugin.saveData(data)
  );
}

class TaskStatusShortcutsPlugin extends PluginClass {
  async onload() {
    this.data = (await this.loadData()) || {};
    this.currentDailyHeaderActions = new Map();

    const taskSortExtension = buildTaskSortExtension();
    if (taskSortExtension) {
      this.registerEditorExtension(taskSortExtension);
    }

    registerDailyRefreshHeaderActions(this);

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
      id: "set-task-status-waiting",
      name: "Set task status to waiting ([?])",
      hotkeys: [
        {
          modifiers: ["Mod"],
          key: "\\",
        },
      ],
      callback: () => {
        runTaskStatusCommand(this.app, "?", true);
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

    this.addCommand({
      id: "refresh-current-daily-section",
      name: "Refresh current.md daily section",
      hotkeys: [
        {
          modifiers: ["Alt"],
          key: "C",
        },
      ],
      callback: () => void runCurrentDailyRefresh(this),
    });

    this.addCommand({
      id: "preview-current-day-settlement",
      name: "Preview current day settlement",
      callback: () => void previewCurrentDaySettlement(this.app),
    });

    this.addCommand({
      id: "settle-current-day",
      name: "Settle current day",
      callback: () => void settleCurrentDay(this.app),
    });
  }
}

module.exports = TaskStatusShortcutsPlugin;
module.exports.default = TaskStatusShortcutsPlugin;
module.exports.applyStatusToLine = applyStatusToLine;
module.exports.applyTaskStatusCommandToEditor = applyTaskStatusCommandToEditor;
module.exports.applyCurrentDaySettlementToShopContent = applyCurrentDaySettlementToShopContent;
module.exports.buildTaskSortExtension = buildTaskSortExtension;
module.exports.createInlineTaskSortHelpers = createInlineTaskSortHelpers;
module.exports.ensureEditableMarkdownEditor = ensureEditableMarkdownEditor;
module.exports.getActiveMarkdownEditor = getActiveMarkdownEditor;
module.exports.getActiveMarkdownView = getActiveMarkdownView;
module.exports.runTaskStatusCommand = runTaskStatusCommand;
module.exports.buildRefreshedCurrentContent = buildRefreshedCurrentContent;
module.exports.collectCompletedTaskCacheBlocks = collectCompletedTaskCacheBlocks;
module.exports.extractRhythmsDailyTasks = extractRhythmsDailyTasks;
module.exports.extractCachedCompletedDailyTaskTexts = extractCachedCompletedDailyTaskTexts;
module.exports.extractCompletedMainlineSettlementItems = extractCompletedMainlineSettlementItems;
module.exports.extractCurrentRefreshCacheEntries = extractCurrentRefreshCacheEntries;
module.exports.addDailyRefreshHeaderAction = addDailyRefreshHeaderAction;
module.exports.completeDescendantTasksInLineArray = completeDescendantTasksInLineArray;
module.exports.getCurrentDailyCacheFilePath = getCurrentDailyCacheFilePath;
module.exports.getMarkdownLeaves = getMarkdownLeaves;
module.exports.getTodayDateStr = getTodayDateStr;
module.exports.isCurrentTracksFile = isCurrentTracksFile;
module.exports.markAncestorTasksInLineArray = markAncestorTasksInLineArray;
module.exports.mergeCurrentDailyCacheContent = mergeCurrentDailyCacheContent;
module.exports.parseCurrentDailyCacheEntries = parseCurrentDailyCacheEntries;
module.exports.previewCurrentDaySettlement = previewCurrentDaySettlement;
module.exports.registerDailyRefreshHeaderActions = registerDailyRefreshHeaderActions;
module.exports.removeDailyRefreshHeaderAction = removeDailyRefreshHeaderAction;
module.exports.refreshCurrentDailySection = refreshCurrentDailySection;
module.exports.renderCurrentDaySettlementPreview = renderCurrentDaySettlementPreview;
module.exports.renderCurrentDailyCacheContent = renderCurrentDailyCacheContent;
module.exports.replaceCurrentDailySection = replaceCurrentDailySection;
module.exports.runCurrentDailyRefresh = runCurrentDailyRefresh;
module.exports.setTaskStatus = setTaskStatus;
module.exports.settleCurrentDay = settleCurrentDay;
module.exports.syncDailyRefreshHeaderActions = syncDailyRefreshHeaderActions;
module.exports.sortCurrentFile = sortCurrentFile;
module.exports.sortEditorTaskRegions = sortEditorTaskRegions;
module.exports.toggleStatusOnLine = toggleStatusOnLine;
module.exports.toggleTaskStatus = toggleTaskStatus;
