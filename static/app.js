const state = {
  projects: [],
  summary: {},
  options: {},
  activeView: 'dashboard',
  activeReport: 'customer_name',
};

const titles = {
  dashboard: ['Dashboard', 'Live project health, revenue, materials, and aging.'],
  projects: ['Projects', 'Fast searchable tracker for active and archived work.'],
  analytics: ['Analytics', 'Aging, revenue, service mix, and planned materials.'],
  reports: ['Reports', 'Operational summaries for customers, regions, services, and status.'],
};

const fields = [
  'customer_name', 'site_name', 'sn', 'parent_project_id', 'location', 'region',
  'capacity', 'bandwidth', 'service_type', 'cpe', 'currency', 'confirmation_date', 'start_date',
  'target_completion_date', 'completion_date', 'status', 'mrc', 'nrc',
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
    status: '#statusFilter',
    region: '#regionFilter',
    service_type: '#serviceFilter',
    archived: '#archiveFilter',
    from: '#fromFilter',
    to: '#toFilter',
  };
  Object.entries(mapping).forEach(([key, selector]) => {
    const value = $(selector).value;
    if (value) params.set(key, value);
  });
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
    api('/api/summary'),
    api('/api/options'),
  ]);
  state.projects = projects.projects;
  state.summary = summary;
  state.options = options;
  renderOptions();
  render();
}

function renderOptions() {
  fillSelect('#statusFilter', state.options.statuses || [], 'All statuses');
  fillSelect('#regionFilter', state.options.region || state.options.region_name || state.options.region || [], 'All regions');
  fillSelect('#serviceFilter', state.options.service_type || [], 'All services');
  const statusSelect = $('#projectForm select[name="status"]');
  statusSelect.innerHTML = (state.options.statuses || []).map((item) => `<option>${escapeHtml(item)}</option>`).join('');
}

function fillSelect(selector, values, firstLabel) {
  const el = $(selector);
  const current = el.value;
  el.innerHTML = `<option value="">${firstLabel}</option>` + values.map((item) => `<option>${escapeHtml(item)}</option>`).join('');
  el.value = current;
}

function render() {
  renderMetrics();
  renderBars('#agingBars', state.summary.aging || {}, ['0-30', '31-60', '61-90', '91-120', '120+', 'Unconfirmed']);
  renderBars('#statusBars', state.summary.by_status || {});
  renderBars('#regionRevenueBars', state.summary.revenue_by_region || {}, null, true);
  renderBars('#serviceBars', state.summary.by_service_type || {});
  renderMaterials();
  renderDelayed();
  renderRecent();
  if (state.activeView === 'projects') renderProjects();
  if (state.activeView === 'reports') renderReport();
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
  $('#projectRows').innerHTML = visibleProjects.map((p) => `
    <tr>
      <td><strong>${escapeHtml(p.project_id)}</strong>${p.archived ? '<span class="archive-pill">Archived</span>' : ''}<div class="muted">${escapeHtml(p.sn || '')}</div></td>
      <td><strong>${escapeHtml(p.customer_name)}</strong><div class="muted">${escapeHtml(p.site_name)}</div></td>
      <td>${escapeHtml(p.region || '')}</td>
      <td>${escapeHtml(p.service_type || '')}</td>
      <td><span class="status-pill">${escapeHtml(p.status)}</span>${p.is_delayed ? '<span class="delay-pill">Delayed</span>' : ''}</td>
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
      <td><button data-edit="${p.id}">Edit</button></td>
    </tr>
  `).join('') || '<tr><td colspan="16" class="muted">No projects match the current filters.</td></tr>';
  if (state.projects.length > visibleProjects.length) {
    $('#projectRows').insertAdjacentHTML(
      'beforeend',
      `<tr><td colspan="16" class="muted">Showing first ${visibleProjects.length} of ${state.projects.length} projects. Use search or filters to narrow the list.</td></tr>`
    );
  }
  $$('[data-edit]').forEach((btn) => btn.addEventListener('click', () => openProject(Number(btn.dataset.edit))));
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
  $$('.view').forEach((el) => el.classList.toggle('active', el.id === view));
  $$('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
  $('#viewTitle').textContent = titles[view][0];
  $('#viewSubtitle').textContent = titles[view][1];
  if (view === 'projects') renderProjects();
  if (view === 'reports') renderReport();
}

function openProject(id = null) {
  const form = $('#projectForm');
  form.reset();
  form.elements.currency.value = 'GHS';
  $('#projectDbId').value = '';
  $('#deleteProject').style.visibility = id ? 'visible' : 'hidden';
  $('#dialogTitle').textContent = id ? 'Edit Project' : 'New Project';
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
  $('#projectDialog').showModal();
}

async function saveForm(event) {
  event.preventDefault();
  const form = $('#projectForm');
  const payload = {};
  fields.forEach((field) => {
    const input = form.elements[field];
    if (!input) return;
    payload[field] = input.type === 'checkbox' ? input.checked : input.value;
  });
  const id = $('#projectDbId').value;
  await api(id ? `/api/projects/${id}` : '/api/projects', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(payload),
  });
  $('#projectDialog').close();
  toast('Project saved');
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

async function importExcel(file) {
  setBusy(true, 'Importing workbook', `Uploading ${file.name} and saving tracker rows.`);
  try {
    const bytes = await file.arrayBuffer();
    const result = await api('/api/import', { method: 'POST', body: bytes });
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
  $$('.nav-item').forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  $('#newProjectBtn').addEventListener('click', () => openProject());
  $('#closeDialog').addEventListener('click', () => $('#projectDialog').close());
  $('#cancelProject').addEventListener('click', () => $('#projectDialog').close());
  $('#projectForm').addEventListener('submit', saveForm);
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
  ['#searchInput', '#statusFilter', '#regionFilter', '#serviceFilter', '#archiveFilter', '#fromFilter', '#toFilter']
    .forEach((selector) => $(selector).addEventListener('input', load));
  $('#clearFilters').addEventListener('click', () => {
    ['#searchInput', '#statusFilter', '#regionFilter', '#serviceFilter', '#archiveFilter', '#fromFilter', '#toFilter']
      .forEach((selector) => { $(selector).value = ''; });
    load();
  });
  $$('[data-report]').forEach((btn) => btn.addEventListener('click', () => {
    state.activeReport = btn.dataset.report;
    renderReport();
  }));
}

bindEvents();
load().catch((error) => toast(error.message));
