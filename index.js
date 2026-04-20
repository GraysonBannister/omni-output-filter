/**
 * omni-output-filter — Shell Output Compression for Token Efficiency
 *
 * Registers a tool output filter that compresses Bash/Shell output before it
 * enters the agent's context window. No external dependencies — pure Node.js.
 *
 * Works with all LLM providers. Inspired by RTK (Rust Token Killer).
 * Typical savings: 60–90% on shell-heavy workflows.
 *
 * Filters applied (in order):
 *  1. Strip carriage returns (\r)
 *  2. Collapse consecutive duplicate lines (e.g. progress bars, rebuild noise)
 *  3. Collapse runs of blank lines to a single blank line
 *  4. Summarise npm/yarn/pnpm install trees
 *  5. Summarise cargo build/check output
 *  6. Summarise pip install output
 *  7. Trim deep stack traces (keep first 8 + last 4 lines)
 *  8. Cap individual lines at 400 chars
 *  9. If still large, keep head (first 100 lines) + tail (last 50 lines)
 */

/** Tools whose output should be filtered. */
const FILTERED_TOOLS = new Set(['Bash', 'bash', 'Shell', 'shell', 'BashExec', 'RunCommand']);

/** Maximum chars per line before truncation. */
const MAX_LINE_CHARS = 400;

/** Maximum total lines before head/tail trimming kicks in. */
const MAX_TOTAL_LINES = 300;

// ---------------------------------------------------------------------------
// Individual filter passes
// ---------------------------------------------------------------------------

/** Strip \r so Windows-style line endings don't create duplicates. */
function stripCarriageReturns(text) {
  return text.replace(/\r/g, '');
}

/** Collapse consecutive identical lines into one with a count suffix. */
function deduplicateLines(text) {
  const lines = text.split('\n');
  const result = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let count = 1;
    while (i + count < lines.length && lines[i + count] === line) {
      count++;
    }
    if (count > 3) {
      result.push(line);
      result.push(`  ... [repeated ${count - 1} more times]`);
    } else {
      for (let j = 0; j < count; j++) result.push(line);
    }
    i += count;
  }
  return result.join('\n');
}

/** Reduce runs of 3+ blank lines to a single blank line. */
function collapseBlankLines(text) {
  return text.replace(/\n{3,}/g, '\n\n');
}

/**
 * Summarise npm/yarn/pnpm install output.
 * Replaces the verbose dependency tree with a one-liner.
 */
function summariseNpmInstall(text) {
  // npm/yarn added N packages summary line
  const addedMatch = text.match(/added (\d+) packages?(.*)/);
  if (!addedMatch) return text;

  // Check if the output contains a typical npm install tree (lines starting with spaces + package names)
  const lines = text.split('\n');
  const treeLines = lines.filter(l => /^\s+([\w@][\w/@.-]+)\s+\d/.test(l));
  if (treeLines.length < 5) return text;

  // Extract timing / audit summary lines to keep
  const keepLines = lines.filter(l =>
    /^(added|removed|changed|audited|found|up to date|npm warn|npm notice|error|yarn|pnpm)/.test(l.trim().toLowerCase())
  );

  const summary = keepLines.length > 0
    ? keepLines.join('\n')
    : `added ${addedMatch[1]} packages${addedMatch[2] || ''}`;

  return `[npm/yarn install — ${treeLines.length} dependency lines compressed]\n${summary}`;
}

/**
 * Summarise cargo build/check output.
 * Keeps warnings, errors, and the final "Finished" line; drops the verbose
 * "Compiling crate vX.Y.Z" lines.
 */
function summariseCargoBuild(text) {
  const lines = text.split('\n');
  const compilingLines = lines.filter(l => /^\s*Compiling\s+\S+\s+v[\d.]+/.test(l));
  if (compilingLines.length < 5) return text;

  const keptLines = lines.filter(l =>
    !/^\s*Compiling\s+\S+\s+v[\d.]+/.test(l) &&
    !/^\s*Downloaded\s+\S+\s+v[\d.]+/.test(l) &&
    !/^\s*Downloading\s+/.test(l)
  );

  return `[cargo: ${compilingLines.length} "Compiling" lines compressed]\n${keptLines.join('\n')}`;
}

