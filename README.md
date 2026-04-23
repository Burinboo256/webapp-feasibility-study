# Diagnosis Feasibility Study Webapp

Static prototype for cohort feasibility research. It uses synthetic clinical data generated from `data_dictionary.md` and supports ATLAS/OHDSI-style index events plus i2b2-style inclusion and exclusion panels.

Repository: https://github.com/Burinboo256/webapp-feasibility-study

## Commands

- `npm install` installs runtime dependencies.
- `npm run dev` starts a local static server at `http://localhost:4173`.
- `npm test` runs the cohort feasibility engine tests.
- `node scripts/hash-password.mjs "new-password"` generates a bcrypt hash for `data/users.json`.

## Local Setup

1. Install Node.js 20 or newer.
2. Install dependencies:

```bash
npm install
```

3. Create a local synthetic dataset if needed:

```bash
cp public/data/synthetic-clinical-data_example.json public/data/synthetic-clinical-data.json
```

4. Start the app:

```bash
npm run dev
```

5. Open `http://127.0.0.1:4173`.

## Configuration

The app now uses one checked-in config file:

```text
config/app.config.json
```

Use that file to control:

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

The app requires login before using the cohort builder or logs page. Login identity is included in feasibility run audit records.

Development sessions are stored in server memory. Restarting `npm run dev` clears active login sessions and users must sign in again.

Credentials provider:

- User records are stored in `data/users.json`.
- Passwords are stored as bcrypt hashes in `passwordHash`.
- Development demo account: `researcher@example.com` / `ChangeMe123!`.
- Replace the demo account before using the app with non-demo data.
- Create-user flow sends an email OTP and creates the JSON user only after OTP confirmation.
- Forgot-password flow sends an email OTP and updates the bcrypt password only after OTP confirmation.

Email OTP:

- Set SMTP values in `config/app.config.json` to send real OTP email.
- If SMTP host is blank, OTPs are printed to the dev server console for local testing.
- If SMTP delivery fails while running in local mode, the app falls back to the dev server console and returns a clear warning message.

Google OAuth provider:

- Set Google OAuth values in `config/app.config.json`.
- If redirect URI is blank, the app derives `http://<host>:<port>/api/auth/google/callback` from the server settings.
- Allowed emails can be configured in the file or overridden with `GOOGLE_ALLOWED_EMAILS`.

Example:

```bash
npm run dev
```

## Cloud Deployment Setup

This app now needs the Node server in `scripts/dev-server.mjs`; do not deploy it as static files only if login, OTP, Google OAuth, or protected audit pages are required.

Typical cloud setup:

1. Deploy the repository to a Node-capable host such as Render, Railway, Fly.io, Azure App Service, AWS Elastic Beanstalk, a VM, or an internal hospital server.
2. Run `npm install` during build.
3. Start with `npm run dev` or `node scripts/dev-server.mjs`.
4. Update `config/app.config.json` for the target environment.
5. Override `HOST` or `PORT` only when the platform injects them dynamically.
6. Configure Google OAuth redirect URL to match the public app URL.
7. Configure SMTP variables so OTP emails are actually sent.
8. Replace demo users and passwords before exposing the app.

Example cloud start command:

```bash
HOST=0.0.0.0 PORT=4173 npm run dev
```

Example production-style config values:

```bash
Edit config/app.config.json, for example:

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

- `clinicalDataSource` controls where cohort feasibility counts and concept catalog data come from.
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

Credentials users are stored in `data/users.json`.

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
- Saved cohorts and audit logs are currently stored in each browser with `localStorage`.
- Browser-local audit logs do not provide central monitoring across all users or devices.
- For production audit, move sessions, saved cohorts, and run logs to a database.
- If running multiple server instances, use shared session storage and a shared user database.

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

- Domains: diagnosis, lab, and drug release/prescription.
- Cohort logic: multiple T0 index event conditions, AND/OR condition logic, demographics, inclusion criteria, exclusion criteria, comorbidity diagnosis filters, lab thresholds, drug timing before/after T0, and multiple code/name concept selection.
- Concept picker: diagnosis, lab, and drug controls use searchable dropdown lists generated from the synthetic dataset; users can search, select visible matches, clear visible matches, clear all, and confirm with an Apply button.
- Startup state: the app opens with no selected concepts; use the preset buttons to load example cohort definitions.
- Saved cohorts: users can save the current cohort selection with a name, search saved definitions by name/question/code/concept, reload them later, and delete old saved definitions. Saved cohorts are stored in the browser with `localStorage`.
- SQL builder: the right panel generates CTE-based MSSQL from the selected cohort criteria and includes a Copy SQL button.
- Results panel: shows T0 index and final cohort counts, horizontal attrition bars, and a clickable SVG cohort workflow diagram.
- Workflow export: the cohort workflow diagram can be downloaded as SVG or 2x PNG.
- Session logs: `/logs.html` shows browser-local session counts and feasibility run audit records.
- Data: synthetic only. Local development reads `public/data/synthetic-clinical-data.json` first, but that file is ignored by Git. The committed example dataset is `public/data/synthetic-clinical-data_example.json`.

## Saved Cohort Selections

Use **Save current** to store the current research question, T0 conditions, demographics, inclusion rules, exclusion rules, selected concepts, timing windows, and lab value filters.

Saved definitions are kept in the current browser only. They are not sent to a server and are not shared across devices unless browser storage is copied or exported separately.

## Session And Run Logs

Open `http://localhost:4173/logs.html` to view prototype audit logs.

- Each browser session receives a generated session ID.
- Each manual **Run feasibility count** action creates a run log.
- Run logs include the research question, T0 count, final cohort count, attrition, generated SQL, full cohort config, and selected diagnosis/lab/drug concepts.
- Logs can be searched and exported as JSON.

This is local browser monitoring only. It can show how the current browser uses the app, but it cannot count all users across machines until a shared backend or database audit service is added.

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
