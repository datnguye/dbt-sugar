import fs from 'node:fs';

const STAMP = /^(\d\d:\d\d:\d\d\.\d+) \[(\w+)\s*\]: (.*)$/;
const SHOWN = new Set(['info', 'warn', 'error']);
const SUMMARY = /^=+ Execution Summary =+$/;
export const HEADER = /^=+ \S+ \| (\S+) =+$/;
const KEEP_INVOCATIONS = 10;
const MAX_LINES = 5000;
const FIRST_READ_BYTES = 8 * 1024 * 1024;

/**
 * Turns dbt.log lines into entries: info/warn/error lines with their indented continuations,
 * plus the untimestamped Execution Summary block; debug lines and their continuations are dropped.
 */
function lineParser({ onHeader = () => {}, onEntry }) {
  let inv = null;
  let last = null;
  let t = '';
  let summary = false;
  return (line) => {
    const header = HEADER.exec(line);
    if (header) {
      inv = header[1];
      last = null;
      summary = false;
      onHeader(inv);
      return;
    }
    const stamped = STAMP.exec(line);
    if (stamped) {
      t = stamped[1].slice(0, 12);
      last = SHOWN.has(stamped[2]) && stamped[3].trim() ? { t, level: stamped[2], text: stamped[3], inv } : null;
      if (last) onEntry(last);
      return;
    }
    summary ||= SUMMARY.test(line);
    if (summary && line.trim()) onEntry({ t, level: 'info', text: line, inv });
    else if (last && /^\s+\S/.test(line)) last.text += `\n${line}`;
  };
}

export function parseLog(text, max) {
  const entries = [];
  const add = lineParser({ onEntry: (entry) => entries.push(entry) });
  for (const line of text.split('\n')) add(line);
  return entries.slice(-max);
}

export function createLogReader(file, { firstReadBytes = FIRST_READ_BYTES, keep = KEEP_INVOCATIONS, maxLines = MAX_LINES } = {}) {
  const byInvocation = new Map();
  let offset = null;
  let partial = false;
  let add = null;

  function reset(start) {
    byInvocation.clear();
    offset = start;
    partial = Boolean(start);
    add = lineParser({
      onHeader(inv) {
        byInvocation.set(inv, []);
        if (byInvocation.size > keep) byInvocation.delete(byInvocation.keys().next().value);
      },
      onEntry(entry) {
        const lines = byInvocation.get(entry.inv);
        if (!lines) return;
        lines.push(entry);
        if (lines.length > maxLines) lines.shift();
      }
    });
  }

  return {
    read() {
      let size;
      try {
        size = fs.statSync(file).size;
      } catch {
        reset(null);
        return byInvocation;
      }
      if (offset === null || size < offset) reset(Math.max(0, size - firstReadBytes));
      if (size === offset) return byInvocation;
      const buffer = Buffer.alloc(size - offset);
      const fd = fs.openSync(file, 'r');
      try {
        fs.readSync(fd, buffer, 0, buffer.length, offset);
      } finally {
        fs.closeSync(fd);
      }
      const end = buffer.lastIndexOf(10) + 1;
      if (!end) return byInvocation;
      const skip = partial ? buffer.indexOf(10) + 1 : 0;
      partial = false;
      for (const line of buffer.subarray(Math.min(skip, end), end).toString('utf8').split('\n')) add(line);
      offset += end;
      return byInvocation;
    }
  };
}
