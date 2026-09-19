const crypto = require('crypto');
const {
  load,
  save,
  LEVELS,
  MAX_BASELINE_NAME_LENGTH,
  MAX_BASELINE_OPERATOR_LENGTH,
  MAX_BASELINE_HITS,
} = require('./store');
const { ApiError, pickText } = require('./errors');
const { scan } = require('./scan');

function validateName(value) {
  const name = pickText(value);
  if (!name) throw new ApiError(400, 'BASELINE_NAME_REQUIRED', '请给这版基线起个名字', 'baselineName');
  if (name.length > MAX_BASELINE_NAME_LENGTH) {
    throw new ApiError(400, 'BASELINE_NAME_TOO_LONG', `基线名字不能超过 ${MAX_BASELINE_NAME_LENGTH} 个字符`, 'baselineName');
  }
  return name;
}

function validateOperator(value) {
  const operator = pickText(value);
  if (!operator) return '未留名';
  if (operator.length > MAX_BASELINE_OPERATOR_LENGTH) {
    throw new ApiError(400, 'BASELINE_OPERATOR_TOO_LONG', `操作者名字不能超过 ${MAX_BASELINE_OPERATOR_LENGTH} 个字符`, 'baselineName');
  }
  return operator;
}

// 扫描范围三个值都允许留空，留空就是那一维不限制；级别只认清单里的几种
function validateScope(value) {
  const input = value && typeof value === 'object' ? value : {};
  const level = pickText(input.level);
  if (level && !LEVELS.includes(level)) {
    throw new ApiError(400, 'LEVEL_INVALID', `级别只能是 ${LEVELS.join('、')} 其中之一`, 'scanLevel');
  }
  return {
    ruleId: pickText(input.ruleId),
    fileId: pickText(input.fileId),
    level,
  };
}

// 存基线时把范围翻译成一句话，之后规则或文件被删了，页面上也看得出当时扫的是什么
function describeScope(scope, data) {
  const parts = [];
  if (scope.ruleId) {
    const rule = data.rules.find((item) => item.id === scope.ruleId);
    parts.push(rule ? `规则 ${rule.code}` : '规则（已不在清单）');
  } else {
    parts.push('全部规则');
  }
  if (scope.fileId) {
    const file = data.files.find((item) => item.id === scope.fileId);
    parts.push(file ? `文件 ${file.path}` : '文件（已不在清单）');
  } else {
    parts.push('全部文件');
  }
  parts.push(scope.level ? `级别 ${scope.level}` : '全部级别');
  return parts.join(' · ');
}

function validateHits(value) {
  if (!Array.isArray(value)) {
    throw new ApiError(400, 'BASELINE_HITS_INVALID', '这一轮的命中清单需要是数组', '');
  }
  if (value.length > MAX_BASELINE_HITS) {
    throw new ApiError(400, 'BASELINE_HITS_TOO_MANY', `一版基线最多存 ${MAX_BASELINE_HITS} 条命中`, '');
  }
  return value.map((item, index) => {
    const source = item && typeof item === 'object' ? item : {};
    const code = pickText(source.code);
    const filePath = pickText(source.path);
    const lineNo = Number.isInteger(source.lineNo) && source.lineNo > 0 ? source.lineNo : 0;
    if (!code || !filePath || !lineNo) {
      throw new ApiError(400, 'BASELINE_HIT_INVALID', `第 ${index + 1} 条命中缺规则编码、文件路径或行号`, '');
    }
    return {
      code,
      ruleName: typeof source.ruleName === 'string' ? source.ruleName : '',
      level: LEVELS.includes(source.level) ? source.level : LEVELS[0],
      path: filePath,
      fileType: typeof source.fileType === 'string' ? source.fileType : '',
      lineNo,
      lineText: typeof source.lineText === 'string' ? source.lineText : '',
    };
  });
}

// 命中快照统一按规则编码、文件路径、行号排好再落盘，之后每次读出来顺序都一样
function sortHits(hits) {
  return hits.slice().sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return a.lineNo - b.lineNo;
  });
}

// 列表用的基线概要：不带命中明细，只给元数据与当时的总条数
function toMeta(baseline) {
  return {
    id: baseline.id,
    name: baseline.name,
    createdBy: baseline.createdBy,
    createdAt: baseline.createdAt,
    scope: baseline.scope,
    scopeText: baseline.scopeText,
    total: baseline.total,
  };
}

function listBaselines() {
  const data = load();
  return {
    baselines: data.baselines
      .slice()
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
        return a.id < b.id ? -1 : 1;
      })
      .map(toMeta),
  };
}

function findBaseline(data, id) {
  const found = data.baselines.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'BASELINE_NOT_FOUND', '这版基线不存在或已被删除', '');
  return found;
}

function getBaseline(id) {
  const data = load();
  const baseline = findBaseline(data, id);
  return { ...toMeta(baseline), hits: baseline.hits };
}

// 把当前这一轮扫描结果存成一版基线：起个名字，记下谁存的、什么时候存的、一共多少条
function createBaseline(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const scope = validateScope(input.scope);
  const created = {
    id: crypto.randomUUID(),
    name: validateName(input.name),
    createdBy: validateOperator(input.createdBy),
    createdAt: new Date().toISOString(),
    scope,
    scopeText: describeScope(scope, data),
    total: 0,
    hits: sortHits(validateHits(input.hits)),
  };
  created.total = created.hits.length;
  data.baselines.push(created);
  save(data);
  return toMeta(created);
}

