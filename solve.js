// A faster drop-in for makefun-diff 1.0.0: the same patch bytes for every
// input, produced by a leaner route. Lines are interned to small integers
// once per case, the greedy Myers search runs on those integers with one
// flat Int32 trace, the script is recovered from the trace alone (each
// step's kind is recomputed from the previous row exactly as the search
// chose it, and the snake is whatever the row's x gained past that step,
// so the recovered script is the search's own, not merely a shortest one),
// and the patch is rendered straight from the runs. No dependency, and no
// object is allocated per diagonal.
//
// A line keeps its trailing newline when it has one, so a last line without
// one never equals the same words with one.

// Kinds of run, as small integers.
const KEPT = 0;
const TOOK_OUT = 1;
const PUT_IN = 2;
// Kept lines a hunk shows around each change run.
const SHOW = 3;

// One trace array shared by every run call: a slot is only ever read after
// the same call wrote it, so no clearing is needed between cases.
let sharedTrace = null;

/** One patch line: its op, the line, and a "%" line when it had no newline. */
function patchLine(op, line) {
  if (line.endsWith('\n')) return op + line;
  return op + line + '\n%\n';
}

/** The id of one line, interning it on first sight. */
function lineId(line, table, seen) {
  const found = seen.get(line);
  if (found !== undefined) return found;
  const id = table.length;
  table.push(line);
  seen.set(line, id);
  return id;
}

/** A text's lines as integer ids, in order, sharing one intern table. */
function internedLines(text, table, seen) {
  const ids = [];
  let start = 0;
  for (;;) {
    const cut = text.indexOf('\n', start);
    if (cut < 0) break;
    ids.push(lineId(text.slice(start, cut + 1), table, seen));
    start = cut + 1;
  }
  if (start < text.length) ids.push(lineId(text.slice(start), table, seen));
  return Int32Array.from(ids);
}

/**
 * The edit runs of two line-id slices, as [kind, count] pairs in order.
 * The search is the greedy one: for d edits and each diagonal k, the
 * furthest point is one old line past the (d-1) point on k-1 (a deletion)
 * or one new line past the (d-1) point on k+1 (an insertion), whichever
 * lies further into the old text, the deletion when both reach one point;
 * a move past either text's end is no candidate, no edge diagonal is
 * pruned, and from that point every line equal in both is followed as far
 * as it goes. The first path to reach both ends is the script.
 */
function middleRuns(a, b) {
  const n = a.length;
  const m = b.length;
  if (n === 0) return m === 0 ? [] : [[PUT_IN, m]];
  if (m === 0) return [[TOOK_OUT, n]];
  // One flat trace: row d starts at d*d and holds 2d+1 furthest x values,
  // at index k+d, each stored one past its x so that 0 marks a diagonal no
  // path reached and a fresh array needs no filling.
  let trace = sharedTrace;
  let cap = trace === null ? 0 : trace.length;
  if (cap === 0) {
    trace = new Int32Array(1 << 24);
    sharedTrace = trace;
    cap = trace.length;
  }
  let doneD = -1;
  let doneK = 0;
  let x = 0;
  while (x < n && x < m && a[x] === b[x]) ++x;
  trace[0] = x + 1;
  if (x >= n && x >= m) {
    doneD = 0;
    doneK = 0;
  }
  for (let d = 1; doneD < 0; ++d) {
    if (d > n + m) throw new Error('no script reaches both ends');
    while ((d + 1) * (d + 1) > cap) {
      const grown = new Int32Array(cap * 2);
      grown.set(trace);
      trace = grown;
      sharedTrace = trace;
      cap *= 2;
    }
    const base = d * d;
    const prev = (d - 1) * (d - 1);
    let pd = prev - 2;
    let pa = prev;
    let pw = base;
    for (let k = -d; k <= d; k += 2, pd += 2, pa += 2, pw += 2) {
      let best = -2;
      if (k > -d) {
        const down = trace[pd];
        if (down !== 0 && down <= n) best = down;
      }
      if (k < d) {
        const across = trace[pa];
        if (across !== 0 && across - 1 - k <= m && across - 1 > best) best = across - 1;
      }
      if (best < 0) {
        trace[pw] = 0;
        continue;
      }
      x = best;
      const y = x - k;
      const lim = n - x < m - y ? n - x : m - y;
      let t = 0;
      while (t < lim && a[x + t] === b[y + t]) ++t;
      x += t;
      trace[pw] = x + 1;
      if (x >= n && x - k >= m) {
        doneD = d;
        doneK = k;
        break;
      }
    }
  }
  // Recover the search's own script from the trace: at each level the
  // step's kind is recomputed from the previous row, exactly as the search
  // chose it, and the snake is whatever the row's x gained past that step.
  const rev = [];
  x = trace[doneD * doneD + doneK + doneD] - 1;
  let k = doneK;
  for (let d = doneD; d >= 1; --d) {
    const prev = (d - 1) * (d - 1);
    let down;
    if (k === -d) down = false;
    else if (k === d) down = true;
    else {
      const dv = trace[prev + k + d - 2] - 1;
      const iv = trace[prev + k + d] - 1;
      const byDel = dv >= 0 && dv < n ? dv + 1 : -2;
      const byIns = iv >= 0 && iv - k <= m ? iv : -2;
      down = byDel >= byIns;
    }
    const stepped = down ? trace[prev + k + d - 2] : trace[prev + k + d] - 1;
    const snake = x - stepped;
    if (snake > 0) rev.push([KEPT, snake]);
    if (down) {
      rev.push([TOOK_OUT, 1]);
      x = stepped - 1;
      k -= 1;
    } else {
      rev.push([PUT_IN, 1]);
      x = stepped;
      k += 1;
    }
  }
  if (x > 0) rev.push([KEPT, x]);
  const runs = [];
  for (let i = rev.length - 1; i >= 0; --i) {
    const step = rev[i];
    const tail = runs.length === 0 ? undefined : runs[runs.length - 1];
    if (tail !== undefined && tail[0] === step[0]) tail[1] += step[1];
    else runs.push([step[0], step[1]]);
  }
  return runs;
}

