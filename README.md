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
Start command: HOST=0.0.0.0 python app.py
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

The importer accepts headers such as `Project ID`, `Customer Name`, `Site Name`,
`Region`, `Service Type`, `Confirmation Date`, `Target Completion Date`,
`Completion Date`, `Status`, `MRC`, `NRC`, `9m Poles`, `11m Poles`, `Labour`,
and `Trench`.

If `Project ID` exists in the spreadsheet and matches an existing project, that
project is updated. Otherwise, a new project is created.
