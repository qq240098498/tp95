const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compareHits, SAME, MOVED, ADDED, REMOVED } = require('../server/diff');

const hit = (code, path, lineNo, extra = {}) => ({
  code,
  path,
  ruleName: `${code}-name`,
  level: '警告',
  lineNo,
  lineText: `line ${lineNo}`,
  ...extra,
});

test('全部是新条目：基线为空时都算新出现', () => {
  const result = compareHits([], [hit('CODE-001', 'a.js', 1), hit('CODE-001', 'a.js', 2)]);
  assert.deepEqual(result.counts, {
    added: 2, removed: 0, remaining: 0, samePosition: 0, moved: 0,
    baselineTotal: 0, currentTotal: 2, unionTotal: 2,
  });
});

test('本轮为空：基线里的条目都算不再出现', () => {
  const result = compareHits([hit('CODE-001', 'a.js', 1)], []);
  assert.equal(result.counts.removed, 1);
  assert.equal(result.counts.added, 0);
  assert.equal(result.counts.remaining, 0);
  assert.equal(result.counts.currentTotal, 0);
});

test('行号相同算原位，组内其余按行号顺序配成移动', () => {
  const base = [hit('CODE-001', 'a.js', 1), hit('CODE-001', 'a.js', 2), hit('CODE-001', 'a.js', 5)];
  const current = [hit('CODE-001', 'a.js', 3), hit('CODE-001', 'a.js', 4), hit('CODE-001', 'a.js', 5)];
  const result = compareHits(base, current);
  assert.equal(result.counts.samePosition, 1);
  assert.equal(result.counts.moved, 2);
  assert.equal(result.counts.added, 0);
  assert.equal(result.counts.removed, 0);
  const moved = result.entries.filter((e) => e.status === MOVED);
  assert.deepEqual(moved.map((e) => [e.baseLineNo, e.currentLineNo]).sort(), [[1, 3], [2, 4]]);
});

test('整体位移：行号全不相同也能全部配成移动，不产生增减', () => {
  const result = compareHits(
    [hit('CODE-001', 'a.js', 1), hit('CODE-001', 'a.js', 3)],
    [hit('CODE-001', 'a.js', 2), hit('CODE-001', 'a.js', 4)],
  );
  assert.equal(result.counts.moved, 2);
  assert.equal(result.counts.added, 0);
  assert.equal(result.counts.removed, 0);
});

test('同规则换文件不算同一条：一边不再出现、一边新出现', () => {
  const result = compareHits([hit('CODE-001', 'a.js', 1)], [hit('CODE-001', 'b.js', 1)]);
  assert.equal(result.counts.added, 1);
  assert.equal(result.counts.removed, 1);
  assert.equal(result.counts.remaining, 0);
});

test('同文件换规则也不算同一条', () => {
  const result = compareHits([hit('CODE-001', 'a.js', 1)], [hit('CODE-002', 'a.js', 1)]);
  assert.equal(result.counts.added, 1);
  assert.equal(result.counts.removed, 1);
  assert.equal(result.counts.remaining, 0);
});

test('对账恒等式：三类条数加总等于本轮条数，且任何一条只归一类', () => {
  const base = [
    hit('CODE-001', 'a.js', 1), hit('CODE-001', 'a.js', 4),
    hit('CODE-002', 'b.js', 9), hit('CODE-003', 'old.js', 2),
  ];
  const current = [
    hit('CODE-001', 'a.js', 3), hit('CODE-001', 'a.js', 4), hit('CODE-001', 'a.js', 8),
    hit('CODE-002', 'b.js', 9), hit('CODE-004', 'new.js', 5),
  ];
  const result = compareHits(base, current);
  const { counts } = result;
  assert.equal(counts.added + counts.remaining, counts.currentTotal);
  assert.equal(counts.removed + counts.remaining, counts.baselineTotal);
  assert.equal(counts.added + counts.removed + counts.remaining, counts.unionTotal);
  assert.equal(result.entries.length, counts.unionTotal);

  // 明细层面互斥：同一坐标（规则、文件、本轮行或基线行）不会带两种结论
  const identities = new Set();
  result.entries.forEach((entry) => {
    const key = `${entry.code}|${entry.path}|${entry.status}|${entry.baseLineNo ?? ''}|${entry.currentLineNo ?? ''}`;
    assert.ok(!identities.has(key), `出现重复条目 ${key}`);
    identities.add(key);
  });
  const byStatus = (s) => result.entries.filter((e) => e.status === s).length;
  assert.equal(byStatus(ADDED), counts.added);
  assert.equal(byStatus(REMOVED), counts.removed);
  assert.equal(byStatus(SAME) + byStatus(MOVED), counts.remaining);
});

test('确定性：同样的两轮清单，连算两次结论逐字节一致', () => {
  const base = [hit('CODE-001', 'a.js', 1), hit('CODE-002', 'b.js', 9)];
  const current = [
    hit('CODE-001', 'a.js', 2), hit('CODE-002', 'b.js', 9),
    hit('CODE-003', 'c.js', 3), hit('CODE-001', 'a.js', 7),
  ];
  const first = JSON.stringify(compareHits(base, current));
  const second = JSON.stringify(compareHits(base, current));
  assert.equal(first, second);
});

test('挪位置时标出位移方向，行内容变了也会标出', () => {
  const result = compareHits(
    [hit('CODE-001', 'a.js', 1, { lineText: '旧内容' })],
    [hit('CODE-001', 'a.js', 4, { lineText: '新内容' })],
  );
  const entry = result.entries[0];
  assert.equal(entry.status, MOVED);
  assert.equal(entry.currentLineNo - entry.baseLineNo, 3);
  assert.equal(entry.lineTextChanged, true);
});

test('原位但行内容变了：仍是同一条、位置没变，只标内容变化', () => {
  const result = compareHits(
    [hit('CODE-001', 'a.js', 2, { lineText: 'var x = 1' })],
    [hit('CODE-001', 'a.js', 2, { lineText: 'let x = 1' })],
  );
  const entry = result.entries[0];
  assert.equal(entry.status, SAME);
  assert.equal(entry.lineTextChanged, true);
});

test('同规则同行的重复损坏数据只算一条，总条数也按一条计', () => {
  const result = compareHits(
    [hit('CODE-001', 'a.js', 2), hit('CODE-001', 'a.js', 2)],
    [hit('CODE-001', 'a.js', 2)],
  );
  assert.equal(result.counts.samePosition, 1);
  assert.equal(result.counts.baselineTotal, 1);
  assert.equal(result.counts.added + result.counts.remaining, result.counts.currentTotal);
});

test('下钻分组：按规则与文件归组，组内条数与三类小计自洽', () => {
  const result = compareHits(
    [hit('CODE-001', 'a.js', 1), hit('CODE-001', 'b.js', 1), hit('CODE-002', 'a.js', 1)],
    [hit('CODE-001', 'a.js', 2), hit('CODE-002', 'a.js', 1)],
  );
  assert.equal(result.groups.length, 3);
  const movedGroup = result.groups.find((g) => g.code === 'CODE-001' && g.path === 'a.js');
  assert.equal(movedGroup.moved, 1);
  assert.equal(movedGroup.entries.length, 1);
  const vanished = result.groups.find((g) => g.code === 'CODE-001' && g.path === 'b.js');
  assert.equal(vanished.removed, 1);
});