/**
 * Summarise pip install output.
 * Keeps the final "Successfully installed" line; drops download/collecting lines.
 */
function summarisePipInstall(text) {
  const lines = text.split('\n');
  const collectingLines = lines.filter(l => /^(Collecting|Downloading|Installing collected|Obtaining)/.test(l));
  if (collectingLines.length < 5) return text;

  const keptLines = lines.filter(l =>
    !/^(Collecting|Downloading|  Downloading|Installing collected|Obtaining)/.test(l)
  );

  return `[pip: ${collectingLines.length} "Collecting/Downloading" lines compressed]\n${keptLines.join('\n')}`;
}

/**
 * Trim deep stack traces.
 * Keeps the exception type line + first 8 frames + last 4 frames.
 */
function trimStackTraces(text) {
  // Matches Python tracebacks, Node.js stack traces, Java stack traces
  const tracePattern = /^(\s+at\s|^\s+File\s".+",\s+line\s\d|\s+at\s[\w$./<>]+\s\()/m;
  if (!tracePattern.test(text)) return text;

  const lines = text.split('\n');
  const result = [];
  let inTrace = false;
  let traceFrames = [];
  let traceStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const isFrame = /^\s+(at\s|File\s".+",\s+line\s\d)/.test(lines[i]);
    if (isFrame) {
      if (!inTrace) {
        inTrace = true;
        traceStart = i;
        traceFrames = [];
      }
      traceFrames.push(lines[i]);
    } else {
      if (inTrace) {
        // Flush the accumulated trace
        if (traceFrames.length > 12) {
          const head = traceFrames.slice(0, 8);
          const tail = traceFrames.slice(-4);
          result.push(...head);
          result.push(`    ... [${traceFrames.length - 12} frames omitted] ...`);
          result.push(...tail);
        } else {
          result.push(...traceFrames);
        }
        inTrace = false;
        traceFrames = [];
      }
      result.push(lines[i]);
    }
  }
  // Flush any trailing trace
  if (inTrace && traceFrames.length > 0) {
    if (traceFrames.length > 12) {
      result.push(...traceFrames.slice(0, 8));
      result.push(`    ... [${traceFrames.length - 12} frames omitted] ...`);
      result.push(...traceFrames.slice(-4));
    } else {
      result.push(...traceFrames);
    }
  }
  return result.join('\n');
}

/** Cap individual lines that exceed MAX_LINE_CHARS. */
function capLongLines(text) {
  return text
    .split('\n')
    .map(line => {
      if (line.length <= MAX_LINE_CHARS) return line;
      return line.slice(0, MAX_LINE_CHARS) + ` ...[${line.length - MAX_LINE_CHARS} chars truncated]`;
    })
    .join('\n');
}

/**
 * If the output is still very long after all filters, keep the most
 * informative head and tail with a gap marker in the middle.
 */
function headTailTrim(text) {
  const lines = text.split('\n');
  if (lines.length <= MAX_TOTAL_LINES) return text;
  const head = lines.slice(0, 100);
  const tail = lines.slice(-50);
  const omitted = lines.length - 150;
  return [
    ...head,
    '',
    `... [${omitted} lines omitted by omni-output-filter] ...`,
    '',
    ...tail,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Main filter function
// ---------------------------------------------------------------------------

/**
 * @param {string} toolName
 * @param {string} output
 * @returns {string}
 */
function filterOutput(toolName, output) {
  if (!FILTERED_TOOLS.has(toolName)) return output;
  if (!output || typeof output !== 'string') return output;

  let result = output;
  result = stripCarriageReturns(result);
  result = summariseNpmInstall(result);
  result = summariseCargoBuild(result);
  result = summarisePipInstall(result);
  result = trimStackTraces(result);
  result = deduplicateLines(result);
  result = collapseBlankLines(result);
  result = capLongLines(result);
  result = headTailTrim(result);
  return result;
}

// ---------------------------------------------------------------------------
// Addon lifecycle
// ---------------------------------------------------------------------------

/** @param {import('@omni-code/addon-api').AddonContext} context */
function activate(context) {
  context.registerToolOutputFilter(filterOutput);
}

function deactivate() {
  // Filters are cleared automatically on reload — nothing to clean up.
}

module.exports = { activate, deactivate };