function deleteBaseline(id) {
  const data = load();
  const index = data.baselines.findIndex((item) => item.id === id);
  if (index === -1) throw new ApiError(404, 'BASELINE_NOT_FOUND', '这版基线不存在或已被删除', '');
  const [removed] = data.baselines.splice(index, 1);
  save(data);
  return { id: removed.id, name: removed.name };
}

// 一条命中的身份：同一条规则、同一个文件、同一行内容。行号不算身份，
// 行号变了只说明位置挪了，这条命中本身还在
function hitKey(hit) {
  return `${hit.code}\n${hit.path}\n${hit.lineText}`;
}

function groupByKey(hits) {
  const groups = new Map();
  hits.forEach((hit) => {
    const key = hitKey(hit);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(hit);
  });
  groups.forEach((list) => list.sort((a, b) => a.lineNo - b.lineNo));
  return groups;
}

function toItem(status, before, after) {
  const source = after || before;
  return {
    status,
    moved: status === 'kept' && before.lineNo !== after.lineNo,
    code: source.code,
    ruleName: source.ruleName,
    level: source.level,
    path: source.path,
    fileType: source.fileType,
    lineText: source.lineText,
    baseLineNo: before ? before.lineNo : 0,
    lineNo: after ? after.lineNo : 0,
  };
}

// 对比算法：同一条身份在两轮里可能各出现好几次（同一文件里同样的行有好几行），
// 按行号排好一对一配对，配上的算"还在"，多出来的才算"新出现"或"不再出现"。
// 整个过程只依赖输入内容，同样的两份清单换谁算、算几遍，结果都一模一样
function diffHits(baseHits, currentHits) {
  const baseGroups = groupByKey(baseHits);
  const currentGroups = groupByKey(currentHits);
  const keys = new Set([...baseGroups.keys(), ...currentGroups.keys()]);
  const items = [];
  keys.forEach((key) => {
    const before = baseGroups.get(key) || [];
    const after = currentGroups.get(key) || [];
    const paired = Math.min(before.length, after.length);
    for (let i = 0; i < paired; i += 1) items.push(toItem('kept', before[i], after[i]));
    for (let i = paired; i < after.length; i += 1) items.push(toItem('added', null, after[i]));
    for (let i = paired; i < before.length; i += 1) items.push(toItem('removed', before[i], null));
  });
  items.sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    const lineA = a.lineNo || a.baseLineNo;
    const lineB = b.lineNo || b.baseLineNo;
    if (lineA !== lineB) return lineA - lineB;
    if (a.status !== b.status) return a.status < b.status ? -1 : 1;
    return 0;
  });
  return items;
}

function countBy(items, keyOf) {
  const map = new Map();
  items.forEach((item) => {
    const key = keyOf(item);
    if (!map.has(key)) {
      map.set(key, {
        code: item.code,
        ruleName: item.ruleName,
        level: item.level,
        path: item.path,
        fileType: item.fileType,
        added: 0,
        removed: 0,
        kept: 0,
      });
    }
    map.get(key)[item.status] += 1;
  });
  return map;
}

// 拿当前数据按基线当时圈定的范围重新扫一遍，再和基线快照逐条对上
function compareBaseline(id) {
  const data = load();
  const baseline = findBaseline(data, id);

  if (baseline.scope.ruleId && !data.rules.some((item) => item.id === baseline.scope.ruleId)) {
    throw new ApiError(409, 'BASELINE_SCOPE_RULE_GONE', '基线当时圈定的规则已不在清单里，没法按同样的范围再扫一遍', '');
  }
  if (baseline.scope.fileId && !data.files.some((item) => item.id === baseline.scope.fileId)) {
    throw new ApiError(409, 'BASELINE_SCOPE_FILE_GONE', '基线当时圈定的文件已不在清单里，没法按同样的范围再扫一遍', '');
  }

  const current = scan(baseline.scope);
  const items = diffHits(baseline.hits, current.hits);

  const summary = { added: 0, removed: 0, kept: 0, moved: 0 };
  items.forEach((item) => {
    summary[item.status] += 1;
    if (item.moved) summary.moved += 1;
  });
  summary.baselineTotal = baseline.hits.length;
  summary.currentTotal = current.hits.length;

  const byRule = Array.from(countBy(items, (item) => item.code).values())
    .map(({ code, ruleName, level, added, removed, kept }) => ({ code, ruleName, level, added, removed, kept }))
    .sort((a, b) => (a.code < b.code ? -1 : 1));
  const byFile = Array.from(countBy(items, (item) => item.path).values())
    .map(({ path, fileType, added, removed, kept }) => ({ path, fileType, added, removed, kept }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));

  return {
    baseline: toMeta(baseline),
    comparedAt: new Date().toISOString(),
    scannedAt: current.scannedAt,
    summary,
    byRule,
    byFile,
    items,
  };
}

module.exports = {
  listBaselines,
  getBaseline,
  createBaseline,
  deleteBaseline,
  compareBaseline,
  diffHits,
  hitKey,
};
