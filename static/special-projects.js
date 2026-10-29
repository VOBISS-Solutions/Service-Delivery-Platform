const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const stageNames = [
  'Cable Stringing', 'Cable Entry - Site A', 'Cable Entry - Site B',
  'Fiber Splicing', 'ODF Termination - Site A', 'ODF Termination - Site B',
  'OTDR / Fiber Test', 'Nokia Install - Site A', 'Nokia Install - Site B',
  'Power-up & Commissioning', 'Provisioning', 'Service Up (E2E Test)',
];
const groups = [['Fibre Works', 0, 7], ['Nokia Equipment', 7, 10], ['Service', 10, 12]];
const statuses = ['Not Started', 'In Progress', 'Completed', 'Blocked', 'N/A'];
const statusClasses = { 'Not Started': 'notstarted', 'In Progress': 'progress', Completed: 'completed', Blocked: 'blocked', 'N/A': 'na' };
let data = [], layout = 'list', view = 'overview', lastFocus = null, importing = false;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const pct = value => `${(Number(value || 0) * 100).toFixed(value > 0 && value < .01 ? 1 : 0)}%`;
const pill = status => `<span class="pill ${status.replaceAll(' ', '').replace('/', '')}">${escapeHtml(status)}</span>`;
const average = rows => rows.length ? rows.reduce((total, row) => total + row.fraction, 0) / rows.length : 0;

function choices(id) {
  return $$(`#${id} input:checked`).map(input => input.value);
}

function renderFilter(id, values) {
  const selected = choices(id);
  $(`#${id}`).innerHTML = values.map(value => `<label><input type="checkbox" value="${escapeHtml(value)}" ${selected.includes(value) ? 'checked' : ''}>${escapeHtml(value)}</label>`).join('');
  $(`#${id}`).onchange = render;
}

function filtered() {
  const query = $('#search').value.toLowerCase();
  return data.filter(row => `${row.link} ${row.a} ${row.b}`.toLowerCase().includes(query) &&
    [['types', 'type'], ['priorities', 'priority'], ['statuses', 'status'], ['teams', 'team']]
      .every(([id, key]) => !choices(id).length || choices(id).includes(row[key])));
}

function renderMetrics(rows) {
  const count = status => rows.filter(row => row.status === status).length;
  const metrics = [
    ['Total links', rows.length, `${rows.filter(row => row.type === '10G CSG').length} CSG / ${rows.filter(row => row.type === '100G ASG').length} ASG`],
    ['Completed', count('Completed'), 'All applicable stages done'],
    ['In progress', count('In Progress'), 'Work has started'],
    ['Blocked', count('Blocked'), 'At least one blocked stage'],
    ['Overall completion', pct(average(rows)), 'Average across links'],
  ];
  $('#metrics').innerHTML = metrics.map(([label, value, sub]) => `<div class="metric"><div class="label">${label}</div><strong class="${label === 'Blocked' && value ? 'warning' : ''}">${value}</strong><small>${sub}</small></div>`).join('');
}

function renderStages(rows) {
  $('#stageScope').textContent = `${rows.length} filtered links`;
  $('#stages').innerHTML = groups.map(([group, start, end]) => `<div class="stage-group">${group}</div>` + stageNames.slice(start, end).map((name, index) => {
    const counts = Object.fromEntries(statuses.map(status => [status, rows.filter(row => row.stages[start + index] === status).length]));
    const applicable = rows.length - counts['N/A'];
    const description = statuses.map(status => `${counts[status]} ${status}`).join(', ');
    return `<div class="stage-row"><span>${name}</span><div class="track" role="img" aria-label="${name}: ${description}">${['Completed', 'In Progress', 'Blocked', 'Not Started', 'N/A'].map(status => `<span class="${statusClasses[status]}" title="${status}: ${counts[status]}" style="width:${rows.length ? counts[status] / rows.length * 100 : 0}%"></span>`).join('')}</div><span class="stage-value">${counts.Completed}/${applicable} &nbsp;${pct(applicable ? counts.Completed / applicable : 0)}</span></div>`;
  }).join('')).join('');
}

