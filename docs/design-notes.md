# Design Notes

## Product Goal

Researchers need a fast way to estimate whether a clinical study is feasible before writing a full protocol or requesting production data extracts.

## Reference Patterns

- ATLAS/OHDSI: index event, cohort entry date, inclusion/exclusion criteria, and attrition-style result review.
- i2b2: panel-like criteria building across diagnosis, lab, and medication domains.
- Local schema: all queries use the tables and field names from `data_dictionary.md`, not OMOP tables.

## Prototype Decisions

- Use synthetic JSON for development to avoid PHI risk.
- Keep cohort logic in `src/cohortEngine.js` so it can later move behind an API, SQL generator, or InterSystems IRIS service.
- Keep the first UI no-dependency and static so the feasibility workflow can be reviewed before choosing a full application stack.

## Next Backend Evolution

- Translate criteria to parameterized SQL against the source schema or an IRIS mirror.
- Add vocabulary/concept mapping tables for ICD, local drug codes, and lab test codes.
- Add saved cohort definitions, audit logs, user access control, and governance review workflow.
- Add small-cell suppression before showing counts from real patient data.
