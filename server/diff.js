// 两轮命中清单的对比，全部是纯函数：同样的两份清单，任何时候算出来的结论都必须一模一样。
//
// 一条命中以「规则编码 + 文件路径 + 行号」定位。对比时先按规则与文件分组，组内按行号配对：
//   - 两轮行号相同的，算「还在原位」；
//   - 旧的某行没了、但组里还配得上另一个新行号，算「还在但挪了位置」（例如文件开头加了两行，整体下移）；
//   - 配不上对的新条目算「新出现」，配不上对的旧条目算「不再出现」。
// 每个组里同一条规则在同一行至多一条，组内行号互不重复，因此公共行号天然就是最长公共子序列，
// 剩下的按行号顺序两两配对即可，结论唯一、不依赖比对时机。
//
// 三类互不重叠，对账关系：
//   新出现 + 还留着 = 本轮总条数
//   不再出现 + 还留着 = 基线总条数
//   新出现 + 不再出现 + 还留着 = 两轮合起来涉及的条目总数

const SAME = 'same'; // 还留着，位置没变
const MOVED = 'moved'; // 还留着，但行号变了
const ADDED = 'added'; // 本轮新出现
const REMOVED = 'removed'; // 基线里有、本轮不再出现

const STATUS_RANK = { [REMOVED]: 0, [SAME]: 1, [MOVED]: 2, [ADDED]: 3 };

function asList(hits) {
  return Array.isArray(hits) ? hits.filter((item) => item && typeof item === 'object') : [];
}

// 把命中清单按「规则 + 文件」归组，组内按行号排好；同一行重复出现的损坏数据只留第一条
function groupHits(hits) {
  const map = new Map();
  asList(hits).forEach((hit) => {
    const code = typeof hit.code === 'string' ? hit.code : '';
    const filePath = typeof hit.path === 'string' ? hit.path : '';
    const lineNo = Number(hit.lineNo);
    if (!code || !filePath || !Number.isInteger(lineNo) || lineNo < 1) return;
    const key = `${code}\n${filePath}`;
    if (!map.has(key)) {
      map.set(key, { code, path: filePath, byLine: new Map() });
    }
    const group = map.get(key);
    if (!group.byLine.has(lineNo)) {
      group.byLine.set(lineNo, {
        code,
        ruleName: typeof hit.ruleName === 'string' ? hit.ruleName : '',
        level: typeof hit.level === 'string' ? hit.level : '',
        path: filePath,
        lineNo,
        lineText: typeof hit.lineText === 'string' ? hit.lineText : '',
      });
    }
  });
  return map;
}

function sortedLines(group) {
  return Array.from(group.byLine.keys()).sort((a, b) => a - b);
}

// 组内配对：先认行号完全相同的，剩下的旧行与新行各自按行号排序后顺序两两配对
function pairGroup(baseGroup, currentGroup) {
  const baseLines = baseGroup ? sortedLines(baseGroup) : [];
  const currentLines = currentGroup ? sortedLines(currentGroup) : [];
  const currentSet = new Set(currentLines);
  const baseSet = new Set(baseLines);

  const sameLineNos = baseLines.filter((lineNo) => currentSet.has(lineNo));
  const baseLeft = baseLines.filter((lineNo) => !currentSet.has(lineNo));
  const currentLeft = currentLines.filter((lineNo) => !baseSet.has(lineNo));

  // 同一条规则在这个文件里整体挪了位置：按行号顺序一一对应，多出来的才算新增/消失
  const movedCount = Math.min(baseLeft.length, currentLeft.length);
  const movedPairs = [];
  for (let i = 0; i < movedCount; i += 1) {
    movedPairs.push([baseLeft[i], currentLeft[i]]);
  }
  const removedLineNos = baseLeft.slice(movedCount);
  const addedLineNos = currentLeft.slice(movedCount);

  return { sameLineNos, movedPairs, removedLineNos, addedLineNos };
}

