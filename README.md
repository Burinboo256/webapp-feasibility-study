# Diagnosis Feasibility Study Webapp

Node.js prototype for cohort feasibility research. It uses synthetic clinical data generated from `data_dictionary.md`, supports ATLAS/OHDSI-style index events plus i2b2-style inclusion and exclusion panels, and now includes a reusable Airtable-style nested condition builder with a separate diagnosis/lab/drug master dictionary page.

Repository: https://github.com/Burinboo256/webapp-feasibility-study

## Commands

- `pnpm install` installs runtime dependencies.
- `pnpm dev` starts a local static server at `http://localhost:4173`.
- `pnpm test` runs the cohort feasibility engine tests.
- `pnpm sync-dictionary` refreshes the local master dictionary snapshot from the configured Google Sheets.
- `node scripts/hash-password.mjs "new-password"` generates a bcrypt hash for your local `data/users.json`.

## Local Setup

1. Install Node.js 20 or newer.
2. Install dependencies:

```bash
pnpm install
```

3. Create local config and credential files from the checked-in examples:

```bash
cp config/app.config.example.json config/app.config.json
cp data/users.example.json data/users.json
cp data/user-sessions.example.json data/user-sessions.json
cp data/pending-otps.example.json data/pending-otps.json
cp data/saved-cohorts.example.json data/saved-cohorts.json
cp data/feasibility-run-logs.example.json data/feasibility-run-logs.json
cp data/audit-session-logs.example.json data/audit-session-logs.json
```

4. Create a local synthetic dataset if needed:

```bash
cp public/data/synthetic-clinical-data_example.json public/data/synthetic-clinical-data.json
```

5. Start the app:

```bash
pnpm dev
```

6. Open `http://127.0.0.1:4173`.

## Configuration

The repo now keeps only the checked-in config template:

```text
config/app.config.example.json
```

Create your local `config/app.config.json` from the example before editing it. The local file is Git-ignored so secrets do not get committed again.

Use the config file to control:

- server host, port, and secure-cookie behavior
- OTP/session settings
- Google OAuth settings
- SMTP settings
- clinical feasibility data-source selection
- app storage mode for users, sessions, saved cohorts, and audit logs
- SQL Server connection settings

Environment variables are still supported as overrides when needed for deployment secrets or platform-provided ports. The main supported overrides are:

- `PORT`
- `HOST`
- `COOKIE_SECURE`
- `CLINICAL_DATA_SOURCE`
- `APP_STORAGE`
- `DATA_SOURCE`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_ALLOWED_EMAILS`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `SQLSERVER_HOST`
- `SQLSERVER_PORT`
- `SQLSERVER_DATABASE`
- `SQLSERVER_USER`
- `SQLSERVER_PASSWORD`
- `SQLSERVER_ENCRYPT`
- `SQLSERVER_TRUST_SERVER_CERTIFICATE`

## Login And Audit Identity

The app requires login before using the cohort builder, master dictionary, or logs page. Login identity is included in feasibility run audit records.

Development sessions are stored in server memory. Restarting `pnpm dev` clears active login sessions and users must sign in again.

Credentials provider:

- User records are loaded from local `data/users.json`, with `data/users.example.json` as the checked-in template.
- Passwords are stored as bcrypt hashes in `passwordHash`.
- Development demo account: `researcher@example.com` / `ChangeMe123!`.
- Replace the demo account before using the app with non-demo data.
- Create-user flow sends an email OTP and creates the JSON user only after OTP confirmation.
- Forgot-password flow sends an email OTP and updates the bcrypt password only after OTP confirmation.

Email OTP:

- Set SMTP values in your local `config/app.config.json` to send real OTP email.
- If SMTP host is blank, OTPs are printed to the dev server console for local testing.
- If SMTP delivery fails while running in local mode, the app falls back to the dev server console and returns a clear warning message.

Google OAuth provider:

- Set Google OAuth values in your local `config/app.config.json`.
- If redirect URI is blank, the app derives `http://<host>:<port>/api/auth/google/callback` from the server settings.
- Allowed emails can be configured in the file or overridden with `GOOGLE_ALLOWED_EMAILS`.

Example:

```bash
pnpm dev
```

## Cloud Deployment Setup

This app now needs the Node server in `scripts/dev-server.mjs`; do not deploy it as static files only if login, OTP, Google OAuth, or protected audit pages are required.

Typical cloud setup:

1. Deploy the repository to a Node-capable host such as Render, Railway, Fly.io, Azure App Service, AWS Elastic Beanstalk, a VM, or an internal hospital server.
2. Run `pnpm install` during build.
3. Start with `pnpm dev` or `node scripts/dev-server.mjs`.
4. Create `config/app.config.json` from `config/app.config.example.json`, then update the local file for the target environment.
5. Override `HOST` or `PORT` only when the platform injects them dynamically.
6. Configure Google OAuth redirect URL to match the public app URL.
7. Configure SMTP variables so OTP emails are actually sent.
8. Replace demo users and passwords before exposing the app.

Example cloud start command:

```bash
HOST=0.0.0.0 PORT=4173 pnpm dev
```

Example production-style config values:

```bash
Edit your local config/app.config.json, for example:

server.host=0.0.0.0
server.port=4173
server.cookieSecure=true
auth.google.redirectUri=https://your-domain.example/api/auth/google/callback
auth.google.allowedEmails=["researcher1@example.com","researcher2@example.com"]
smtp.host=smtp.example.com
smtp.port=587
smtp.secure=false
smtp.user=cohort-lens@example.com
smtp.pass=your-smtp-password
smtp.from=Cohort Lens <cohort-lens@example.com>
```

### Data Source Switch

Feasibility execution and app persistence now use two independent switches:

```bash
config/app.config.json -> clinicalDataSource: "json"
config/app.config.json -> appStorage: "local"
```

or

```bash
config/app.config.json -> clinicalDataSource: "sqlserver"
config/app.config.json -> appStorage: "sqlserver"
config/app.config.json -> sqlServer.server
config/app.config.json -> sqlServer.port
config/app.config.json -> sqlServer.database
config/app.config.json -> sqlServer.user
config/app.config.json -> sqlServer.password
config/app.config.json -> sqlServer.options.encrypt
config/app.config.json -> sqlServer.options.trustServerCertificate
```

Notes:

- `clinicalDataSource` controls where cohort feasibility counts and cohort execution data come from.
- `appStorage` controls where app users, sessions, pending OTPs, saved cohorts, and audit logs live.
- Demolocal : `clinicalDataSource: "json"` and `appStorage: "local"` are the default checked-in values.
- Production-like : `clinicalDataSource: "sqlserver"` or `appStorage: "sqlserver"` requires the SQL Server driver `mssql`.
- `CLINICAL_DATA_SOURCE` and `APP_STORAGE` can override the file for deployment-specific switching.
- The legacy `DATA_SOURCE` env var is still accepted as an override for `clinicalDataSource`.
- The browser now uses backend APIs for feasibility runs, saved cohorts, and audit logs, so storage mode switching is handled on the server.

### Google OAuth Configuration

In Google Cloud Console:

- Create an OAuth client for a web application.
- Add the app origin, for example `https://your-domain.example`.
- Add the redirect URI, for example `https://your-domain.example/api/auth/google/callback`.
- Put the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- Use `GOOGLE_ALLOWED_EMAILS` to restrict access during prototype deployment.

### SMTP OTP Configuration

Create-user and forgot-password flows require OTP confirmation by email.

- With `SMTP_HOST` configured, OTPs are sent by email through `nodemailer`.
- Without `SMTP_HOST`, OTPs print to the server console for development only.
- In local development, SMTP send failures also fall back to the server console so sign-up testing is not blocked by relay issues.
- For cloud deployment, configure SMTP before enabling user self-service.

### User Table Configuration

Credentials users are stored in your local `data/users.json`. Start from `data/users.example.json` and keep the local file out of Git.

User shape:

```json
{
  "id": "user-researcher-001",
  "email": "researcher@example.com",
  "name": "Demo Researcher",
  "role": "researcher",
  "passwordHash": "$2b$...",
  "active": true
}
```

Generate a password hash:

```bash
node scripts/hash-password.mjs "strong-password"
```

For a real multi-user deployment, replace the JSON file with a database-backed user table. JSON writes are acceptable for local prototype use, but they are not safe for concurrent multi-instance cloud deployments.

### Storage And Scaling Notes

- Login sessions are stored in server memory. Restarting the server signs users out.
- Saved cohorts and audit logs use the active `appStorage` backend.
- In local mode, saved cohorts and logs are written to server-local JSON files under `data/`.
- In SQL mode, saved cohorts and logs are written to the shared SQL Server application tables.
- For multi-instance deployment, use shared session storage and shared SQL-backed app storage.

## Stop Dev Server

Find the process listening on the default port:

```bash
lsof -nP -iTCP:4173 -sTCP:LISTEN
```

Stop it with the PID from the `lsof` output:

```bash
kill <PID>
```

Use `kill -9 <PID>` only if the process does not stop normally.

## Current Scope