function renderOverview(rows) {
  renderStages(rows);
  $('#typeSplit').innerHTML = [...new Set(data.map(row => row.type))].sort().map(type => {
    const subset = rows.filter(row => row.type === type);
    return `<div class="split-row"><div class="split-head"><span>${escapeHtml(type)}</span><strong>${subset.length}</strong></div><div class="track"><span class="completed" style="width:${average(subset) * 100}%"></span></div><div class="split-foot">${pct(average(subset))} average completion / ${subset.filter(row => row.status === 'Completed').length} completed links</div></div>`;
  }).join('') || '<p class="note">No workbook data imported.</p>';
  const blocked = rows.filter(row => row.status === 'Blocked');
  $('#blockedCount').textContent = `${blocked.length} links`;
  $('#issues').innerHTML = blocked.length ? blocked.slice(0, 3).map(row => `<article class="issue"><button data-link="${escapeHtml(row.id)}">${escapeHtml(row.link)}</button><p>${escapeHtml(row.issue || 'No blocker description recorded.')}</p><small>${escapeHtml(row.team)}</small></article>`).join('') + (blocked.length > 3 ? '<button id="allBlocked" class="clear">View all blocked links</button>' : '') : `<div class="empty"><i data-lucide="circle-check"></i><div><strong>${data.length ? 'No blocked links' : 'No workbook data yet'}</strong>${data.length ? 'No stage is marked as blocked in this selection.' : 'Import the transport workbook to populate this project.'}</div></div>`;
  if ($('#allBlocked')) $('#allBlocked').onclick = () => {
    $$('#statuses input').forEach(input => { input.checked = input.value === 'Blocked'; });
    setView('tracker'); render();
  };
}

function matrixCell(status, stage) {
  const symbol = { Completed: '&#10003;', 'In Progress': '&#183;', Blocked: '!', 'Not Started': '&#8211;', 'N/A': '/' }[status];
  return `<td><span class="stage-dot ${statusClasses[status]}" title="${stage}: ${status}" aria-label="${stage}: ${status}">${symbol}</span></td>`;
}

function renderTable(rows) {
  $('#table').classList.toggle('matrix', layout === 'matrix');
  const headers = layout === 'matrix' ? ['Link', ...stageNames] : ['Link', 'Type', 'Site A / Site B', 'Priority', 'Completion', 'Overall status', 'Responsible', 'Last updated'];
  $('#head').innerHTML = `<tr>${headers.map(header => `<th scope="col">${header}</th>`).join('')}</tr>`;
  $('#rows').innerHTML = rows.map(row => `<tr data-link="${escapeHtml(row.id)}" tabindex="0" aria-label="Open ${escapeHtml(row.link)}"><td><span class="link-name">${escapeHtml(row.link)}</span></td>${layout === 'matrix' ? row.stages.map((status, index) => matrixCell(status, stageNames[index])).join('') : `<td>${escapeHtml(row.type)}</td><td>${escapeHtml(row.a)} / ${escapeHtml(row.b)}</td><td>${escapeHtml(row.priority)}</td><td>${pct(row.fraction)}<span class="mini"><span style="width:${row.fraction * 100}%"></span></span></td><td>${pill(row.status)}</td><td>${escapeHtml(row.team)}</td><td>${escapeHtml(row.updated || 'Not recorded')}</td>`}</tr>`).join('') || `<tr><td colspan="${headers.length}">${data.length ? 'No links match these filters.' : 'No workbook data imported.'}</td></tr>`;
  $('#tableFoot').textContent = `${rows.length} of ${data.length} links`;
}

function render() {
  const rows = filtered();
  renderMetrics(rows); renderOverview(rows); renderTable(rows);
  $$('[data-link]').forEach(element => {
    element.onclick = () => openLink(element.dataset.link);
    element.onkeydown = event => {
      if (['Enter', ' '].includes(event.key)) { event.preventDefault(); openLink(element.dataset.link); }
    };
  });
  lucide.createIcons();
}

function setView(next) {
  view = next;
  ['overview', 'tracker'].forEach(name => {
    $(`#${name}`).classList.toggle('hidden', name !== view);
    $(`#${name}Tab`).classList.toggle('active', name === view);
    $(`#${name}Tab`).setAttribute('aria-selected', String(name === view));
  });
}