// 对比两轮命中。baselineHits 来自存下来的基线，currentHits 来自这一轮扫描
function compareHits(baselineHits, currentHits) {
  const baseMap = groupHits(baselineHits);
  const currentMap = groupHits(currentHits);
  const keys = Array.from(new Set([...baseMap.keys(), ...currentMap.keys()])).sort();

  let added = 0;
  let removed = 0;
  let samePosition = 0;
  let moved = 0;
  const groups = [];
  const entries = [];

  keys.forEach((key) => {
    const baseGroup = baseMap.get(key);
    const currentGroup = currentMap.get(key);
    const pairing = pairGroup(baseGroup, currentGroup);
    const metaSource = currentGroup || baseGroup;
    const metaHit = metaSource.byLine.get(sortedLines(metaSource)[0]);
    const meta = {
      code: metaHit.code,
      ruleName: metaHit.ruleName,
      level: metaHit.level,
      path: metaHit.path,
    };

    const group = {
      code: meta.code,
      ruleName: meta.ruleName,
      level: meta.level,
      path: meta.path,
      added: pairing.addedLineNos.length,
      removed: pairing.removedLineNos.length,
      samePosition: pairing.sameLineNos.length,
      moved: pairing.movedPairs.length,
      entries: [],
    };

    pairing.sameLineNos.forEach((lineNo) => {
      const baseHit = baseGroup.byLine.get(lineNo);
      const currentHit = currentGroup.byLine.get(lineNo);
      samePosition += 1;
      const entry = {
        status: SAME,
        code: meta.code,
        ruleName: meta.ruleName,
        level: currentHit.level || baseHit.level,
        path: meta.path,
        baseLineNo: lineNo,
        currentLineNo: lineNo,
        baseLineText: baseHit.lineText,
        currentLineText: currentHit.lineText,
        lineTextChanged: baseHit.lineText !== currentHit.lineText,
      };
      group.entries.push(entry);
      entries.push(entry);
    });

    pairing.movedPairs.forEach(([baseLineNo, currentLineNo]) => {
      const baseHit = baseGroup.byLine.get(baseLineNo);
      const currentHit = currentGroup.byLine.get(currentLineNo);
      moved += 1;
      const entry = {
        status: MOVED,
        code: meta.code,
        ruleName: currentHit.ruleName || baseHit.ruleName,
        level: currentHit.level || baseHit.level,
        path: meta.path,
        baseLineNo,
        currentLineNo,
        baseLineText: baseHit.lineText,
        currentLineText: currentHit.lineText,
        lineTextChanged: baseHit.lineText !== currentHit.lineText,
      };
      group.entries.push(entry);
      entries.push(entry);
    });

    pairing.addedLineNos.forEach((lineNo) => {
      const hit = currentGroup.byLine.get(lineNo);
      added += 1;
      const entry = {
        status: ADDED,
        code: meta.code,
        ruleName: hit.ruleName,
        level: hit.level,
        path: meta.path,
        baseLineNo: null,
        currentLineNo: lineNo,
        baseLineText: '',
        currentLineText: hit.lineText,
        lineTextChanged: false,
      };
      group.entries.push(entry);
      entries.push(entry);
    });

    pairing.removedLineNos.forEach((lineNo) => {
      const hit = baseGroup.byLine.get(lineNo);
      removed += 1;
      const entry = {
        status: REMOVED,
        code: meta.code,
        ruleName: hit.ruleName,
        level: hit.level,
        path: meta.path,
        baseLineNo: lineNo,
        currentLineNo: null,
        baseLineText: hit.lineText,
        currentLineText: '',
        lineTextChanged: false,
      };
      group.entries.push(entry);
      entries.push(entry);
    });

    group.entries.sort((a, b) => {
      const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      if (rank !== 0) return rank;
      const lineA = a.currentLineNo || a.baseLineNo || 0;
      const lineB = b.currentLineNo || b.baseLineNo || 0;
      return lineA - lineB;
    });
    groups.push(group);
  });

  const remaining = samePosition + moved;
  // 总数按实际参与对比的有效条目计算，恒等式对任何输入都成立
  const countMap = (map) => Array.from(map.values())
    .reduce((sum, group) => sum + group.byLine.size, 0);
  const baselineTotal = countMap(baseMap);
  const currentTotal = countMap(currentMap);

  return {
    counts: {
      added,
      removed,
      remaining,
      samePosition,
      moved,
      baselineTotal,
      currentTotal,
      unionTotal: added + removed + remaining,
    },
    groups,
    entries,
  };
}

module.exports = {
  compareHits,
  groupHits,
  SAME,
  MOVED,
  ADDED,
  REMOVED,
};