/** The patch of two interned texts, from their runs. */
function renderPatch(oldIds, newIds, table, runs) {
  const n = oldIds.length;
  const m = newIds.length;
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const step of runs) {
    const kind = step[0];
    const count = step[1];
    if (kind === KEPT) {
      o += count;
      p += count;
      continue;
    }
    let c = changes.length === 0 ? undefined : changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (kind === TOOK_OUT) {
      c.dels += count;
      o += count;
      deleted += count;
    } else {
      c.ins += count;
      p += count;
      inserted += count;
    }
  }
  const hunks = [];
  for (const c of changes) {
    const h = hunks.length === 0 ? undefined : hunks[hunks.length - 1];
    const prev = h === undefined ? undefined : h[h.length - 1];
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * SHOW) h.push(c);
    else hunks.push([c]);
  }
  const head = 'makefun-diff/1 old=' + n + ' new=' + m + ' hunks=' + hunks.length +
    ' deleted=' + deleted + ' inserted=' + inserted + '\n';
  const out = [head];
  for (const h of hunks) {
    const first = h[0];
    const tail = h[h.length - 1];
    const oldStart = Math.max(0, first.o - SHOW);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(SHOW, n - (tail.o + tail.dels));
    const oldEnd = tail.o + tail.dels + after;
    const newEnd = tail.p + tail.ins + after;
    out.push('@ ' + (oldStart + 1) + ' ' + (oldEnd - oldStart) + ' ' +
      (newStart + 1) + ' ' + (newEnd - newStart) + '\n');
    let cursor = oldStart;
    for (const c of h) {
      while (cursor < c.o) {
        out.push(patchLine('=', table[oldIds[cursor]]));
        ++cursor;
      }
      for (let i = 0; i < c.dels; ++i) out.push(patchLine('-', table[oldIds[c.o + i]]));
      for (let i = 0; i < c.ins; ++i) out.push(patchLine('+', table[newIds[c.p + i]]));
      cursor = c.o + c.dels;
    }
    while (cursor < oldEnd) {
      out.push(patchLine('=', table[oldIds[cursor]]));
      ++cursor;
    }
  }
  const text = out.join('');
  return text;
}

/** makefun-diff 1.0.0's answer for one case's input, faster. */
export const run = (input) => {
  if (input === null || typeof input !== 'object' ||
      typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('run needs { old, new } as two strings');
  }
  const table = [];
  const seen = new Map();
  const oldIds = internedLines(input.old, table, seen);
  const newIds = internedLines(input.new, table, seen);
  const n = oldIds.length;
  const m = newIds.length;
  let pre = 0;
  while (pre < n && pre < m && oldIds[pre] === newIds[pre]) ++pre;
  let suf = 0;
  while (suf < n - pre && suf < m - pre &&
         oldIds[n - 1 - suf] === newIds[m - 1 - suf]) ++suf;
  const runs = [];
  if (pre > 0) runs.push([KEPT, pre]);
  runs.push(...middleRuns(oldIds.subarray(pre, n - suf), newIds.subarray(pre, m - suf)));
  if (suf > 0) runs.push([KEPT, suf]);
  return renderPatch(oldIds, newIds, table, runs);
};
