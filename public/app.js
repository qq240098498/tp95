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
  lastScanScope: null,
  baselines: [],
  compare: null,
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

// 扫一遍，把概要与命中清单都画出来；同时记下这一轮的扫描范围，存基线时原样带上
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
    state.lastScanScope = body;
    el('baseline-open-form').disabled = false;
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

// ---------- 基线：存起来、列出来、删掉 ----------

async function loadBaselines() {
  const payload = await request('/api/baselines');
  state.baselines = payload.baselines || [];
  renderBaselines();
}

function renderBaselines() {
  const body = el('baseline-body');
  body.innerHTML = state.baselines.map((item) => `<tr>
      <td>${escapeHtml(item.name)}</td>
      <td class="mono">${escapeHtml(formatTime(item.createdAt))}</td>
      <td>${escapeHtml(item.createdBy)}</td>
      <td class="mono">${item.total} 条</td>
      <td class="note-cell">${escapeHtml(item.scopeText)}</td>
      <td class="actions">
        <button type="button" class="link" data-baseline-compare="${escapeHtml(item.id)}">对比</button>
        <button type="button" class="link danger" data-baseline-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('baseline-empty').classList.toggle('hidden', state.baselines.length > 0);
}

function openBaselineForm() {
  if (!state.lastScan) return;
  clearNotice();
  const operator = currentOperator() || '未留名';
  el('baseline-hint').textContent = `将以「${operator}」的名义保存，这一轮一共 ${state.lastScan.summary.total} 条命中`;
  el('baseline-name').value = '';
  el('baseline-form').classList.remove('hidden');
  el('baseline-name').focus();
}

function closeBaselineForm() {
  el('baseline-form').classList.add('hidden');
  clearFieldMarks();
}

// 把页面上这一轮扫描结果原样存成基线，范围也用扫描时选的那一套
async function submitBaseline(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  if (!state.lastScan) return;
  const payload = {
    name: el('baseline-name').value,
    createdBy: currentOperator(),
    scope: state.lastScanScope,
    hits: state.lastScan.hits,
  };
  try {
    await request('/api/baselines', { method: 'POST', body: JSON.stringify(payload) });
    notify('基线已保存', 'ok');
    closeBaselineForm();
    await loadBaselines();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

// ---------- 按基线对比 ----------

const COMPARE_STATUS_TEXT = { added: '新出现', removed: '不再出现', kept: '还在' };

async function runCompare(id) {
  clearNotice();
  try {
    const payload = await request(`/api/baselines/${encodeURIComponent(id)}/compare`);
    state.compare = { baselineId: id, data: payload, filterStatus: '', filterCode: '', filterPath: '' };
    renderCompare();
    el('compare-area').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    notify(err.message, 'error');
  }
}

function closeCompare() {
  state.compare = null;
  el('compare-area').classList.add('hidden');
}

function renderCompare() {
  const compare = state.compare;
  if (!compare) return;
  const { data } = compare;
  const { summary, baseline } = data;

  el('compare-title').textContent = `与基线「${baseline.name}」对比`;
  el('compare-summary').innerHTML = `
    <div class="summary-line">基线「${escapeHtml(baseline.name)}」：${escapeHtml(formatTime(baseline.createdAt))} 由 ${escapeHtml(baseline.createdBy)} 保存，当时一共 ${baseline.total} 条（${escapeHtml(baseline.scopeText)}）</div>
    <div class="summary-line"><strong>这一轮一共 ${summary.currentTotal} 条</strong>　<span class="tag st-added">新出现 ${summary.added} 条</span>　<span class="tag st-removed">不再出现 ${summary.removed} 条</span>　<span class="tag st-kept">还在 ${summary.kept} 条</span>${summary.moved ? `　<span class="tag st-moved">其中位置变了 ${summary.moved} 条</span>` : ''}</div>
    <div class="summary-line">对账：新出现 ${summary.added} + 还在 ${summary.kept} = 这一轮 ${summary.currentTotal} 条；不再出现 ${summary.removed} + 还在 ${summary.kept} = 基线 ${summary.baselineTotal} 条</div>`;

  const ruleSelect = el('compare-filter-rule');
  ruleSelect.innerHTML = '<option value="">全部规则</option>'
    + data.byRule.map((item) => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.code)} ${escapeHtml(item.ruleName)}</option>`).join('');
  if (data.byRule.some((item) => item.code === compare.filterCode)) ruleSelect.value = compare.filterCode;

  const fileSelect = el('compare-filter-file');
  fileSelect.innerHTML = '<option value="">全部文件</option>'
    + data.byFile.map((item) => `<option value="${escapeHtml(item.path)}">${escapeHtml(item.path)}</option>`).join('');
  if (data.byFile.some((item) => item.path === compare.filterPath)) fileSelect.value = compare.filterPath;

  el('compare-filter-status').value = compare.filterStatus;

  el('compare-rule-body').innerHTML = data.byRule.map((item) => `<tr>
      <td class="mono">${escapeHtml(item.code)}</td>
      <td class="mono">${item.added || ''}</td>
      <td class="mono">${item.removed || ''}</td>
      <td class="mono">${item.kept || ''}</td>
      <td class="actions"><button type="button" class="link" data-compare-rule="${escapeHtml(item.code)}">只看这条规则</button></td>
    </tr>`).join('');

  el('compare-file-body').innerHTML = data.byFile.map((item) => `<tr>
      <td class="mono">${escapeHtml(item.path)}</td>
      <td class="mono">${item.added || ''}</td>
      <td class="mono">${item.removed || ''}</td>
      <td class="mono">${item.kept || ''}</td>
      <td class="actions"><button type="button" class="link" data-compare-file="${escapeHtml(item.path)}">只看这个文件</button></td>
    </tr>`).join('');

  renderCompareItems();
  el('compare-area').classList.remove('hidden');
}

