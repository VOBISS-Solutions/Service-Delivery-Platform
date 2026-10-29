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

SharePoint live synchronization is **not configured**. Browser access to the
workbook does not establish server credentials. Sync now stays disabled;
Open workbook opens the source. The page reports its last manual import and
reloads the stored snapshot when revisited. Microsoft Graph access and a
refresh schedule remain separate deployment work.

Validation commands (browser tests require Playwright and installed Edge):

```text
python -m unittest discover -s tests -p "test_special*.py"
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
