const crypto = require('crypto');
const {
  load,
  save,
  LEVELS,
  MAX_BASELINE_NAME_LENGTH,
  MAX_OPERATOR_LENGTH,
} = require('./store');
const { ApiError, pickText } = require('./errors');
const { scan } = require('./scan');
const { compareHits } = require('./diff');

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
  if (operator.length > MAX_OPERATOR_LENGTH) {
    throw new ApiError(400, 'OPERATOR_TOO_LONG', `操作者名字不能超过 ${MAX_OPERATOR_LENGTH} 个字符`, 'operator');
  }
  return operator;
}

// 基线只存对比用得着的命中字段，不存规则与文件的内部编号：
// 规则编码与文件路径才是两轮之间认得出来的坐标
function snapshotHits(hits) {
  return hits.map((hit) => ({
    code: hit.code,
    ruleName: hit.ruleName,
    level: hit.level,
    path: hit.path,
    lineNo: hit.lineNo,
    lineText: hit.lineText,
  }));
}

function summaryOf(baseline) {
  return {
    id: baseline.id,
    name: baseline.name,
    operator: baseline.operator,
    savedAt: baseline.savedAt,
    total: baseline.total,
    rulesUsed: baseline.rulesUsed,
    filesInScope: baseline.filesInScope,
    scope: baseline.scope,
  };
}

function sortBaselines(list) {
  return list.slice().sort((a, b) => {
    if (a.savedAt !== b.savedAt) return a.savedAt < b.savedAt ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
}

// 基线清单：只给概要（名字、什么时候、谁存的、当时多少条），不把整份命中带下来
function listBaselines() {
  const data = load();
  return { baselines: sortBaselines(data.baselines).map(summaryOf) };
}

function findBaseline(data, id) {
  const found = data.baselines.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'BASELINE_NOT_FOUND', '这版基线不存在或已被删除', '');
  return found;
}

function getBaseline(id) {
  const data = load();
  return findBaseline(data, id);
}

// 把某一轮扫描结果存成基线：先按提交的范围当场扫一遍，再把命中快照连同名字、操作者一起落盘
function saveBaseline(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const name = validateName(input.name);
  const operator = validateOperator(input.operator);

  const result = scan({
    level: pickText(input.level),
    fileId: pickText(input.fileId),
    ruleId: pickText(input.ruleId),
  });

  const data = load();
  const now = new Date().toISOString();
  const scopeRule = data.rules.find((item) => item.id === pickText(input.ruleId)) || null;
  const scopeFile = data.files.find((item) => item.id === pickText(input.fileId)) || null;
  const baseline = {
    id: crypto.randomUUID(),
    name,
    operator,
    savedAt: now,
    scope: {
      ruleId: pickText(input.ruleId),
      fileId: pickText(input.fileId),
      level: pickText(input.level),
      // 顺手记下范围的文本，规则或文件后来被删改后，页面仍能说清当时扫的是哪一条、哪一个
      ruleCode: scopeRule ? scopeRule.code : '',
      filePath: scopeFile ? scopeFile.path : '',
    },
    rulesUsed: result.rulesUsed,
    filesInScope: result.filesInScope,
    total: result.hits.length,
    hits: snapshotHits(result.hits),
  };
  data.baselines.push(baseline);
  save(data);
  return { ...summaryOf(baseline), hits: baseline.hits, scan: result };
}

function deleteBaseline(id) {
  const data = load();
  const found = findBaseline(data, id);
  data.baselines = data.baselines.filter((item) => item.id !== id);
  save(data);
  return { id: found.id, name: found.name };
}

// 按基线对比：默认沿用存基线时的扫描范围，也可以在请求体里另给范围；
// 当场扫出本轮清单后交给纯函数对比，连着算两次结论完全一致
function compareBaseline(id, payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const baseline = findBaseline(data, id);

  const pickScope = (value, saved) => {
    const text = pickText(value);
    // 请求里没带这个条件（undefined / 空串）就沿用基线当时的范围，传了空串以外的值则以本次为准
    return value === undefined || value === null ? saved : text;
  };
  const scope = {
    ruleId: pickScope(input.ruleId, baseline.scope.ruleId),
    fileId: pickScope(input.fileId, baseline.scope.fileId),
    level: pickScope(input.level, baseline.scope.level),
  };
  if (scope.level && !LEVELS.includes(scope.level)) {
    throw new ApiError(400, 'LEVEL_INVALID', `级别只能是 ${LEVELS.join('、')} 其中之一`, 'scanLevel');
  }

  const current = scan(scope);
  const diff = compareHits(baseline.hits, current.hits);
  return {
    baseline: summaryOf(baseline),
    scope,
    current: {
      scannedAt: current.scannedAt,
      rulesUsed: current.rulesUsed,
      filesInScope: current.filesInScope,
      warning: current.warning,
      total: current.summary.total,
      hits: current.hits,
    },
    diff,
  };
}

module.exports = {
  listBaselines,
  getBaseline,
  saveBaseline,
  deleteBaseline,
  compareBaseline,
};
