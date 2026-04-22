---
name: healthcare-research-devops
description: Use when working on healthcare research software, clinical data platforms, DevOps, ETL, interoperability, or analytics involving OMOP CDM, InterSystems IRIS, HL7 v2, FHIR, EHR data, cohort definitions, or healthcare data quality and governance.
---

# Healthcare Research DevOps

## Purpose

Apply this skill when building, reviewing, or operating healthcare research systems that combine programming, DevOps, clinical data models, and interoperability standards.

Core domains:
- Healthcare research workflows, cohort discovery, observational studies, and clinical analytics.
- OMOP Common Data Model (CDM) mapping, vocabulary handling, ETL validation, and data quality checks.
- InterSystems IRIS database design, SQL, ObjectScript-aware integration, interoperability productions, and operational monitoring.
- HL7 v2 message processing and FHIR resource/API integration.
- Secure DevOps for regulated health data environments.

## Operating Principles

- Treat health data as sensitive by default. Avoid exposing PHI/PII in logs, test fixtures, prompts, commits, screenshots, and examples.
- Prefer reproducible pipelines: version schemas, mappings, vocabularies, config, infrastructure, and validation reports.
- Separate clinical assumptions from code. Document phenotype logic, inclusion/exclusion rules, source-system caveats, and vocabulary choices.
- Validate against real healthcare failure modes: missing units, local codes, duplicate encounters, timezone drift, merged patients, partial feeds, late-arriving results, and inconsistent identifiers.
- Do not provide clinical diagnosis or treatment advice. Focus on software, data engineering, research informatics, and implementation quality.

## Workflow

1. Clarify the healthcare context: research question, source systems, data model, message format, regulatory constraints, and deployment environment.
2. Identify the data path: ingestion, normalization, mapping, persistence, validation, analytics, export, and monitoring.
3. Check standards fit: OMOP CDM for research analytics, HL7 v2 for event/message feeds, FHIR for resource APIs, and IRIS for database/interoperability workloads.
4. Design for traceability: preserve source identifiers, load batch IDs, mapping provenance, vocabulary versions, and transformation audit logs.
5. Implement defensively: validate schemas, use idempotent ETL, make retries safe, fail loudly on data contract breaks, and protect secrets.
6. Add tests for mappings, parsers, SQL logic, edge cases, and deployment scripts.
7. Document validation performed, unresolved assumptions, and operational runbooks.

## OMOP CDM Guidance

- Confirm the OMOP CDM version before writing table definitions, queries, or ETL logic.
- Map source events to the correct clinical domains: person, visit, condition, drug, procedure, measurement, observation, device, specimen, note, and cost when applicable.
- Use standard concepts where possible and preserve source concepts in source fields.
- Track vocabulary release versions and mapping decisions.
- Validate required fields, domain consistency, date ordering, visit linkage, concept validity, and plausible units/ranges.
- For cohorts, express logic clearly and test inclusion/exclusion criteria with small known examples.

## InterSystems IRIS Guidance

- Distinguish between IRIS SQL, persistent classes, globals, ObjectScript, interoperability productions, and external APIs.
- Prefer parameterized SQL and least-privilege database users.
- Design indexes around query patterns, especially patient, encounter, timestamp, identifier, and batch columns.
- Monitor ingestion queues, message failures, storage growth, journal behavior, backup health, and mirroring/failover where used.
- Keep environment-specific settings outside source code and manage them through secrets/configuration tooling.

## HL7 and FHIR Guidance

- For HL7 v2, identify message type, trigger event, version, encoding characters, segment optionality, local Z-segments, and acknowledgement behavior.
- Parse HL7 v2 defensively; do not assume all senders populate required-looking fields consistently.
- For FHIR, confirm the FHIR release, implementation guide, profile constraints, terminology bindings, and pagination/search behavior.
- Validate examples against schemas or profiles when possible.
- Preserve message/resource provenance and correlation IDs for debugging.

## DevOps Guidance

- Use infrastructure as code when infrastructure is part of the task.
- Add CI checks for formatting, tests, schema validation, dependency scanning, and container builds when appropriate.
- Use synthetic or de-identified data for tests and demos.
- Keep secrets in secret managers or environment variables, never in repository files.
- Add operational visibility: structured logs without PHI, metrics, alerts, dashboards, backup checks, and restore drills.
- Make deployments reversible with migrations, backups, rollback plans, and release notes.

## Output Expectations

When responding or making changes:
- State key healthcare/data assumptions explicitly.
- Include validation steps or tests that should be run.
- Flag PHI, regulatory, clinical-safety, or data-quality risks.
- Prefer precise terminology: OMOP CDM, InterSystems IRIS, HL7 v2, FHIR, ETL, vocabulary, phenotype, cohort, and provenance.
- Recommend consulting official standard documentation or organization-specific interface specs when exact field semantics matter.
