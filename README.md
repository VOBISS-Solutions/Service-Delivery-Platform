# Service Delivery Project Tracker

A lightweight database-backed web tracker for Service Delivery projects.

## What is included

- Project CRUD with archive support
- Target completion date delay tracking
- Aging from confirmation date to delivery/completion date
- Dashboard cards and aging/status views
- Search and filters for customer, region, status, service, dates, and archive state
- Planned material totals
- Excel import/export using `.xlsx`
- Summary reports by customer, region, service type, and status

## Run

Use the bundled Codex Python runtime so Excel support is available:

```powershell
C:\Users\edmun_gn8edcx\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe app.py
```

Then open:

```text
http://127.0.0.1:8765
```

For local development, if `DATABASE_URL` is not set, the SQLite database is
created at `data/project_tracker.db`.

## Host on Render with Supabase

This repo includes `render.yaml` for a small Render web service that connects
to Supabase/Postgres when `DATABASE_URL` is configured.

1. Push the project to GitHub.
2. Create a Supabase project and copy the Postgres connection string.
3. In Render, create a new Web Service from the GitHub repo.
4. Use the build and start commands below.
5. Add the environment variables below.

Render settings:

```text
Build command: pip install -r requirements.txt
Start command: HOST=0.0.0.0 REQUIRE_DATABASE_URL=true python app.py
Health check path: /api/health
```

Environment variables:

```text
TRACKER_PASSWORD=<password shared with testers>
DATABASE_URL=<Supabase Postgres connection string>
```

If using the Supabase pooler connection string, keep the required `sslmode`
parameter included in the URL.

Legacy Blueprint note:

If you deploy from `render.yaml` as a Blueprint instead of manually creating a
Web Service, Render will ask for `TRACKER_PASSWORD` and `DATABASE_URL`.
For another host, set these environment variables:

```text
HOST=0.0.0.0
PORT=<provided by host>
TRACKER_PASSWORD=<password shared with testers>
DATABASE_URL=<Supabase Postgres connection string>
```

## Excel Import Notes

## Special Projects

The Special Projects tab contains the 4G Transport overview, link register,
12-stage matrix, multi-select filters, and read-only link details. No example
records are inserted into the database.

Use **Import workbook** with an XLSX containing **Link Status Tracker**. Its
header must appear within the first ten rows and include Link and all twelve
stage columns. Stage values are Not Started, In Progress, Completed, Blocked,
or N/A. The Summary sheet is not imported: the page calculates its summaries
from link records using the workbook's rules. Completion excludes N/A stages;
an entirely N/A link returns zero, matching Excel's IFERROR fallback. Blocked
stages take precedence over other overall statuses.

Imports replace the complete 4G Transport snapshot atomically. Repeat imports
do not append duplicates. Duplicate link identities, invalid statuses, empty
datasets, and invalid or oversized workbooks are rejected without replacing
the previous snapshot. The snapshot is stored in `special_project_sources`,
separate from ordinary Projects, iKlick, and POC records. The table is created
at startup before requests are served; SQLite and PostgreSQL use the same API.

SharePoint live synchronization requires the deployment and Power Automate
configuration below. Browser access does not establish VPS credentials. Sync
now stays disabled because the cloud flow pushes updates; Open workbook opens
the source. The page reports its last receipt and refreshes every minute while
visible, and when revisited. No Microsoft Graph app registration is required.

### Power Automate Workbook Delivery

This is one-way synchronization into Special Projects only. Ordinary Projects,
iKlick, and POC records are not changed. The receiver is disabled unless a
dedicated integration key of at least 32 characters is configured.

Deployment environment variables:

```text
SPECIAL_PROJECTS_INTEGRATION_KEY=<cryptographically random private secret>
SPECIAL_PROJECTS_SOURCE_FILENAME=4G Transport link plan_19.10.26.xlsx
SPECIAL_PROJECTS_TRUSTED_PROXIES=<comma-separated exact proxy IPs or narrow CIDRs>
```

Never commit the key or put it in frontend code. Configure it privately in the
VPS application environment and in the flow's secured HTTP action. Do not use
the application login password. No key is supplied by this repository.

