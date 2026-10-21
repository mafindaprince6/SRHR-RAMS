async function awpApi(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || 'The work plan could not be loaded.');
  return data;
}

function awpMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `NLe ${amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '';
}

let awpRowsCache = [];
let awpEditing = '';

function awpFormMode(editing) {
  awpEditing = editing || '';
  const save = document.getElementById('awpSave');
  const cancel = document.getElementById('awpCancel');
  if (save) save.textContent = awpEditing ? 'Save changes' : 'Add to the work plan';
  if (cancel) cancel.hidden = !awpEditing;
}

function clearAwpForm() {
  awpFormMode('');
  const year = document.getElementById('awpYear');
  const code = document.getElementById('awpCode');
  const title = document.getElementById('awpTitle');
  const budget = document.getElementById('awpBudget');
  const output = document.getElementById('awpOutput');
  if (year) year.value = '2026';
  if (code) code.value = '';
  if (title) title.value = '';
  if (budget) budget.value = '0';
  if (output) output.value = '';
}

async function loadAwp() {
  const state = document.getElementById('awpState');
  const body = document.getElementById('awpRows');
  const form = document.getElementById('awpForm');
  const intro = document.getElementById('awpIntro');
  const actionHead = document.getElementById('awpActionHead');
  if (!body) return;
  if (state) state.textContent = 'Loading the work plan…';
  const year = document.getElementById('awpYearFilter')?.value.trim() || '';
  const query = year ? `?fiscal_year=${encodeURIComponent(year)}` : '';
  try {
    const data = await awpApi('/api/awp' + query);
    awpRowsCache = data.activities || [];
    if (form) form.hidden = !data.can_edit;
    if (actionHead) actionHead.hidden = !data.can_edit;
    const filePanel = document.getElementById('awpFilePanel');
    if (filePanel) filePanel.hidden = !data.can_edit;
    if (intro) {
      intro.textContent = data.can_edit
        ? `Add the activities for ${data.entity}. Secretary, Chairman, and IHPAU can read this plan. They cannot change it.`
        : 'Directorates record their annual work plan here. This desk can read every directorate plan and cannot change it.';
    }
    const total = awpRowsCache.reduce((sum, row) => sum + (Number(row.budget_nle) || 0), 0);
    const columns = data.can_edit ? 7 : 6;
    body.innerHTML = awpRowsCache.length
      ? awpRowsCache.map(row => {
          const action = data.can_edit
            ? `<td><button class="btn secondary" type="button" data-awp-edit="${esc(row.id)}">Edit</button> <button class="btn secondary" type="button" data-awp-remove="${esc(row.id)}">Remove</button></td>`
            : '';
          return `<tr><td>${esc(row.fiscal_year)}</td><td>${esc(row.entity)}</td><td>${esc(row.activity_code)}</td><td>${esc(row.title)}</td><td>${esc(awpMoney(row.budget_nle))}</td><td>${esc(row.output || '')}</td>${action}</tr>`;
        }).join('')
      : `<tr><td colspan="${columns}" class="small">No activities are on the work plan${year ? ` for ${esc(year)}` : ''}.</td></tr>`;
    const foot = document.getElementById('awpTotal');
    if (foot) foot.textContent = awpRowsCache.length ? `${awpRowsCache.length} activit${awpRowsCache.length === 1 ? 'y' : 'ies'} · ${awpMoney(total)}` : '';
    renderAwpIssued(awpRowsCache);
    if (state) state.textContent = '';
    await loadAwpArchive();
  } catch (error) {
    if (state) state.textContent = error.message;
    renderAwpIssuedError(error.message);
  }
}

function renderAwpIssued(rows) {
  const body = document.getElementById('awpIssuedRows');
  const state = document.getElementById('awpIssuedState');
  if (!body) return;
  const issuedCount = rows.filter(row => row.budget_issued).length;
  if (state) {
    state.textContent = rows.length
      ? `${issuedCount} of ${rows.length} activit${rows.length === 1 ? 'y has' : 'ies have'} a recorded disbursement.`
      : '';
  }
  body.innerHTML = rows.length
    ? rows.map(row => {
        const mark = row.budget_issued
          ? '<span class="awpMark" aria-label="Budget issued">✓</span>'
          : '<span class="awpMark off" aria-label="Budget not issued"></span>';
        const requests = (row.issued_requests || []).map(item => esc(item.request_number)).join(', ') || '—';
        return `<tr><td>${mark}</td><td>${esc(row.fiscal_year)}</td><td>${esc(row.entity)}</td><td>${esc(row.activity_code)}</td><td>${esc(row.title)}</td><td>${esc(awpMoney(row.budget_nle))}</td><td>${row.budget_issued ? esc(awpMoney(row.issued_nle)) : '—'}</td><td>${requests}</td></tr>`;
      }).join('')
    : '<tr><td colspan="8" class="small">No activities are on the work plan.</td></tr>';
}

function renderAwpIssuedError(message) {
  const body = document.getElementById('awpIssuedRows');
  const state = document.getElementById('awpIssuedState');
  if (state) state.textContent = '';
  if (body) body.innerHTML = `<tr><td colspan="8" class="small">${esc(message)}</td></tr>`;
}

function awpWhen(value) {
  return String(value || '').replace('T', ' ').slice(0, 16);
}

async function loadAwpArchive() {
  const body = document.getElementById('awpArchiveRows');
  const state = document.getElementById('awpArchiveState');
  if (!body) return;
  const q = document.getElementById('awpArchiveQ')?.value.trim() || '';
  const year = document.getElementById('awpYearFilter')?.value.trim() || '';
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (year) params.set('fiscal_year', year);
  const query = params.toString() ? `?${params.toString()}` : '';
  try {
    const data = await awpApi('/api/awp/submissions' + query);
    const rows = data.submissions || [];
    body.innerHTML = rows.length
      ? rows.map(row => `<tr><td>${esc(row.fiscal_year)}</td><td>${esc(row.entity)}</td><td>${esc(awpWhen(row.submitted_at))}</td><td>${esc(row.line_count)}</td><td>${esc(awpMoney(row.total_budget_nle))}</td><td>${row.source === 'upload' ? 'Uploaded CSV' : 'Entered online'}</td><td><button class="btn secondary" type="button" data-awp-submission="${esc(row.id)}">${row.superseded_at ? 'Earlier copy' : 'Current copy'}</button></td></tr>`).join('')
      : '<tr><td colspan="7" class="small">No work plan has been filed yet.</td></tr>';
    if (state && state.textContent.startsWith('Loading')) state.textContent = '';
  } catch (error) {
    body.innerHTML = `<tr><td colspan="7" class="small">${esc(error.message)}</td></tr>`;
  }
}

async function openAwpSubmission(id) {
  const box = document.getElementById('awpArchiveDetail');
  const state = document.getElementById('awpArchiveState');
  if (!box) return;
  if (state) state.textContent = 'Opening the filed plan…';
  try {
    const data = await awpApi('/api/awp/submissions/' + encodeURIComponent(id));
    const plan = data.submission || {};
    const lines = data.lines || [];
    const body = lines.map(row => `<tr><td>${esc(row.activity_code)}</td><td>${esc(row.title)}</td><td>${esc(awpMoney(row.budget_nle))}</td><td>${esc(row.output || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="small">This filing has no activities.</td></tr>';
    box.hidden = false;
    box.innerHTML = `<h3>${esc(plan.title || 'Filed work plan')}</h3><p class="small">${esc(plan.entity)} · ${esc(plan.fiscal_year)} · ${plan.source === 'upload' ? 'Uploaded CSV' : 'Entered online'}${plan.file_name ? ` · ${esc(plan.file_name)}` : ''} · ${plan.superseded_at ? 'Earlier copy' : 'Current copy'}</p><div class="tableWrap"><table><thead><tr><th>Code</th><th>Activity</th><th>Budget</th><th>Output</th></tr></thead><tbody>${body}</tbody></table></div><button class="btn secondary" type="button" id="awpArchiveClose">Close</button>`;
    box.querySelector('#awpArchiveClose')?.addEventListener('click', () => { box.hidden = true; box.innerHTML = ''; });
    if (state) state.textContent = '';
    box.scrollIntoView({ block: 'nearest' });
  } catch (error) {
    if (state) state.textContent = error.message;
  }
}