// 行号怎么写：新出现的只有这一轮的位置，不再出现的只有基线的位置，
// 还在的原样给行号，位置变了就把两轮的行号都写出来
function compareLineText(item) {
  if (item.status === 'added') return `— → ${item.lineNo}`;
  if (item.status === 'removed') return `${item.baseLineNo} → —`;
  if (item.moved) return `${item.baseLineNo} → ${item.lineNo}`;
  return `${item.lineNo}`;
}

function renderCompareItems() {
  const compare = state.compare;
  if (!compare) return;
  const items = compare.data.items.filter((item) => {
    if (compare.filterStatus && item.status !== compare.filterStatus) return false;
    if (compare.filterCode && item.code !== compare.filterCode) return false;
    if (compare.filterPath && item.path !== compare.filterPath) return false;
    return true;
  });
  el('compare-body').innerHTML = items.map((item) => `<tr>
      <td><span class="tag st-${item.status}">${COMPARE_STATUS_TEXT[item.status]}</span>${item.moved ? ' <span class="tag st-moved">位置变了</span>' : ''}</td>
      <td class="mono">${escapeHtml(item.code)}</td>
      <td>${escapeHtml(item.ruleName)}</td>
      <td class="mono">${escapeHtml(item.path)}</td>
      <td class="mono">${compareLineText(item)}</td>
      <td class="mono line-cell">${escapeHtml(item.lineText)}</td>
    </tr>`).join('');
  el('compare-empty').classList.toggle('hidden', items.length > 0);
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
    clearNotice();
    const found = state.baselines.find((item) => item.id === node.dataset.baselineDelete);
    if (!window.confirm(`确定删除基线「${found ? found.name : ''}」吗？`)) return;
    try {
      await request(`/api/baselines/${encodeURIComponent(node.dataset.baselineDelete)}`, { method: 'DELETE' });
      if (state.compare && state.compare.baselineId === node.dataset.baselineDelete) closeCompare();
      notify('基线已删除', 'ok');
      await loadBaselines();
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  // 分组表里的「只看这条规则 / 只看这个文件」：把明细筛到对应的一行
  if (node.dataset.compareRule) {
    if (!state.compare) return;
    state.compare.filterCode = node.dataset.compareRule;
    el('compare-filter-rule').value = state.compare.filterCode;
    renderCompareItems();
    return;
  }

  if (node.dataset.compareFile) {
    if (!state.compare) return;
    state.compare.filterPath = node.dataset.compareFile;
    el('compare-filter-file').value = state.compare.filterPath;
    renderCompareItems();
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
el('baseline-open-form').addEventListener('click', openBaselineForm);
el('baseline-cancel').addEventListener('click', closeBaselineForm);
el('baseline-form').addEventListener('submit', submitBaseline);
el('baseline-refresh').addEventListener('click', () => {
  clearNotice();
  loadBaselines().catch((err) => notify(err.message, 'error'));
});
el('compare-close').addEventListener('click', closeCompare);
el('compare-filter-status').addEventListener('change', () => {
  if (!state.compare) return;
  state.compare.filterStatus = el('compare-filter-status').value;
  renderCompareItems();
});
el('compare-filter-rule').addEventListener('change', () => {
  if (!state.compare) return;
  state.compare.filterCode = el('compare-filter-rule').value;
  renderCompareItems();
});
el('compare-filter-file').addEventListener('change', () => {
  if (!state.compare) return;
  state.compare.filterPath = el('compare-filter-file').value;
  renderCompareItems();
});
el('rule-filter-level').addEventListener('change', () => {
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('rule-filter-status').addEventListener('change', () => {
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('operator').addEventListener('change', () => {
  window.localStorage.setItem(OPERATOR_KEY, currentOperator());
});

// 页面打开时先把规则、文件与基线都拉一遍，扫描的范围下拉依赖前两份清单
restoreOperator();
loadHealth();
loadRules()
  .then(loadFiles)
  .then(loadBaselines)
  .catch((err) => notify(err.message, 'error'));