Terminate trusted HTTPS at the VPS reverse proxy. Block direct public access
to the backend port, and have the proxy overwrite `X-Forwarded-Proto`. Only
explicitly allow the proxy's observed backend peer address; never trust
`0.0.0.0/0`. Forwarded HTTPS claims from other peers are rejected. Configure
proxy request-size limits (20 MB maximum), rate limiting, and timeouts. A
self-signed certificate or an HTTPS redirect alone is insufficient.

Without an owned domain, Let's Encrypt supports public IP certificates using
its short-lived profile. Certbot 5.4+ supports IP webroot issuance; installing
the certificate in the existing proxy and automatic renewal/reload must also
be configured. Do not replace the Coolify proxy without inspecting its current
configuration. See [IP certificate setup](https://letsencrypt.org/2026/03/11/shorter-certs-certbot/).

Source identity:

- Site: `https://vobissgh1-my.sharepoint.com/personal/andrew_annor_vobissgh_com`
- Workbook: `4G Transport link plan_19.10.26.xlsx`
- Worksheet: `Link Status Tracker`; summaries are calculated from these rows.
- Document library and folder path: verify in SharePoint's file details/file
  picker. The sharing URL is not the connector's file path.

Create a separate flow, for example **Service Delivery - 4G Transport -
SharePoint Sync**. Use Recurrence (15 minutes is a suggested starting point),
with trigger concurrency **1**. Alternatively use a file-modified trigger
restricted to this exact workbook. Connect SharePoint with the work account
that can read the source. Use Get file content using path after verifying the
path, or Get file content with the verified Identifier.

HTTP action (enable only after trusted HTTPS is verified):

```text
Method: POST
URI: https://167.86.77.74/api/integrations/special-projects/workbook
Content-Type: application/octet-stream
X-Integration-Key: <private integration secret>
X-Source-Filename: 4G Transport link plan_19.10.26.xlsx
```

Inspect the content action's output structure. If it contains `$content`, use
the following expression, replacing the action name with its actual internal
name (for example `Get_file_content_using_path`):

```text
base64ToBinary(body('Get_file_content')?['$content'])
```

Do not send JSON containing `$content` or a base64 string. Set Secure Inputs
and Secure Outputs **On**, chunking **Off**, asynchronous processing **Off**,
and HTTP timeout `PT2M`. Confirm the account's HTTP-action license entitlement;
it may require Power Automate Premium. Do not enable a flow with a placeholder
URL/key or rely on an untrusted certificate.

The receiver validates binary framing, filename, size, workbook and required
columns before atomically replacing the snapshot. Identical binary retries
skip parsing and return `unchanged: true`; both retry and changed imports are
serialized in the database. Nothing is appended. A failed validation retains
the previous snapshot. Responses include `total_links`, `imported_at`, and
`last_received_at`; errors use appropriate 4xx/5xx statuses.

Verification before enabling the schedule:

1. Verify the certificate from an external client and verify the backend port
   is not publicly reachable.
2. Run once and confirm the source filename, successful HTTP response, link
   count and Power Automate receipt time in the application.
3. With workbook-owner approval, make one controlled Excel edit and verify
   the application receives it; restore the test edit if appropriate.
4. Resend identical workbook bytes and confirm `unchanged: true`, unchanged
   link count and unchanged `imported_at`.
5. Verify invalid keys and malformed workbooks do not change stored data.

Validation commands (browser tests require Playwright and installed Edge):

```text
python -m unittest discover -s tests -p "test_special*.py"
python -m unittest discover -s tests -p "test_power_automate.py"
node tests/special-projects-browser.cjs
node tests/design-browser.cjs
```

### Ordinary Project Imports

The importer accepts headers such as `Project ID`, `Customer Name`, `Site Name`,
`Region`, `Service Type`, `Confirmation Date`, `Target Completion Date`,
`Completion Date`, `Status`, `MRC`, `NRC`, `9m Poles`, `11m Poles`, `Labour`,
and `Trench`.

If `Project ID` exists in the spreadsheet and matches an existing project, that
project is updated. Otherwise, a new project is created.