function fillAwpForm(id) {
  const row = awpRowsCache.find(item => item.id === id);
  if (!row) return;
  awpFormMode(id);
  document.getElementById('awpYear').value = row.fiscal_year;
  document.getElementById('awpCode').value = row.activity_code || '';
  document.getElementById('awpTitle').value = row.title || '';
  document.getElementById('awpBudget').value = row.budget_nle ?? 0;
  document.getElementById('awpOutput').value = row.output || '';
  document.getElementById('awpForm')?.scrollIntoView({ block: 'nearest' });
}

async function removeAwp(id) {
  const row = awpRowsCache.find(item => item.id === id);
  if (!row) return;
  if (!confirm(`Remove ${row.activity_code} from the work plan?`)) return;
  const state = document.getElementById('awpState');
  if (state) state.textContent = 'Removing…';
  try {
    await awpApi('/api/awp/' + encodeURIComponent(id), { method: 'PATCH', body: { active: false } });
    if (awpEditing === id) clearAwpForm();
    await loadAwp();
    if (state) state.textContent = 'Removed from the work plan.';
  } catch (error) {
    if (state) state.textContent = error.message;
  }
}

document.getElementById('awpForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const state = document.getElementById('awpState');
  const body = {
    fiscal_year: document.getElementById('awpYear').value,
    activity_code: document.getElementById('awpCode').value.trim(),
    title: document.getElementById('awpTitle').value.trim(),
    budget_nle: document.getElementById('awpBudget').value,
    output: document.getElementById('awpOutput').value.trim()
  };
  if (state) state.textContent = 'Saving…';
  try {
    if (awpEditing) {
      await awpApi('/api/awp/' + encodeURIComponent(awpEditing), { method: 'PATCH', body });
    } else {
      await awpApi('/api/awp', { method: 'POST', body });
    }
    clearAwpForm();
    await loadAwp();
    if (state) state.textContent = 'Saved on the work plan.';
  } catch (error) {
    if (state) state.textContent = error.message;
  }
});

