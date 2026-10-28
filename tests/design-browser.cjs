const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..', 'static');
const statuses = ['Completed', 'On-Hold', 'In-Progress', 'Cancelled', 'Survey'];
const project = { id: 1, project_id: 'PRJ-TEST-1', customer_name: 'Test Customer', site_name: 'Test Site', work_stream: 'BAU', status: 'In-Progress', currency: 'GHS', mrc: 100, nrc: 200, aging_bucket: '0-30', aging_days: 5 };
const writes = [];
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (req.method !== 'GET') writes.push({ method: req.method, url: req.url, body: JSON.parse(body || '{}') });
      const url = new URL(req.url, 'http://localhost');
      const stream = url.searchParams.get('work_stream') || 'BAU';
      const rows = Array.from({ length: 25 }, (_, i) => ({ ...project, id: i + 1, project_id: `PRJ-TEST-${i + 1}`, work_stream: stream, poc_start_date: '2026-10-01', poc_end_date: '2026-11-01', poc_duration_days: 31, poc_state: 'Active', poc_days_remaining: 4 }));
      const result = url.pathname === '/api/options' ? { statuses, region: ['Greater Accra'], service_type: ['L2'] } : url.pathname === '/api/summary' ? { total_projects: 25, financials_by_currency: { GHS: { mrc: 2500, nrc: 5000 }, USD: { mrc: 100, nrc: 200 } }, materials: {}, costs: { total_cost: 500 }, poc: {}, status_counts: {}, aging_buckets: {} } : url.pathname === '/api/projects' && req.method === 'GET' ? rows : { success: true };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(url.pathname === '/api/projects' && req.method === 'GET' ? { projects: rows } : result));
    });
    return;
  }
  const file = path.join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('[data-view="projects"]').click();
    await page.locator('#projectRows tr[data-project-id]').first().waitFor();
    await page.locator('#projectRows tr[data-project-id]').first().dblclick();
    const dialog = page.locator('#projectDialog');
    await dialog.waitFor({ state: 'visible' });
    const box = await dialog.boundingBox();
    assert.ok(Math.abs(box.x + box.width - 1440) < 2, 'Editor must align with the right edge');
    await page.locator('#cancelProject').click();
    await page.locator('[data-status-id="1"]').selectOption('Completed');
    await page.waitForFunction(() => document.querySelector('[data-status-id="1"]')?.disabled === false);
    assert.ok(writes.some(w => w.method === 'PUT' && w.body.status === 'Completed'), 'Status must save through the existing API');
    await page.locator('#projectRows tr[data-project-id]').first().dblclick();
    await page.locator('#projectForm input[name="site_name"]').fill('Duplicate Site');
    await page.locator('#duplicateProject').click();
    await dialog.waitFor({ state: 'hidden' });
    assert.ok(writes.some(w => w.method === 'POST' && w.body.site_name === 'Duplicate Site'), 'Save as new must POST');
    await page.locator('.project-table-wrap').evaluate(el => { el.scrollTop = 400; });
    const sticky = await page.locator('#projectHeaderRow th').first().boundingBox();
    const container = await page.locator('.project-table-wrap').boundingBox();
    assert.ok(Math.abs(sticky.y - container.y) < 3, 'Column headers must remain visible');
    await page.locator('.project-table-wrap').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: 'outputs/service-delivery-implemented.png', fullPage: true });
    await page.locator('[data-view="poc"]').click();
    await page.locator('[data-poc-date-id]').first().waitFor();
    assert.equal(await page.locator('#projectHeaderRow th').count(), 9);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile page must not overflow horizontally');
    await page.screenshot({ path: 'outputs/service-delivery-implemented-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 800, height: 900 });
    await page.locator('[data-view="analytics"]').click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Tablet analytics must not overflow');
    assert.deepEqual(errors, []);
    console.log('PASS: side editor, API status update, duplicate POST, sticky headers, POC columns, mobile overflow, browser errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
