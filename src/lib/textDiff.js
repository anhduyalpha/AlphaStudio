/**
 * Line and word-level text diffs (Myers-lite LCS for lines).
 */

export function splitLines(text) {
  return String(text ?? '').split(/\r\n|\n|\r/);
}

/**
 * @returns {Array<{ type: 'equal'|'add'|'remove', text: string, leftLine?: number, rightLine?: number }>}
 */
export function diffLines(leftText, rightText) {
  const a = splitLines(leftText);
  const b = splitLines(rightText);
  const n = a.length;
  const m = b.length;
  // LCS DP
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const hunks = [];
  let i = 0;
  let j = 0;
  let leftLine = 1;
  let rightLine = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      hunks.push({ type: 'equal', text: a[i], leftLine, rightLine });
      i += 1; j += 1; leftLine += 1; rightLine += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      hunks.push({ type: 'remove', text: a[i], leftLine });
      i += 1; leftLine += 1;
    } else {
      hunks.push({ type: 'add', text: b[j], rightLine });
      j += 1; rightLine += 1;
    }
  }
  while (i < n) {
    hunks.push({ type: 'remove', text: a[i], leftLine });
    i += 1; leftLine += 1;
  }
  while (j < m) {
    hunks.push({ type: 'add', text: b[j], rightLine });
    j += 1; rightLine += 1;
  }
  return hunks;
}

/**
 * Word-level tokens for a single line pair (changed lines only).
 * @returns {Array<{ type: 'equal'|'add'|'remove', text: string }>}
 */
export function diffWords(leftLine, rightLine) {
  const a = String(leftLine ?? '').split(/(\s+)/).filter((t) => t.length);
  const b = String(rightLine ?? '').split(/(\s+)/).filter((t) => t.length);
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'equal', text: a[i] });
      i += 1; j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'remove', text: a[i] });
      i += 1;
    } else {
      out.push({ type: 'add', text: b[j] });
      j += 1;
    }
  }
  while (i < n) { out.push({ type: 'remove', text: a[i] }); i += 1; }
  while (j < m) { out.push({ type: 'add', text: b[j] }); j += 1; }
  return out;
}

export function summarizeDiff(hunks) {
  let added = 0;
  let removed = 0;
  let equal = 0;
  for (const h of hunks) {
    if (h.type === 'add') added += 1;
    else if (h.type === 'remove') removed += 1;
    else equal += 1;
  }
  return { added, removed, equal, total: hunks.length, identical: added === 0 && removed === 0 };
}

export function editorStats(text) {
  const t = String(text ?? '');
  const trimmed = t.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  const lines = t.length ? t.split(/\r\n|\n|\r/).length : 0;
  return { words, characters: t.length, lines };
}

export async function copyText(text) {
  const value = String(text ?? '');
  if (!value) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