document.getElementById('awpCancel')?.addEventListener('click', () => {
  clearAwpForm();
  const state = document.getElementById('awpState');
  if (state) state.textContent = '';
});
document.getElementById('awpRefresh')?.addEventListener('click', () => loadAwp());
document.getElementById('awpSubmitForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const state = document.getElementById('awpFileState');
  const year = document.getElementById('awpSubmitYear')?.value;
  if (state) state.textContent = 'Filing the work plan…';
  try {
    const filed = await awpApi('/api/awp/submissions', { method: 'POST', body: { fiscal_year: year } });
    if (state) state.textContent = `Filed ${filed.line_count} activit${filed.line_count === 1 ? 'y' : 'ies'} for ${filed.fiscal_year}.`;
    await loadAwpArchive();
  } catch (error) {
    if (state) state.textContent = error.message;
  }
});
document.getElementById('awpUploadForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const state = document.getElementById('awpFileState');
  const file = document.getElementById('awpUploadFile')?.files?.[0];
  const year = document.getElementById('awpUploadYear')?.value;
  if (!file) { if (state) state.textContent = 'Choose a CSV file.'; return; }
  if (!/\.csv$/i.test(file.name)) {
    if (state) state.textContent = 'This file was not read. Save the work plan as a CSV with columns for activity code, activity, budget, and output. Excel and PDF files are not read.';
    return;
  }
  if (state) state.textContent = 'Reading the file…';
  try {
    const text = await file.text();
    const filed = await awpApi('/api/awp/submissions/upload', { method: 'POST', body: { fiscal_year: year, file_name: file.name, text } });
    if (state) state.textContent = `Filed ${filed.line_count} activit${filed.line_count === 1 ? 'y' : 'ies'}. ${filed.added} added to the working plan. ${filed.skipped} already there and left unchanged.`;
    document.getElementById('awpUploadFile').value = '';
    await loadAwp();
  } catch (error) {
    if (state) state.textContent = error.message;
  }
});
document.getElementById('awpArchiveSearch')?.addEventListener('click', () => loadAwpArchive());
document.getElementById('awpArchiveQ')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); loadAwpArchive(); } });
document.getElementById('awpArchiveRows')?.addEventListener('click', event => {
  const open = event.target.closest('[data-awp-submission]');
  if (open) openAwpSubmission(open.dataset.awpSubmission);
});
document.getElementById('awpRows')?.addEventListener('click', event => {
  const edit = event.target.closest('[data-awp-edit]');
  const remove = event.target.closest('[data-awp-remove]');
  if (edit) fillAwpForm(edit.dataset.awpEdit);
  if (remove) removeAwp(remove.dataset.awpRemove);
});

const awpShow = show;
show = function (view) {
  const result = awpShow(view);
  if (view === 'awp' && document.getElementById('awp')?.classList.contains('active')) loadAwp();
  return result;
};

window.loadAwp = loadAwp;
