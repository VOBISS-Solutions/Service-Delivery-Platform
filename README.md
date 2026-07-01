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

The SQLite database is created at `data/project_tracker.db`.

## Host on Render

This repo includes `render.yaml` for a small Render web service.

1. Push the project to GitHub.
2. In Render, create a new Blueprint from the GitHub repo.
3. Render will use:
   - Build command: `pip install -r requirements.txt`
   - Start command: `HOST=0.0.0.0 python app.py`
   - Persistent database path: `/var/data/project_tracker.db`

For another host, set these environment variables:

```text
HOST=0.0.0.0
PORT=<provided by host>
TRACKER_PASSWORD=<password shared with testers>
DATABASE_PATH=<persistent path>/project_tracker.db
```

## Excel Import Notes

The importer accepts headers such as `Project ID`, `Customer Name`, `Site Name`,
`Region`, `Service Type`, `Confirmation Date`, `Target Completion Date`,
`Completion Date`, `Status`, `MRC`, `NRC`, `9m Poles`, `11m Poles`, `Labour`,
and `Trench`.

If `Project ID` exists in the spreadsheet and matches an existing project, that
project is updated. Otherwise, a new project is created.
