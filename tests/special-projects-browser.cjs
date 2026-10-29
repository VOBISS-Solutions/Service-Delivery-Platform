const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..', 'static');
const stageRows = [Array(12).fill('Completed'), ['Blocked', ...Array(11).fill('Not Started')]];
const links = stageRows.map((stages, i) => ({ id: String(i + 1), link: i ? 'B-C' : '<img src=x onerror=alert(1)>', a: 'A', b: 'B', type: '10G CSG', priority: 'P1', team: 'Test Team', fiber: 'New fibre', stages, status: i ? 'Blocked' : 'Completed', fraction: i ? 0 : 1, issue: i ? 'Awaiting access' : '', remarks: '<script>invalid()</script>', updated: '2026-10-29' }));
let imported = false, rejectImport = false, imports = 0;
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    req.resume();
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/special-projects/import') {
        imports++;
        if (rejectImport) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid workbook. Previous snapshot retained.' })); return; }
        imported = true; res.end(JSON.stringify({ total_links: links.length })); return;
      }
      if (req.url === '/api/special-projects') { res.end(JSON.stringify({ links: imported ? links : [], imported_at: imported ? '2026-10-29T10:00:00+00:00' : null })); return; }
      const result = req.url.startsWith('/api/projects') ? { projects: [] } : req.url.startsWith('/api/options') ? { statuses: ['Completed'] } : {};
      res.end(JSON.stringify(result));
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
    page.on('dialog', dialog => { if (dialog.type() === 'confirm') dialog.accept(); else { errors.push('Unexpected dialog'); dialog.dismiss(); } });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('[data-view="special"]').click();
    const frame = page.frameLocator('#specialProjectsFrame');
    await frame.locator('.source').filter({ hasText: 'No workbook imported' }).waitFor();
    assert.equal(await frame.locator('.metric strong').first().textContent(), '0');
    assert.equal(await frame.locator('#scenario').count(), 0, 'Production must not expose sample scenarios');
    assert.equal(await page.locator('#newProjectBtn').isVisible(), false, 'Special Projects must not create BAU projects');
    await frame.locator('#specialImport').setInputFiles({ name: 'tracker.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('fixture') });
    await frame.locator('.source').filter({ hasText: 'Last imported' }).waitFor();
    assert.equal(await frame.locator('.metric strong').first().textContent(), '2');
    await frame.locator('#trackerTab').click();
    await frame.locator('#rows tr[data-link]').first().click();
    await frame.locator('#detail').waitFor({ state: 'visible' });
    assert.equal(await frame.locator('.detail-stage').count(), 12);
    assert.equal(await frame.locator('#detailBody script').count(), 0, 'Imported HTML must be escaped');
    await frame.locator('#done').click();
    await frame.locator('#matrixView').click();
    assert.equal(await frame.locator('#head th').count(), 13);
    await frame.locator('#search').fill('B-C');
    assert.equal(await frame.locator('#rows tr[data-link]').count(), 1);
    await frame.locator('#clear').click();
    await frame.locator('#overviewTab').click();
    await page.screenshot({ path: 'outputs/special-projects-integrated.png', fullPage: true });
    rejectImport = true;
    await frame.locator('#specialImport').setInputFiles({ name: 'invalid.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('bad') });
    await frame.locator('#loadError').waitFor({ state: 'visible' });
    assert.equal(await frame.locator('.metric strong').first().textContent(), '2', 'Failed import must keep previous records');
    assert.equal(imports, 2);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await frame.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator('[data-view="projects"]').click();
    assert.ok(await page.locator('#newProjectBtn').isVisible());
    assert.equal(await page.locator('#projectHeaderRow th').count(), 16);
    assert.deepEqual(errors, []);
    console.log('PASS: empty state, workbook import, read-only details, HTML escaping, matrix, filters, failure retention, mobile, existing Projects navigation');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
