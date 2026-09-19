// 页面交互：规则、文件与扫描三块都从服务端拉取，任何一步失败都把说明显示在顶部并标到对应输入项上

const state = {
  rules: [],
  files: [],
  levels: [],
  statuses: [],
  fileTypes: [],
  ruleLevels: [],
  ruleStatuses: [],
  ruleFileTypes: [],
  editingRuleId: '',
  editingFileId: '',
  lastScan: null,
  baselines: [],
  lastComparison: null,
};

const el = (id) => document.getElementById(id);

// 统一的请求入口：出错时把服务端给的错误码、说明与出错位置一起抛出去
async function request(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch (err) {
    payload = null;
  }
  if (!res.ok) {
    const error = (payload && payload.error) || {};
    const failure = new Error(error.message || `请求失败（状态码 ${res.status}）`);
    failure.code = error.code || '';
    failure.field = error.field || '';
    throw failure;
  }
  return payload;
}

function notify(message, kind) {
  const box = el('notice');
  box.textContent = message;
  box.className = `notice ${kind === 'ok' ? 'ok' : 'error'}`;
}

function clearNotice() {
  const box = el('notice');
  box.className = 'notice hidden';
  box.textContent = '';
}

function clearFieldMarks() {
  document.querySelectorAll('.invalid').forEach((node) => node.classList.remove('invalid'));
}

// 把出错位置标到具体输入项上：规则区与文件区共用一套标记
function markField(field) {
  if (!field) return;
  const target = document.querySelector(`[data-field="${field}"]`);
  if (!target) return;
  target.classList.add('invalid');
  const input = target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA'
    ? target
    : target.querySelector('input, select, textarea');
  if (input) input.focus();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function levelClass(level) {
  if (level === '错误') return 'lv-error';
  if (level === '警告') return 'lv-warn';
  return 'lv-hint';
}

const OPERATOR_KEY = 'check-hits-operator';

function currentOperator() {
  return el('operator').value.trim();
}

function restoreOperator() {
  el('operator').value = window.localStorage.getItem(OPERATOR_KEY) || '';
}

async function loadHealth() {
  try {
    await request('/api/health');
    el('health').textContent = '服务正常';
    el('health').className = 'health ok';
  } catch (err) {
    el('health').textContent = '服务连不上';
    el('health').className = 'health bad';
  }
}

async function loadRules() {
  const params = new URLSearchParams();
  const level = el('rule-filter-level').value;
  const status = el('rule-filter-status').value;
  const fileType = el('rule-filter-type').value;
  const keyword = el('rule-filter-keyword').value.trim();
  if (level) params.set('level', level);
  if (status) params.set('status', status);
  if (fileType) params.set('fileType', fileType);
  if (keyword) params.set('keyword', keyword);
  const query = params.toString();
  const payload = await request(`/api/rules${query ? `?${query}` : ''}`);
  state.rules = payload.rules || [];
  state.levels = payload.levels || [];
  state.statuses = payload.statuses || [];
  state.fileTypes = payload.fileTypes || [];
  renderRuleFilters();
  renderRules();
  renderScanRuleOptions();
}

async function loadFiles() {
  const params = new URLSearchParams();
  const type = el('file-filter-type').value;
  const keyword = el('file-filter-keyword').value.trim();
  if (type) params.set('type', type);
  if (keyword) params.set('keyword', keyword);
  const query = params.toString();
  const payload = await request(`/api/files${query ? `?${query}` : ''}`);
  state.files = payload.files || [];
  state.ruleFileTypes = payload.fileTypes || [];
  renderFileFilters();
  renderFiles();
  renderScanFileOptions();
}

function renderRuleFilters() {
  const levelSelect = el('rule-filter-level');
  const levelCurrent = levelSelect.value;
  levelSelect.innerHTML = '<option value="">全部级别</option>'
    + state.levels.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.levels.includes(levelCurrent)) levelSelect.value = levelCurrent;

  const statusSelect = el('rule-filter-status');
  const statusCurrent = statusSelect.value;
  statusSelect.innerHTML = '<option value="">全部状态</option>'
    + state.statuses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.statuses.includes(statusCurrent)) statusSelect.value = statusCurrent;

  const typeSelect = el('rule-filter-type');
  const typeCurrent = typeSelect.value;
  typeSelect.innerHTML = '<option value="">全部适用文件类型</option>'
    + state.fileTypes.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.fileTypes.includes(typeCurrent)) typeSelect.value = typeCurrent;

  const formLevel = el('rule-level');
  const formLevelCurrent = formLevel.value;
  formLevel.innerHTML = state.levels.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.levels.includes(formLevelCurrent)) formLevel.value = formLevelCurrent;

  const formStatus = el('rule-status');
  const formStatusCurrent = formStatus.value;
  formStatus.innerHTML = state.statuses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.statuses.includes(formStatusCurrent)) formStatus.value = formStatusCurrent;

  const formType = el('rule-file-type');
  const formTypeCurrent = formType.value;
  formType.innerHTML = state.fileTypes.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.fileTypes.includes(formTypeCurrent)) formType.value = formTypeCurrent;

  const scanLevel = el('scan-level');
  const scanLevelCurrent = scanLevel.value;
  scanLevel.innerHTML = '<option value="">全部级别</option>'
    + state.levels.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.levels.includes(scanLevelCurrent)) scanLevel.value = scanLevelCurrent;
}

