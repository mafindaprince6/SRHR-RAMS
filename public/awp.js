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
    if (state) state.textContent = '';
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
