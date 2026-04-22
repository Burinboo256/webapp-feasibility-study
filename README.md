# Diagnosis Feasibility Study Webapp

Static prototype for cohort feasibility research. It uses synthetic clinical data generated from `data_dictionary.md` and supports ATLAS/OHDSI-style index events plus i2b2-style inclusion and exclusion panels.

Repository: https://github.com/Burinboo256/webapp-feasibility-study

## Commands

- `npm run dev` starts a local static server at `http://localhost:4173`.
- `npm test` runs the cohort feasibility engine tests.

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
- SQL builder: the right panel generates CTE-based MSSQL from the selected cohort criteria and includes a Copy SQL button.
- Results panel: shows T0 index and final cohort counts, horizontal attrition bars, and a clickable SVG cohort workflow diagram.
- Workflow export: the cohort workflow diagram can be downloaded as SVG or 2x PNG.
- Data: synthetic only. Local development reads `public/data/synthetic-clinical-data.json` first, but that file is ignored by Git. The committed example dataset is `public/data/synthetic-clinical-data_example.json`.

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
