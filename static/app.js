const state = {
  projects: [],
  summary: {},
  options: {},
  activeView: 'dashboard',
  activeReport: 'customer_name',
};

const titles = {
  dashboard: ['Dashboard', 'Live project health, revenue, materials, and aging.'],
  projects: ['Projects', 'Delivery, from confirmation to completion.'],
  iclick: ['iKlick', 'Dedicated tracker for iKlick requests.'],
  poc: ['POC / Temporary', 'Temporary sites, trial periods, expiry flags, and follow-up status.'],
  special: ['Special Projects', 'Rollout progress, implementation stages and delivery blockers.'],
  analytics: ['Analytics', 'Aging, revenue, service mix, and planned materials.'],
  reports: ['Reports', 'Operational summaries for customers, regions, services, and status.'],
};

const workStreamByView = {
  projects: 'BAU',
  iclick: 'iClick',
  poc: 'POC / Temporary',
};

const newButtonLabels = {
  projects: 'New Project',
  iclick: 'New iKlick',
  poc: 'New POC',
};

const fields = [
  'work_stream', 'customer_name', 'site_name', 'sn', 'parent_project_id', 'location', 'region',
  'capacity', 'bandwidth', 'service_type', 'cpe', 'currency', 'confirmation_date', 'start_date',
  'target_completion_date', 'completion_date', 'poc_start_date', 'poc_end_date', 'poc_duration_days', 'status', 'mrc', 'nrc',
  'planned_adss_distance_m', 'planned_drop_distance_m', 'poles_9m', 'poles_11m',
  'labour', 'trench', 'archived', 'remarks',
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function money(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function number(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2600);
}

function setBusy(isBusy, title = 'Working', message = 'Please wait.') {
  const overlay = $('#loadingOverlay');
  $('#loadingTitle').textContent = title;
  $('#loadingMessage').textContent = message;
  overlay.classList.toggle('show', isBusy);
  overlay.setAttribute('aria-hidden', String(!isBusy));
  ['#exportBtn', '#newProjectBtn', '#logoutBtn'].forEach((selector) => {
    const el = $(selector);
    if (el) el.disabled = isBusy;
  });
  const importFile = $('#importFile');
  if (importFile) importFile.disabled = isBusy;
}

function filterParams() {
  const params = new URLSearchParams();
  const mapping = {
    q: '#searchInput',
    from: '#fromFilter',
    to: '#toFilter',
  };
  Object.entries(mapping).forEach(([key, selector]) => {
    const value = $(selector).value;
    if (value) params.set(key, value);
  });
  const multiMapping = {
    status: '#statusFilter',
    region: '#regionFilter',
    service_type: '#serviceFilter',
    archived: '#archiveFilter',
  };
  Object.entries(multiMapping).forEach(([key, selector]) => {
    const values = getMultiValues(selector);
    if (values.length) params.set(key, values.join('|'));
  });
  if (workStreamByView[state.activeView]) {
    params.set('work_stream', workStreamByView[state.activeView]);
  }
  return params;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body && !(options.body instanceof ArrayBuffer) ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(detail.error || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function load() {
  const params = filterParams();
  const [projects, summary, options] = await Promise.all([
    api(`/api/projects?${params}`),
    api(`/api/summary?${params}`),
    api('/api/options'),
  ]);
  state.projects = projects.projects;
  state.summary = summary;
  state.options = options;
  renderOptions();
  render();
}

function renderOptions() {
  fillMultiFilter('#statusFilter', state.options.statuses || []);
  fillMultiFilter('#regionFilter', state.options.region || state.options.region_name || state.options.region || []);
  fillMultiFilter('#serviceFilter', state.options.service_type || []);
  fillMultiFilter('#archiveFilter', [
    { label: 'Active', value: '0' },
    { label: 'Archived', value: '1' },
  ]);
  const statusSelect = $('#projectForm select[name="status"]');
  statusSelect.innerHTML = (state.options.statuses || []).map((item) => `<option>${escapeHtml(item)}</option>`).join('');
}

function getMultiValues(selector) {
  return Array.from(document.querySelectorAll(`${selector} input[type="checkbox"]:checked`)).map((input) => input.value);
}

function fillMultiFilter(selector, values) {
  const el = $(selector);
  const selected = new Set(getMultiValues(selector));
  const placeholder = el.dataset.placeholder;
  const normalized = values.map((item) => (typeof item === 'string' ? { label: item, value: item } : item));
  const selectedLabels = normalized.filter((item) => selected.has(String(item.value))).map((item) => item.label);
  const label = selectedLabels.length ? selectedLabels.join(', ') : placeholder;
  el.innerHTML = `
    <button type="button" class="multi-filter-button" aria-expanded="false">${escapeHtml(label)}</button>
    <div class="multi-filter-menu">
      ${normalized.map((item) => `
        <label class="multi-filter-option">
          <input type="checkbox" value="${escapeHtml(item.value)}" ${selected.has(String(item.value)) ? 'checked' : ''}>
          <span>${escapeHtml(item.label)}</span>
        </label>
      `).join('')}
      <div class="multi-filter-actions">
        <button type="button" data-filter-clear>Clear</button>
        <button type="button" class="primary" data-filter-apply>Apply</button>
      </div>
    </div>
  `;
  const button = el.querySelector('.multi-filter-button');
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    closeMultiFilters(el);
    el.classList.toggle('open');
    button.setAttribute('aria-expanded', String(el.classList.contains('open')));
  });
  el.querySelector('.multi-filter-menu').addEventListener('click', (event) => event.stopPropagation());
  el.querySelector('[data-filter-clear]').addEventListener('click', () => {
    el.querySelectorAll('input[type="checkbox"]').forEach((input) => { input.checked = false; });
  });
  el.querySelector('[data-filter-apply]').addEventListener('click', () => {
    closeMultiFilters();
    load();
  });
}

function closeMultiFilters(except = null) {
  $$('.multi-filter.open').forEach((filter) => {
    if (filter === except) return;
    filter.classList.remove('open');
    const button = filter.querySelector('.multi-filter-button');
    if (button) button.setAttribute('aria-expanded', 'false');
  });
}

function clearMultiFilter(selector) {
  document.querySelectorAll(`${selector} input[type="checkbox"]`).forEach((input) => {
    input.checked = false;
  });
}

function render() {
  updateTopActions();
  renderMetrics();
  renderBars('#agingBars', state.summary.aging || {}, ['0-30', '31-60', '61-90', '91-120', '120+', 'Unconfirmed']);
  renderBars('#statusBars', state.summary.by_status || {});
  renderBars('#regionRevenueBars', state.summary.revenue_by_region || {}, null, true);
  renderBars('#serviceBars', state.summary.by_service_type || {});
  renderMaterials();
  renderDelayed();
  renderRecent();
  if (workStreamByView[state.activeView]) {
    renderProjectTotals();
    renderProjects();
  }
  if (state.activeView === 'reports') renderReport();
}

function activeWorkStream() {
  return workStreamByView[state.activeView] || 'BAU';
}

function updateTopActions() {
  const button = $('#newProjectBtn');
  button.querySelector('span').textContent = newButtonLabels[state.activeView] || 'New project';
}

function renderMetrics() {
  const metrics = [
    ['Total', state.summary.total_projects],
    ['Active', state.summary.active_projects],
    ['Completed', state.summary.completed_projects],
    ['Delayed', state.summary.delayed_projects],
    ['Avg Days', state.summary.average_completion_days],
    ['MRC', money(state.summary.mrc)],
    ['Total Cost', money(state.summary.costs?.total_cost)],
  ];
  $('#metrics').innerHTML = metrics.map(([label, value]) => `
    <article class="metric"><span>${label}</span><strong>${value ?? 0}</strong></article>
  `).join('');
}

function moneyWithCurrency(currency, value) {
  return `${currency} ${money(value)}`;
}

function formatCurrencyTotals(field) {
  const groups = state.summary.financials_by_currency || {};
  const entries = Object.entries(groups).filter(([, totals]) => Number(totals[field] || 0) !== 0);
  if (!entries.length) return '0';
  return entries.map(([currency, totals]) => moneyWithCurrency(currency, totals[field])).join(' / ');
}

function renderProjectTotals() {
  const materials = state.summary.materials || {};
  const costs = state.summary.costs || {};
  const poc = state.summary.poc || {};
  let totals = [
    ['Projects', number(state.summary.total_projects)],
    ['Monthly recurring', formatCurrencyTotals('mrc')],
    ['Non-recurring', formatCurrencyTotals('nrc')],
    ['9m Poles', number(materials.poles_9m)],
    ['11m Poles', number(materials.poles_11m)],
    ['ADSS', number(materials.planned_adss_distance_m)],
    ['Drop', number(materials.planned_drop_distance_m)],
    ['Delivery cost', money(costs.total_cost)],
  ];
  if (state.activeView === 'poc') {
    totals = [totals[0], ['Expired', number(poc.expired)], ['Expiring Soon', number(poc.expiring_soon)], ['Active POCs', number(poc.active)]];
  } else {
    totals = [totals[0], totals[1], totals[2], totals[7]];
  }
  $('#projectTotals').innerHTML = totals.map(([label, value], index) => `
    <article class="total-chip">
      <span>${label}</span>
      <strong>${String(value).split(' / ').map(part => `<span class="total-value">${escapeHtml(part)}</span>`).join('')}</strong>
      ${state.activeView !== 'poc' && index === 0 ? `<small>${number(state.summary.completed_projects)} completed</small>` : ''}
      ${state.activeView !== 'poc' && index === 3 ? '<small>Materials &amp; labour</small>' : ''}
    </article>
  `).join('');
  $('#projectMaterials').innerHTML = state.activeView === 'poc' ? '' : [
    ['9m poles', number(materials.poles_9m)],
    ['11m poles', number(materials.poles_11m)],
    ['ADSS', `${number(materials.planned_adss_distance_m)} m`],
    ['Drop', `${number(materials.planned_drop_distance_m)} m`],
  ].map(([label, value]) => `<div>${label}<strong>${escapeHtml(value)}</strong></div>`).join('');
  const count = document.querySelector(`.nav-item[data-view="${state.activeView}"] .nav-count`);
  if (count) {
    count.textContent = number(state.summary.total_projects);
    count.title = 'Records matching current filters';
  }
}

function renderBars(selector, data, order = null, isMoney = false) {
  const entries = order ? order.map((key) => [key, data[key] || 0]) : Object.entries(data);
  const max = Math.max(...entries.map(([, value]) => Number(value || 0)), 1);
  $(selector).innerHTML = entries.map(([key, value]) => `
    <div class="bar-row">
      <span>${escapeHtml(key)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(Number(value || 0) / max) * 100}%"></div></div>
      <strong>${isMoney ? money(value) : number(value)}</strong>
    </div>
  `).join('') || '<p class="muted">No data yet.</p>';
}

function renderMaterials() {
  const labels = {
    planned_adss_distance_m: 'Planned ADSS (m)',
    planned_drop_distance_m: 'Planned Drop (m)',
    poles_9m: '9m Poles',
    poles_11m: '11m Poles',
    pole_cost: 'Pole Cost',
    transportation_cost: 'Transportation',
    labour_cost: 'Labour Cost',
    total_cost: 'Total Cost',
  };
  const materials = state.summary.materials || {};
  const costs = state.summary.costs || {};
  $('#materialGrid').innerHTML = Object.entries(labels).map(([key, label]) => `
    <article class="material-item"><span>${label}</span><strong>${key.includes('cost') ? money(costs[key]) : number(materials[key])}</strong></article>
  `).join('');
}

function renderDelayed() {
  const delayed = state.projects.filter((p) => p.is_delayed).slice(0, 8);
  $('#delayedRows').innerHTML = delayed.map((p) => `
    <tr>
      <td><strong>${escapeHtml(p.project_id)}</strong><div class="muted">${escapeHtml(p.site_name)}</div></td>
      <td>${escapeHtml(p.customer_name)}</td>
      <td>${escapeHtml(p.target_completion_date || '')}</td>
      <td><span class="delay-pill">${escapeHtml(p.status)}</span></td>
      <td>${p.aging_days ?? ''}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="muted">No delayed projects in the current filter.</td></tr>';
}

function renderRecent() {
  const recent = state.summary.recent || { today: 0, week: 0, items: [] };
  $('#recentCount').textContent = `${recent.today || 0} today, ${recent.week || 0} this week`;
  $('#recentRows').innerHTML = (recent.items || []).map((p) => `
    <tr>
      <td><strong>${escapeHtml(p.project_id)}</strong></td>
      <td>${escapeHtml(p.customer_name)}</td>
      <td>${escapeHtml(p.site_name)}</td>
      <td><span class="status-pill">${escapeHtml(p.status)}</span></td>
      <td>${escapeHtml((p.created_at || '').slice(0, 10))}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="muted">No projects added this week.</td></tr>';
}

function renderProjects() {
  const visibleProjects = state.projects.slice(0, 300);
  const isPocView = state.activeView === 'poc';
  renderProjectHeader();
  $('#projectRows').innerHTML = visibleProjects.map((p) => `
    <tr data-project-id="${p.id}">
      <td><strong>${escapeHtml(p.project_id)}</strong>${p.archived ? '<span class="archive-pill">Archived</span>' : ''}<div class="muted">${escapeHtml(p.sn || '')}</div></td>
      <td><strong>${escapeHtml(p.customer_name)}</strong><div class="muted">${escapeHtml(p.site_name)}</div></td>
      <td>${escapeHtml(p.region || '')}</td>
      <td>${escapeHtml(p.service_type || '')}</td>
      <td>
        <select class="status-select" data-status="${escapeHtml(p.status)}" aria-label="Status for ${escapeHtml(p.customer_name)}" data-status-id="${p.id}">
          ${(state.options.statuses || []).map((status) => `<option value="${escapeHtml(status)}" ${status === p.status ? 'selected' : ''}>${escapeHtml(status)}</option>`).join('')}
        </select>
        ${p.is_delayed ? '<span class="delay-pill">Delayed</span>' : ''}
      </td>
      ${isPocView ? `
      <td><input class="table-date-input" type="date" data-poc-date-id="${p.id}" data-poc-date-field="poc_start_date" value="${escapeHtml(p.poc_start_date || '')}"></td>
      <td><input class="table-date-input" type="date" data-poc-date-id="${p.id}" data-poc-date-field="poc_end_date" value="${escapeHtml(p.poc_end_date || '')}"></td>
      <td><strong>${number(p.poc_duration_days)}</strong><div class="muted">days</div></td>
      <td>${pocTrackingCell(p)}</td>
      ` : ''}
      ${isPocView ? '' : `
      <td>${escapeHtml(p.target_completion_date || '')}</td>
      <td>${p.aging_days ?? ''}<div class="muted">${escapeHtml(p.aging_bucket)}</div></td>
      <td>${escapeHtml(p.currency || 'GHS')}</td>
      <td><strong>${money(p.mrc)}</strong></td>
      <td><strong>${money(p.nrc)}</strong></td>
      <td>${number(p.poles_9m)}</td>
      <td>${number(p.poles_11m)}</td>
      <td>${number(p.planned_adss_distance_m)}</td>
      <td>${number(p.planned_drop_distance_m)}</td>
      <td><strong>${money(p.total_cost)}</strong><div class="muted">Labour ${money(p.labour_cost)}</div></td>
      <td><button data-edit="${p.id}" class="row-edit" aria-label="Edit ${escapeHtml(p.customer_name)}" title="Edit project"><i data-lucide="square-pen" aria-hidden="true"></i></button></td>
      `}
    </tr>
  `).join('') || `<tr><td colspan="${projectColumnCount()}" class="muted">No projects match the current filters.</td></tr>`;
  if (state.projects.length > visibleProjects.length) {
    $('#projectRows').insertAdjacentHTML(
      'beforeend',
      `<tr><td colspan="${projectColumnCount()}" class="muted">Showing first ${visibleProjects.length} of ${state.projects.length} projects. Use search or filters to narrow the list.</td></tr>`
    );
  }
  $$('#projectRows tr[data-project-id]').forEach((row) => row.addEventListener('dblclick', (event) => {
    if (event.target.closest('select, button, input, textarea')) return;
    openProject(Number(row.dataset.projectId));
  }));
  $$('[data-edit]').forEach((btn) => btn.addEventListener('click', () => openProject(Number(btn.dataset.edit))));
  $$('[data-status-id]').forEach((select) => {
    select.addEventListener('dblclick', (event) => event.stopPropagation());
    select.addEventListener('change', () => updateProjectStatus(Number(select.dataset.statusId), select.value));
  });
  $$('[data-poc-date-id]').forEach((input) => {
    input.addEventListener('dblclick', (event) => event.stopPropagation());
    input.addEventListener('change', () => updateProjectPocDate(Number(input.dataset.pocDateId), input.dataset.pocDateField, input.value));
  });
  lucide.createIcons();
}

function projectColumns() {
  const shared = ['Project', 'Customer / Site', 'Region', 'Service', 'Status'];
  if (state.activeView === 'poc') return [...shared, 'Start Date', 'End Date', 'Duration', 'Tracking'];
  return [...shared, 'Target', 'Age', 'Currency', 'MRC', 'NRC', '9m', '11m', 'ADSS', 'Drop', 'Total Cost', ''];
}

function projectColumnCount() {
  return projectColumns().length;
}

function renderProjectHeader() {
  $('.project-table-wrap table').classList.toggle('poc-table', state.activeView === 'poc');
  $('#projectHeaderRow').innerHTML = projectColumns().map((label) => `<th>${escapeHtml(label)}</th>`).join('');
  $('#registerTitle').textContent = state.activeView === 'poc' ? 'POC register' : state.activeView === 'iclick' ? 'iKlick register' : 'Project register';
  $('#registerCount').textContent = `${number(state.projects.length)} records`;
  $('#registerFooter').textContent = `Showing ${number(Math.min(state.projects.length, 300))} of ${number(state.projects.length)} records`;
}

function pocTrackingCell(project) {
  const stateClass = String(project.poc_state || '').toLowerCase().replace(/\s+/g, '-');
  const daysText = project.poc_days_remaining == null ? '' : `${project.poc_days_remaining} days left`;
  return `<span class="poc-state ${escapeHtml(stateClass)}">${escapeHtml(project.poc_state || 'Needs dates')}</span><div class="muted">${escapeHtml(daysText)}</div>`;
}

function renderReport() {
  const groups = {};
  state.projects.forEach((p) => {
    const key = p[state.activeReport] || 'Unassigned';
    groups[key] ||= { projects: 0, mrc: 0, nrc: 0, delayed: 0 };
    groups[key].projects += 1;
    groups[key].mrc += Number(p.mrc || 0);
    groups[key].nrc += Number(p.nrc || 0);
    groups[key].delayed += p.is_delayed ? 1 : 0;
  });
  $('#reportRows').innerHTML = Object.entries(groups).map(([key, row]) => `
    <tr><td>${escapeHtml(key)}</td><td>${row.projects}</td><td>${money(row.mrc)}</td><td>${money(row.nrc)}</td><td>${row.delayed}</td></tr>
  `).join('') || '<tr><td colspan="5" class="muted">No report data for the current filters.</td></tr>';
}

function switchView(view) {
  state.activeView = view;
  document.body.classList.toggle('special-view', view === 'special');
  if (view === 'special') {
    const frame = $('#specialProjectsFrame');
    if (!frame.getAttribute('src')) frame.src = frame.dataset.src;
    else frame.contentWindow.postMessage({ type: 'refresh-special-projects' }, window.location.origin);
  }
  const visibleView = workStreamByView[view] ? 'projects' : view;
  const filters = $('.filters');
  if (workStreamByView[view]) $('#projectTotals').after(filters);
  else $('#filterHome').after(filters);
  $$('.view').forEach((el) => el.classList.toggle('active', el.id === visibleView));
  $$('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
  $('#viewTitle').textContent = titles[view][0];
  $('#workspaceView').textContent = titles[view][0];
  $('#viewSubtitle').textContent = titles[view][1];
  updateTopActions();
  if (workStreamByView[view]) {
    renderProjectTotals();
    renderProjects();
  }
  if (view === 'reports') renderReport();
}

function openProject(id = null) {
  const form = $('#projectForm');
  form.reset();
  form.elements.currency.value = 'GHS';
  form.elements.work_stream.value = activeWorkStream();
  form.elements.work_stream.disabled = Boolean(workStreamByView[state.activeView]);
  $('#projectDbId').value = '';
  $('#deleteProject').style.visibility = id ? 'visible' : 'hidden';
  $('#duplicateProject').style.visibility = id ? 'visible' : 'hidden';
  $('#dialogTitle').textContent = id ? `Edit ${(newButtonLabels[state.activeView] || 'New Project').replace(/^New /, '')}` : (newButtonLabels[state.activeView] || 'New Project');
  if (id) {
    const project = state.projects.find((p) => p.id === id);
    $('#projectDbId').value = project.id;
    fields.forEach((field) => {
      const input = form.elements[field];
      if (!input) return;
      if (input.type === 'checkbox') input.checked = Boolean(project[field]);
      else input.value = project[field] ?? '';
    });
  }
  updatePocFields();
  $('#projectDialog').showModal();
}

function updatePocFields() {
  const form = $('#projectForm');
  const isPoc = form.elements.work_stream.value === 'POC / Temporary';
  $$('.poc-field').forEach((field) => field.classList.toggle('hidden', !isPoc));
  form.elements.poc_start_date.required = isPoc;
  form.elements.poc_end_date.required = isPoc;
  if (isPoc) updatePocDuration();
}

function updatePocDuration() {
  const form = $('#projectForm');
  const start = form.elements.poc_start_date.value;
  const end = form.elements.poc_end_date.value;
  if (!start || !end) return;
  const days = Math.max(Math.round((new Date(end) - new Date(start)) / 86400000), 0);
  form.elements.poc_duration_days.value = Number.isFinite(days) ? days : '';
}

async function saveForm(event) {
  event.preventDefault();
  const payload = projectPayloadFromForm();
  if (!payload) return;
  const id = $('#projectDbId').value;
  await api(id ? `/api/projects/${id}` : '/api/projects', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(payload),
  });
  $('#projectDialog').close();
  toast('Project saved');
  await load();
}

function projectPayloadFromForm() {
  const form = $('#projectForm');
  const payload = {};
  fields.forEach((field) => {
    const input = form.elements[field];
    if (!input) return;
    payload[field] = input.type === 'checkbox' ? input.checked : input.value;
  });
  if (workStreamByView[state.activeView]) {
    payload.work_stream = activeWorkStream();
  }
  if (payload.work_stream === 'POC / Temporary' && (!payload.poc_start_date || !payload.poc_end_date)) {
    toast('POC start and end dates are required');
    return null;
  }
  return payload;
}

async function duplicateCurrentProject() {
  if (!$('#projectDbId').value) return;
  const payload = projectPayloadFromForm();
  if (!payload) return;
  await api('/api/projects', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  $('#projectDialog').close();
  toast('Saved as new project');
  await load();
}

async function deleteCurrentProject() {
  const id = $('#projectDbId').value;
  if (!id || !confirm('Delete this project?')) return;
  await api(`/api/projects/${id}`, { method: 'DELETE' });
  $('#projectDialog').close();
  toast('Project deleted');
  await load();
}

async function updateProjectStatus(id, status) {
  const project = state.projects.find((item) => item.id === id);
  if (!project || project.status === status) return;
  const payload = {};
  fields.forEach((field) => {
    payload[field] = project[field] ?? '';
  });
  payload.status = status;
  try {
    await api(`/api/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    toast('Status updated');
    await load();
  } catch (error) {
    toast(error.message);
    await load();
  }
}

async function updateProjectPocDate(id, field, value) {
  const project = state.projects.find((item) => item.id === id);
  if (!project || !['poc_start_date', 'poc_end_date'].includes(field)) return;
  const payload = {};
  fields.forEach((projectField) => {
    payload[projectField] = project[projectField] ?? '';
  });
  payload.work_stream = 'POC / Temporary';
  payload[field] = value;
  if (!payload.poc_start_date || !payload.poc_end_date) {
    toast('POC start and end dates are required');
    await load();
    return;
  }
  try {
    await api(`/api/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    toast('POC window updated');
    await load();
  } catch (error) {
    toast(error.message);
    await load();
  }
}

async function importExcel(file) {
  setBusy(true, 'Importing workbook', `Uploading ${file.name} and saving tracker rows.`);
  try {
    const bytes = await file.arrayBuffer();
    const params = new URLSearchParams();
    if (workStreamByView[state.activeView]) params.set('work_stream', activeWorkStream());
    const result = await api(`/api/import?${params}`, { method: 'POST', body: bytes });
    const errorText = result.errors?.length ? `, ${result.errors.length} row errors` : '';
    const cleanupText = result.cleaned_duplicates ? `, cleaned ${result.cleaned_duplicates} duplicates` : '';
    toast(`Imported ${result.imported}, updated ${result.updated}${cleanupText}${errorText}`);
    if (result.errors?.length) {
      console.warn('Import row errors:', result.errors);
      alert(`Import completed with ${result.errors.length} row errors. The first issue was:\n\n${result.errors[0]}`);
    }
    setBusy(true, 'Refreshing dashboard', 'Loading the latest imported data.');
    await load();
  } catch (error) {
    toast(error.message);
    alert(`Import failed:\n\n${error.message}`);
  } finally {
    setBusy(false);
  }
}

function exportExcel() {
  const params = filterParams();
  window.location = `/api/export?${params}`;
}

function bindEvents() {
  $$('.nav-item').forEach((btn) => btn.addEventListener('click', async () => {
    switchView(btn.dataset.view);
    if (btn.dataset.view !== 'special') await load();
  }));
  $('#newProjectBtn').addEventListener('click', async () => {
    if (!workStreamByView[state.activeView]) {
      switchView('projects');
      await load();
    }
    openProject();
  });
  $('#closeDialog').addEventListener('click', () => $('#projectDialog').close());
  $('#cancelProject').addEventListener('click', () => $('#projectDialog').close());
  $('#projectForm').addEventListener('submit', saveForm);
  $('#duplicateProject').addEventListener('click', duplicateCurrentProject);
  $('#projectForm select[name="work_stream"]').addEventListener('change', updatePocFields);
  $('#projectForm input[name="poc_start_date"]').addEventListener('change', updatePocDuration);
  $('#projectForm input[name="poc_end_date"]').addEventListener('change', updatePocDuration);
  $('#deleteProject').addEventListener('click', deleteCurrentProject);
  $('#exportBtn').addEventListener('click', exportExcel);
  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    window.location = '/login';
  });
  $('#importFile').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) importExcel(file);
    event.target.value = '';
  });
  ['#searchInput', '#fromFilter', '#toFilter']
    .forEach((selector) => $(selector).addEventListener('input', load));
  $('#clearFilters').addEventListener('click', () => {
    ['#searchInput', '#fromFilter', '#toFilter']
      .forEach((selector) => { $(selector).value = ''; });
    ['#statusFilter', '#regionFilter', '#serviceFilter', '#archiveFilter'].forEach(clearMultiFilter);
    load();
  });
  $('#scheduleColumns').addEventListener('change', (event) => {
    document.body.classList.toggle('show-schedule', event.target.checked);
  });
  document.addEventListener('click', () => closeMultiFilters());
  $$('[data-report]').forEach((btn) => btn.addEventListener('click', () => {
    state.activeReport = btn.dataset.report;
    renderReport();
  }));
}

bindEvents();
lucide.createIcons();
load().catch((error) => toast(error.message));