- Domains: diagnosis, lab, and drug release or prescription.
- Cohort logic: reusable Airtable-style nested filter groups for T0 index event conditions, inclusion criteria, and exclusion criteria.
- Filter groups: nested AND/OR groups, add and delete condition rows, add and delete groups, typed operators by field type, and validation against the allowed field whitelist.
- Timing logic: inclusion and exclusion timing is expressed with `Days from T0`, so negative values mean before T0 and positive values mean after T0.
- Startup state: the app opens with no selected concepts; use the preset buttons to load example cohort definitions.
- Master dictionary: `/dictionary.html` provides a separate read-only diagnosis/lab/drug lookup page for searching code, name, group, and count before entering conditions.
- Dictionary data: the UI reads `public/data/master-dictionary.json`, which is a checked-in local snapshot generated from the ICD-10, ICD-9, lab, and drug Google Sheets.
- Dictionary refresh: run `pnpm sync-dictionary` to rebuild the local snapshot from the upstream Google Sheets.
- Saved cohorts: users can save the current cohort selection with a name, search saved definitions by name or content, reload them later, and delete old saved definitions through the active backend storage mode.
- SQL builder: the right panel generates CTE-based MSSQL from the selected cohort criteria and includes a Copy SQL button.
- Results panel: shows T0 index and final cohort counts, horizontal attrition bars, and a clickable SVG cohort workflow diagram.
- Workflow export: the cohort workflow diagram can be downloaded as SVG or 2x PNG.
- Session logs: `/logs.html` reads session counts and feasibility run audit records from the active backend storage mode.
- Data: synthetic only. Local development reads `public/data/synthetic-clinical-data.json` first, but that file is ignored by Git. The committed example dataset is `public/data/synthetic-clinical-data_example.json`.

## Saved Cohort Selections

Use **Save current** to store the current research question, T0 conditions, demographics, inclusion rules, exclusion rules, nested group logic, timing windows, and lab value filters.

Saved definitions are handled through backend APIs. In local mode they are written to `data/saved-cohorts.json` on this server; in SQL mode they are written to the configured SQL Server application tables.

## Session And Run Logs

Open `http://localhost:4173/logs.html` to view prototype audit logs.

- Each signed-in session receives a generated session record.
- Each manual **Run feasibility count** action creates a run log.
- Run logs include the research question, T0 count, final cohort count, attrition, generated SQL, full cohort config, and the selected filter-tree conditions.
- Logs can be searched and exported as JSON.

This page reads the active backend storage mode. Local mode stays on this server; SQL mode uses the shared SQL database.

## Master Dictionary

Open `http://localhost:4173/dictionary.html` to search the diagnosis, lab, and drug master dictionary before building conditions.

- Search supports code, name, group, and count.
- Domain tabs let users focus on diagnosis, lab, or drug entries.
- Each result exposes copy actions for code and name.
- The page reads the local snapshot in `public/data/master-dictionary.json`.
- Source links for the ICD-10, ICD-9, lab, and drug sheets are shown in the UI.

Refresh the snapshot with:

```bash
pnpm sync-dictionary
```

## Synthetic Data Files

Use the example file to create a local working dataset:

```bash
cp public/data/synthetic-clinical-data_example.json public/data/synthetic-clinical-data.json
```

Keep generated or large synthetic datasets in `public/data/synthetic-clinical-data.json`. Do not commit that local file.

## Generated SQL

The SQL Builder panel creates SQL Server style cohort SQL from the selected criteria.

- Base table: `Patient_Info`
- Patient key: `OH_PID`
- Diagnosis table: `Diagnosis`
- Laboratory table: `Laboratory`
- Medication table: `Medication`
- SQL pattern: CTEs plus `EXISTS` / `NOT EXISTS`
- Date functions: `DATEDIFF`, `DATEADD`, and `BETWEEN`
- Date format: `'YYYY-MM-DD'`

The generated SQL is a feasibility-study draft, not a production query. Review table and column mappings before running it against a real clinical database.

## Workflow Diagram

The cohort workflow diagram shows five attrition steps:

- Has index event (T0)
- After demographic filters
- After inclusion logic
- After exclusion logic
- Final cohort

Each step is color-coded. Blue means no patient drop, amber means patients were excluded at that step, and teal/green marks the final cohort. Clicking a node sends a follow-up prompt through `sendPrompt()` when the hosting environment provides it.

## Healthcare Data Assumptions

- `hn` is the central synthetic patient key.
- Diagnosis T0 uses `diagnosis_record.service_date`.
- Lab T0 uses `lab_result.test_date` and parses numeric values from `result_value`.
- Drug release uses `prescription_order.order_date`.
- When multiple T0 conditions are configured, each condition can be combined with AND/OR. The first matching T0 condition by list order sets the cohort entry date for before/after timing.
- Age at T0 is derived from diagnosis or lab event age fields because `patient_master` does not contain birth date.