function openLink(id) {
  const row = data.find(item => String(item.id) === id);
  if (!row) return;
  lastFocus = document.activeElement;
  $('#detailTitle').textContent = row.link;
  $('#detailSubtitle').textContent = `${row.type} / ${row.priority}`;
  $('#detailBody').innerHTML = `${pill(row.status)} <strong style="float:right;font-size:20px">${pct(row.fraction)}</strong><div class="detail-meta">${[['Site A', row.a], ['Site B', row.b], ['Fibre link', row.fiber], ['Responsible', row.team]].map(([label, value]) => `<div><small>${label}</small>${escapeHtml(value)}</div>`).join('')}</div>` + groups.map(([name, start, end]) => `<div class="stage-group">${name}</div>` + stageNames.slice(start, end).map((stage, index) => `<div class="detail-stage"><span>${stage}</span>${pill(row.stages[start + index])}</div>`).join('')).join('') + [['Current blocker / issue', row.issue || 'No issue recorded.'], ['Remarks', row.remarks || 'No remarks recorded.'], ['Last updated', row.updated || 'Not recorded']].map(([label, value]) => `<div class="stage-group">${label}</div><p class="note">${escapeHtml(value)}</p>`).join('');
  $('#detail').showModal();
}

async function loadSnapshot() {
  const response = await fetch('/api/special-projects');
  if (response.status === 401) { window.top.location.href = '/login'; return; }
  if (!response.ok) throw new Error('Unable to load Special Projects. Try refreshing the page.');
  const snapshot = await response.json();
  data = snapshot.links;
  $('.source').textContent = snapshot.imported_at ? `Live sync not connected / Last imported ${new Date(snapshot.imported_at).toLocaleString()}` : 'SharePoint not connected / No workbook imported';
  [['types', 'type'], ['priorities', 'priority'], ['teams', 'team']].forEach(([id, key]) => renderFilter(id, [...new Set(data.map(row => row[key]).filter(Boolean))].sort()));
  renderFilter('statuses', statuses.filter(status => status !== 'N/A'));
  $('#loadError').hidden = true;
  render();
}

function showError(error) {
  $('#loadError').hidden = false;
  $('#loadError').textContent = error.message;
}

async function importWorkbook(event) {
  const file = event.target.files[0];
  if (!file || importing) return;
  importing = true;
  const label = $('.workbook-import');
  label.setAttribute('aria-busy', 'true');
  $('#specialImport').disabled = true;
  try {
    if (!file.name.toLowerCase().endsWith('.xlsx') || file.size > 20 * 1024 * 1024) throw new Error('Choose an .xlsx workbook smaller than 20 MB.');
    if (data.length && !window.confirm('Replace the current 4G Transport snapshot with this workbook? Existing links will not be duplicated.')) return;
    const response = await fetch('/api/special-projects/import', { method: 'POST', body: await file.arrayBuffer() });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Workbook import failed. The previous snapshot has been retained.');
    await loadSnapshot();
    $('#toast').textContent = `Imported ${result.total_links} links`;
    $('#toast').style.display = 'block';
    setTimeout(() => { $('#toast').style.display = 'none'; }, 3500);
  } catch (error) { showError(error); }
  finally {
    importing = false; label.removeAttribute('aria-busy');
    event.target.value = ''; $('#specialImport').disabled = false;
  }
}

$('#overviewTab').onclick = () => setView('overview');
$('#trackerTab').onclick = () => setView('tracker');
['list', 'matrix'].forEach(name => {
  $(`#${name}View`).onclick = () => {
    layout = name;
    ['list', 'matrix'].forEach(mode => {
      $(`#${mode}View`).classList.toggle('active', mode === layout);
      $(`#${mode}View`).setAttribute('aria-pressed', String(mode === layout));
    });
    render();
  };
});
$('#search').oninput = render;
$('#clear').onclick = () => { $('#search').value = ''; $$('.menu input').forEach(input => { input.checked = false; }); render(); };
$('#close').onclick = $('#done').onclick = () => $('#detail').close();
$('#detail').onclose = () => lastFocus?.focus();
$('#specialImport').onchange = importWorkbook;
window.addEventListener('message', event => {
  if (event.source === window.parent && event.origin === window.location.origin && event.data?.type === 'refresh-special-projects' && !importing) {
    loadSnapshot().catch(showError);
  }
});
document.addEventListener('click', event => $$('details.filter[open]').forEach(detail => { if (!detail.contains(event.target)) detail.open = false; }));
render();
loadSnapshot().catch(showError);
