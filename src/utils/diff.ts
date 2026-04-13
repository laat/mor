/** Remove the phantom empty element produced by splitting a trailing-newline string. */
function stripTrailingEmpty(lines: string[]): string[] {
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    return lines.slice(0, -1);
  }
  return lines;
}

export function unifiedDiff(a: string, b: string, ctx = 3): string {
  const aLines = stripTrailingEmpty(a.split('\n'));
  const bLines = stripTrailingEmpty(b.split('\n'));

  const n = aLines.length;
  const m = bLines.length;
  const max = n + m;
  const v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];
  v.fill(-1);
  v[max] = 0;

  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[k - 1 + max] < v[k + 1 + max])) {
        x = v[k + 1 + max];
      } else {
        x = v[k - 1 + max] + 1;
      }
      let y = x - k;
      while (x < n && y < m && aLines[x] === bLines[y]) {
        x++;
        y++;
      }
      v[k + max] = x;
      if (x >= n && y >= m) break outer;
    }
  }

  type Edit = { type: '=' | '-' | '+'; aLine: number; bLine: number };
  const edits: Edit[] = [];
  let x = n,
    y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vPrev = trace[d];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && vPrev[k - 1 + max] < vPrev[k + 1 + max])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = vPrev[prevK + max];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      edits.push({ type: '=', aLine: x, bLine: y });
    }
    if (d > 0) {
      if (x === prevX) {
        y--;
        edits.push({ type: '+', aLine: x, bLine: y });
      } else {
        x--;
        edits.push({ type: '-', aLine: x, bLine: y });
      }
    }
  }
  edits.reverse();

  const hunks: string[][] = [];
  let hunk: string[] = [];
  let lastChange = -Infinity;
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    if (e.type !== '=') {
      if (i - lastChange > ctx * 2 + 1 && hunk.length > 0) {
        hunks.push(hunk);
        hunk = [];
      }
      for (let c = Math.max(lastChange + ctx + 1, i - ctx, 0); c < i; c++) {
        if (edits[c].type === '=') hunk.push(`  ${aLines[edits[c].aLine]}`);
      }
      lastChange = i;
      if (e.type === '-') hunk.push(`- ${aLines[e.aLine]}`);
      else hunk.push(`+ ${bLines[e.bLine]}`);
    } else if (i - lastChange <= ctx && hunk.length > 0) {
      hunk.push(`  ${aLines[e.aLine]}`);
    }
  }
  if (hunk.length > 0) hunks.push(hunk);

  return hunks.map((h) => h.join('\n')).join('\n...\n');
}