function renderFileFilters() {
  const typeSelect = el('file-filter-type');
  const current = typeSelect.value;
  typeSelect.innerHTML = '<option value="">全部类型</option>'
    + state.ruleFileTypes.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.ruleFileTypes.includes(current)) typeSelect.value = current;
}

function renderScanRuleOptions() {
  const select = el('scan-rule');
  const current = select.value;
  select.innerHTML = '<option value="">全部规则</option>'
    + state.rules.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.code)} ${escapeHtml(item.name)}</option>`).join('');
  if (state.rules.some((item) => item.id === current)) select.value = current;
}

function renderScanFileOptions() {
  const select = el('scan-file');
  const current = select.value;
  select.innerHTML = '<option value="">全部文件</option>'
    + state.files.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.path)}</option>`).join('');
  if (state.files.some((item) => item.id === current)) select.value = current;
}

function renderRules() {
  const body = el('rule-body');
  body.innerHTML = state.rules.map((item) => `<tr>
      <td class="mono">${escapeHtml(item.code)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td><span class="tag ${levelClass(item.level)}">${escapeHtml(item.level)}</span></td>
      <td>${escapeHtml(item.status)}</td>
      <td>${escapeHtml(item.fileType)}</td>
      <td class="mono">${escapeHtml(item.pattern)}</td>
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td class="mono">${escapeHtml(formatTime(item.updatedAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-rule-edit="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="link danger" data-rule-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('rule-empty').classList.toggle('hidden', state.rules.length > 0);
}

function renderFiles() {
  const body = el('file-body');
  body.innerHTML = state.files.map((item) => `<tr>
      <td class="mono">${escapeHtml(item.path)}</td>
      <td>${escapeHtml(item.type)}</td>
      <td>${item.lineCount} 行</td>
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td class="mono">${escapeHtml(formatTime(item.updatedAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-file-view="${escapeHtml(item.id)}">看内容</button>
        <button type="button" class="link" data-file-edit="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="link danger" data-file-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('file-empty').classList.toggle('hidden', state.files.length > 0);
}

function openRuleForm(rule) {
  state.editingRuleId = rule ? rule.id : '';
  el('rule-form-title').textContent = rule ? `编辑规则：${rule.code}` : '新建规则';
  el('rule-code').value = rule ? rule.code : '';
  el('rule-name').value = rule ? rule.name : '';
  el('rule-level').value = rule ? rule.level : (state.levels[0] || '提示');
  el('rule-status').value = rule ? rule.status : (state.statuses[0] || '启用');
  el('rule-file-type').value = rule ? rule.fileType : (state.fileTypes[0] || '全部');
  el('rule-pattern').value = rule ? rule.pattern : '';
  el('rule-note').value = rule ? rule.note : '';
  el('rule-form').classList.remove('hidden');
  el('rule-code').focus();
}

function closeRuleForm() {
  state.editingRuleId = '';
  el('rule-form').classList.add('hidden');
  clearFieldMarks();
}

function openFileForm(file) {
  state.editingFileId = file ? file.id : '';
  el('file-form-title').textContent = file ? `编辑文件：${file.path}` : '收录新文件';
  el('file-path').value = file ? file.path : '';
  el('file-content').value = file ? file.content : '';
  el('file-note').value = file ? file.note : '';
  el('file-form').classList.remove('hidden');
  el('file-path').focus();
}

function closeFileForm() {
  state.editingFileId = '';
  el('file-form').classList.add('hidden');
  clearFieldMarks();
}

async function showFileContent(id) {
  clearNotice();
  try {
    const file = await request(`/api/files/${encodeURIComponent(id)}`);
    const preview = el('file-preview');
    preview.textContent = `${file.path}（${file.lineCount} 行）\n${'─'.repeat(40)}\n${file.content}`;
    preview.classList.remove('hidden');
  } catch (err) {
    notify(err.message, 'error');
  }
}

async function submitRule(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    code: el('rule-code').value,
    name: el('rule-name').value,
    level: el('rule-level').value,
    status: el('rule-status').value,
    fileType: el('rule-file-type').value,
    pattern: el('rule-pattern').value,
    note: el('rule-note').value,
  };
  const editing = state.editingRuleId;
  try {
    if (editing) {
      await request(`/api/rules/${encodeURIComponent(editing)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      notify('规则已保存', 'ok');
    } else {
      await request('/api/rules', { method: 'POST', body: JSON.stringify(payload) });
      notify('规则已新增', 'ok');
    }
    closeRuleForm();
    await loadRules();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

async function submitFile(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    path: el('file-path').value,
    content: el('file-content').value,
    note: el('file-note').value,
  };
  const editing = state.editingFileId;
  try {
    if (editing) {
      await request(`/api/files/${encodeURIComponent(editing)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      notify('文件已保存', 'ok');
    } else {
      await request('/api/files', { method: 'POST', body: JSON.stringify(payload) });
      notify('文件已收录', 'ok');
    }
    closeFileForm();
    await loadFiles();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

// 扫一遍，把概要与命中清单都画出来
async function runScan() {
  clearNotice();
  const body = {
    ruleId: el('scan-rule').value,
    fileId: el('scan-file').value,
    level: el('scan-level').value,
  };
  try {
    const result = await request('/api/scan', { method: 'POST', body: JSON.stringify(body) });
    state.lastScan = result;
    renderScan(result);
  } catch (err) {
    notify(err.message, 'error');
  }
}

function renderScan(result) {
  el('scan-meta').textContent = `扫描时刻 ${formatTime(result.scannedAt)}　参与比对的规则 ${result.rulesUsed} 条（启用共 ${result.enabledRules} 条）　范围里的文件 ${result.filesInScope} 个（清单共 ${result.filesTotal} 个）`;

  const warningBox = el('scan-warning');
  if (result.warning) {
    warningBox.textContent = result.warning;
    warningBox.classList.remove('hidden');
  } else {
    warningBox.classList.add('hidden');
    warningBox.textContent = '';
  }

  const summaryBox = el('scan-summary');
  const levelText = Object.keys(result.summary.byLevel)
    .map((key) => `${key} ${result.summary.byLevel[key]} 条`)
    .join('　');
  const ruleText = result.summary.byRule
    .map((item) => `${item.code} ${item.count} 条`)
    .join('　') || '没有规则命中';
  const fileText = result.summary.byFile
    .map((item) => `${item.path} ${item.count} 条`)
    .join('　') || '没有文件命中';
  summaryBox.innerHTML = `
    <div class="summary-line"><strong>一共命中 ${result.summary.total} 条</strong>　${escapeHtml(levelText)}</div>
    <div class="summary-line">按规则：${escapeHtml(ruleText)}</div>
    <div class="summary-line">按文件：${escapeHtml(fileText)}</div>`;
  summaryBox.classList.remove('hidden');

  const body = el('hit-body');
  body.innerHTML = result.hits.map((hit) => `<tr>
      <td class="mono">${escapeHtml(hit.code)}</td>
      <td><span class="tag ${levelClass(hit.level)}">${escapeHtml(hit.level)}</span></td>
      <td>${escapeHtml(hit.ruleName)}</td>
      <td class="mono">${escapeHtml(hit.path)}</td>
      <td class="mono">${hit.lineNo}</td>
      <td class="mono line-cell">${escapeHtml(hit.lineText)}</td>
    </tr>`).join('');
  el('hit-empty').classList.toggle('hidden', result.hits.length > 0);
}

// ───────────────────────── 基线与对比 ─────────────────────────

const DIFF_META = {
  added: { label: '新出现', className: 'df-added' },
  removed: { label: '不再出现', className: 'df-removed' },
  same: { label: '还在原位', className: 'df-same' },
  moved: { label: '还在但挪了位置', className: 'df-moved' },
};

function diffMeta(status) {
  return DIFF_META[status] || { label: status, className: '' };
}

async function loadBaselines() {
  const payload = await request('/api/baselines');
  state.baselines = payload.baselines || [];
  renderBaselines();
}

function scopeText(scope) {
  const parts = [];
  parts.push(scope.ruleCode ? `规则 ${scope.ruleCode}` : '全部规则');
  parts.push(scope.filePath ? `文件 ${scope.filePath}` : '全部文件');
  if (scope.level) parts.push(`仅 ${scope.level}`);
  return parts.join('　');
}

function renderBaselines() {
  const body = el('baseline-body');
  body.innerHTML = state.baselines.map((item) => `<tr>
      <td>${escapeHtml(item.name)}</td>
      <td class="mono">${escapeHtml(formatTime(item.savedAt))}</td>
      <td>${escapeHtml(item.operator || '未署名')}</td>
      <td><strong>${item.total}</strong> 条</td>
      <td class="note-cell">${escapeHtml(scopeText(item.scope || {}))}</td>
      <td class="actions">
        <button type="button" class="link" data-baseline-compare="${escapeHtml(item.id)}">对比本轮</button>
        <button type="button" class="link danger" data-baseline-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('baseline-empty').classList.toggle('hidden', state.baselines.length > 0);

  const select = el('baseline-pick');
  const current = select.value;
  select.innerHTML = '<option value="">选择一版基线来对比</option>'
    + state.baselines.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}（${item.total} 条 · ${escapeHtml(formatTime(item.savedAt))}）</option>`).join('');
  if (state.baselines.some((item) => item.id === current)) select.value = current;
}

// 把当前筛选范围当场扫一遍并存成基线，操作者取页面右上角填的名字
async function saveCurrentBaseline() {
  clearNotice();
  clearFieldMarks();
  const name = el('baseline-name').value.trim();
  const operator = currentOperator();
  if (!operator) {
    notify('请先在右上角填写当前操作者，基线要记下是谁存的', 'error');
    markField('operator');
    return;
  }
  if (!name) {
    notify('请给这版基线起个名字', 'error');
    markField('baselineName');
    return;
  }
  try {
    const created = await request('/api/baselines', {
      method: 'POST',
      body: JSON.stringify({
        name,
        operator,
        ruleId: el('scan-rule').value,
        fileId: el('scan-file').value,
        level: el('scan-level').value,
      }),
    });
    el('baseline-name').value = '';
    await loadBaselines();
    el('baseline-pick').value = created.id;
    // 存基线时服务端按同一范围重扫了一遍，顺手把这轮结果画到命中清单区
    state.lastScan = created.scan;
    renderScan(created.scan);
    notify(`基线「${created.name}」已存好，当时命中 ${created.total} 条`, 'ok');
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

async function removeBaseline(id) {
  const found = state.baselines.find((item) => item.id === id);
  if (!window.confirm(`确定删除基线「${found ? found.name : ''}」吗？删除后不能再按它对比。`)) return;
  try {
    await request(`/api/baselines/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (state.lastComparison && state.lastComparison.baseline.id === id) {
      el('compare-box').classList.add('hidden');
      state.lastComparison = null;
    }
    notify('基线已删除', 'ok');
    await loadBaselines();
  } catch (err) {
    notify(err.message, 'error');
  }
}

async function runCompare(id) {
  clearNotice();
  const baselineId = id || el('baseline-pick').value;
  if (!baselineId) {
    notify('先在上面选择一版基线', 'error');
    return;
  }
  try {
    // 请求体不带范围，服务端沿用存基线时的规则、文件与级别条件，保证两轮口径一致
    const result = await request(`/api/baselines/${encodeURIComponent(baselineId)}/compare`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    state.lastComparison = result;
    el('baseline-pick').value = baselineId;
    renderComparison(result);
  } catch (err) {
    notify(err.message, 'error');
  }
}

function renderCompareFilters(result) {
  const ruleSelect = el('compare-rule');
  const ruleCurrent = ruleSelect.value;
  const ruleKeys = [];
  const ruleMap = new Map();
  result.diff.entries.forEach((entry) => {
    if (!ruleMap.has(entry.code)) {
      ruleMap.set(entry.code, `${entry.code} ${entry.ruleName}`);
      ruleKeys.push(entry.code);
    }
  });
  ruleSelect.innerHTML = '<option value="">全部规则</option>'
    + ruleKeys.map((code) => `<option value="${escapeHtml(code)}">${escapeHtml(ruleMap.get(code))}</option>`).join('');
  if (ruleKeys.includes(ruleCurrent)) ruleSelect.value = ruleCurrent;

  const fileSelect = el('compare-file');
  const fileCurrent = fileSelect.value;
  const paths = Array.from(new Set(result.diff.entries.map((entry) => entry.path))).sort();
  fileSelect.innerHTML = '<option value="">全部文件</option>'
    + paths.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  if (paths.includes(fileCurrent)) fileSelect.value = fileCurrent;
}

function renderComparison(result) {
  const { counts } = result.diff;
  const box = el('compare-box');
  box.classList.remove('hidden');

  el('compare-title').textContent = `按基线「${result.baseline.name}」对比本轮`;
  el('compare-meta').innerHTML = `基线由 <strong>${escapeHtml(result.baseline.operator || '未署名')}</strong>`
    + ` 存于 ${escapeHtml(formatTime(result.baseline.savedAt))}，当时命中 <strong>${counts.baselineTotal}</strong> 条`
    + `（${escapeHtml(scopeText(result.baseline.scope || {}))}）；本轮扫描时刻 ${escapeHtml(formatTime(result.current.scannedAt))}`
    + `，范围里规则 ${result.current.rulesUsed} 条、文件 ${result.current.filesInScope} 个，命中 <strong>${counts.currentTotal}</strong> 条。`;

  const warningBox = el('compare-warning');
  if (result.current.warning) {
    warningBox.textContent = result.current.warning;
    warningBox.classList.remove('hidden');
  } else {
    warningBox.classList.add('hidden');
    warningBox.textContent = '';
  }

  el('compare-cards').innerHTML = `
    <button type="button" class="compare-card df-added-card" data-quick-status="added">
      <span class="compare-card-num">${counts.added}</span>
      <span class="compare-card-label">新出现</span>
      <span class="compare-card-sub">基线里没有，本轮冒出来</span>
    </button>
    <button type="button" class="compare-card df-removed-card" data-quick-status="removed">
      <span class="compare-card-num">${counts.removed}</span>
      <span class="compare-card-label">不再出现</span>
      <span class="compare-card-sub">基线里有，本轮没了</span>
    </button>
    <button type="button" class="compare-card df-remaining-card" data-quick-status="remaining">
      <span class="compare-card-num">${counts.remaining}</span>
      <span class="compare-card-label">还留着</span>
      <span class="compare-card-sub">原位 ${counts.samePosition} 条 · 挪位 ${counts.moved} 条</span>
    </button>`;

  // 三类条数对账：新出现 + 还留着 必须等于本轮总条数；不再出现 + 还留着 必须等于基线总条数
  const addsUp = counts.added + counts.remaining === counts.currentTotal
    && counts.removed + counts.remaining === counts.baselineTotal;
  const checkBox = el('compare-check');
  checkBox.textContent = `对账：新出现 ${counts.added} ＋ 还留着 ${counts.remaining} ＝ 本轮 ${counts.currentTotal} 条；`
    + `不再出现 ${counts.removed} ＋ 还留着 ${counts.remaining} ＝ 基线 ${counts.baselineTotal} 条。`
    + `每条命中只归入其中一类，互不重复。`;
  checkBox.className = `compare-check ${addsUp ? 'ok' : 'bad'}`;

  renderCompareFilters(result);
  el('compare-status').value = 'all';
  el('compare-keyword').value = '';
  renderCompareEntries();
}

function positionText(entry) {
  if (entry.status === 'same') return `${entry.baseLineNo} → ${entry.currentLineNo}，位置没变`;
  if (entry.status === 'moved') {
    const delta = entry.currentLineNo - entry.baseLineNo;
    const direction = delta > 0 ? `下移 ${delta} 行` : `上移 ${-delta} 行`;
    return `${entry.baseLineNo} → ${entry.currentLineNo}，${direction}`;
  }
  return '';
}

function renderCompareEntries() {
  const result = state.lastComparison;
  if (!result) return;
  const status = el('compare-status').value;
  const ruleCode = el('compare-rule').value;
  const filePath = el('compare-file').value;
  const keyword = el('compare-keyword').value.trim().toLowerCase();

  const matchStatus = (entry) => {
    if (status === 'all') return true;
    if (status === 'remaining') return entry.status === 'same' || entry.status === 'moved';
    return entry.status === status;
  };

  const rows = result.diff.entries.filter((entry) => {
    if (!matchStatus(entry)) return false;
    if (ruleCode && entry.code !== ruleCode) return false;
    if (filePath && entry.path !== filePath) return false;
    if (keyword) {
      const haystack = `${entry.code} ${entry.ruleName} ${entry.path} ${entry.baseLineText} ${entry.currentLineText}`.toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });

  const body = el('compare-body');
  body.innerHTML = rows.map((entry) => {
    const meta = diffMeta(entry.status);
    const baseLine = entry.baseLineNo ? entry.baseLineNo : '—';
    const currentLine = entry.currentLineNo ? entry.currentLineNo : '—';
    const shownText = entry.status === 'removed' ? entry.baseLineText : entry.currentLineText;
    let positionNote = '';
    if (entry.status === 'same') positionNote = '位置没变';
    if (entry.status === 'moved') positionNote = positionText(entry);
    if ((entry.status === 'same' || entry.status === 'moved') && entry.lineTextChanged) {
      positionNote += positionNote ? '；行内容已变' : '行内容已变';
    }
    return `<tr>
      <td><span class="diff-tag ${meta.className}">${meta.label}</span>${positionNote ? `<div class="pos-note">${escapeHtml(positionNote)}</div>` : ''}</td>
      <td class="mono">${escapeHtml(entry.code)}</td>
      <td>${entry.level ? `<span class="tag ${levelClass(entry.level)}">${escapeHtml(entry.level)}</span>` : ''}</td>
      <td class="mono">${escapeHtml(entry.path)}</td>
      <td class="mono">${baseLine}</td>
      <td class="mono">${currentLine}</td>
      <td class="mono line-cell">${escapeHtml(shownText)}</td>
    </tr>`;
  }).join('');
  el('compare-empty').classList.toggle('hidden', rows.length > 0);
}

// 列表上的操作用事件委托统一处理，列表重绘之后不需要重新绑定
document.addEventListener('click', async (event) => {
  const node = event.target.closest('button');
  if (!node) return;

  if (node.dataset.ruleEdit) {
    clearNotice();
    const found = state.rules.find((item) => item.id === node.dataset.ruleEdit);
    if (found) openRuleForm(found);
    return;
  }

  if (node.dataset.ruleDelete) {
    clearNotice();
    const found = state.rules.find((item) => item.id === node.dataset.ruleDelete);
    if (!window.confirm(`确定删除规则 ${found ? found.code : ''} 吗？`)) return;
    try {
      await request(`/api/rules/${encodeURIComponent(node.dataset.ruleDelete)}`, { method: 'DELETE' });
      if (state.editingRuleId === node.dataset.ruleDelete) closeRuleForm();
      notify('规则已删除', 'ok');
      await loadRules();
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.fileView) {
    await showFileContent(node.dataset.fileView);
    return;
  }

  if (node.dataset.fileEdit) {
    clearNotice();
    try {
      const file = await request(`/api/files/${encodeURIComponent(node.dataset.fileEdit)}`);
      openFileForm(file);
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.fileDelete) {
    clearNotice();
    const found = state.files.find((item) => item.id === node.dataset.fileDelete);
    if (!window.confirm(`确定把 ${found ? found.path : ''} 移出清单吗？`)) return;
    try {
      await request(`/api/files/${encodeURIComponent(node.dataset.fileDelete)}`, { method: 'DELETE' });
      if (state.editingFileId === node.dataset.fileDelete) closeFileForm();
      el('file-preview').classList.add('hidden');
      notify('文件已移出清单', 'ok');
      await loadFiles();
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.baselineCompare) {
    await runCompare(node.dataset.baselineCompare);
    return;
  }

  if (node.dataset.baselineDelete) {
    await removeBaseline(node.dataset.baselineDelete);
    return;
  }

  if (node.dataset.quickStatus) {
    el('compare-status').value = node.dataset.quickStatus;
    renderCompareEntries();
  }
});

el('rule-form').addEventListener('submit', submitRule);
el('file-form').addEventListener('submit', submitFile);
el('rule-new').addEventListener('click', () => {
  clearNotice();
  openRuleForm(null);
});
el('rule-cancel').addEventListener('click', closeRuleForm);
el('file-new').addEventListener('click', () => {
  clearNotice();
  openFileForm(null);
});
el('file-cancel').addEventListener('click', closeFileForm);
el('rule-filter-apply').addEventListener('click', () => {
  clearNotice();
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('rule-filter-reset').addEventListener('click', () => {
  el('rule-filter-level').value = '';
  el('rule-filter-status').value = '';
  el('rule-filter-type').value = '';
  el('rule-filter-keyword').value = '';
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('rule-refresh').addEventListener('click', () => {
  clearNotice();
  loadRules()
    .then(loadFiles)
    .catch((err) => notify(err.message, 'error'));
});
el('file-filter-apply').addEventListener('click', () => {
  clearNotice();
  loadFiles().catch((err) => notify(err.message, 'error'));
});
el('file-filter-reset').addEventListener('click', () => {
  el('file-filter-type').value = '';
  el('file-filter-keyword').value = '';
  loadFiles().catch((err) => notify(err.message, 'error'));
});
el('scan-run').addEventListener('click', runScan);
el('baseline-save').addEventListener('click', saveCurrentBaseline);
el('baseline-compare').addEventListener('click', () => runCompare().catch((err) => notify(err.message, 'error')));
el('baseline-refresh').addEventListener('click', () => {
  clearNotice();
  loadBaselines().catch((err) => notify(err.message, 'error'));
});
el('compare-close').addEventListener('click', () => {
  el('compare-box').classList.add('hidden');
});
el('compare-status').addEventListener('change', renderCompareEntries);
el('compare-rule').addEventListener('change', renderCompareEntries);
el('compare-file').addEventListener('change', renderCompareEntries);
el('compare-keyword').addEventListener('input', renderCompareEntries);
el('rule-filter-level').addEventListener('change', () => {
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('rule-filter-status').addEventListener('change', () => {
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('operator').addEventListener('change', () => {
  window.localStorage.setItem(OPERATOR_KEY, currentOperator());
});

// 页面打开时先把规则与文件都拉一遍，扫描的范围下拉依赖这两份清单；基线清单也一起拉
restoreOperator();
loadHealth();
loadRules()
  .then(loadFiles)
  .then(loadBaselines)
  .catch((err) => notify(err.message, 'error'));
