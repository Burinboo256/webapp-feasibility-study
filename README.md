# Diagnosis Feasibility Study Webapp

Static prototype for cohort feasibility research. It uses synthetic clinical data generated from `data_dictionary.md` and supports ATLAS/OHDSI-style index events plus i2b2-style inclusion and exclusion panels.

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
- Concept picker: diagnosis, lab, and drug controls use searchable dropdown lists generated from the synthetic dataset; selections are confirmed with an Apply button.
- Startup state: the app opens with no selected concepts; use the preset buttons to load example cohort definitions.
- SQL builder: the right panel generates CTE-based MSSQL from the selected cohort criteria and includes a Copy SQL button.
- Data: synthetic only, stored in `public/data/synthetic-clinical-data.json`.

## Healthcare Data Assumptions

- `hn` is the central synthetic patient key.
- Diagnosis T0 uses `diagnosis_record.service_date`.
- Lab T0 uses `lab_result.test_date` and parses numeric values from `result_value`.
- Drug release uses `prescription_order.order_date`.
- When multiple T0 conditions are configured, each condition can be combined with AND/OR. The first matching T0 condition by list order sets the cohort entry date for before/after timing.
- Age at T0 is derived from diagnosis or lab event age fields because `patient_master` does not contain birth date.
