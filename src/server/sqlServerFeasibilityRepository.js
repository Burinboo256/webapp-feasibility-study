import { buildFeasibilityCountSql } from '../sqlBuilder.js';

const DOMAIN_META = {
  diagnosis: {
    table: 'Diagnosis',
    codeColumn: 'ICD_CODE',
    nameColumn: 'DISEASE_NAME',
    groupColumn: ''
  },
  lab: {
    table: 'Laboratory',
    codeColumn: 'LAB_CODE',
    nameColumn: 'LAB_NAME',
    groupColumn: 'LAB_GROUP_NAME'
  },
  drug: {
    table: 'Medication',
    codeColumn: 'DRUG_CODE',
    nameColumn: 'DRUG_NAME',
    groupColumn: 'DRUG_GROUP_NAME'
  }
};

export class SqlServerFeasibilityRepository {
  constructor(options = {}) {
    this.connectionConfig = options.connectionConfig || options.connection || {};
    this.loadMssql = options.loadMssql || (() => import('mssql'));
    this.poolPromise = null;
  }

  async getBootstrap() {
    return {
      conceptCatalog: await this.loadConceptCatalog()
    };
  }

  async runFeasibility(config) {
    const pool = await this.getPool();
    const request = pool.request();
    const query = buildFeasibilityCountSql(config);
    const response = await request.query(query);
    return normalizeCountResult(response.recordset?.[0] || {});
  }

  config() {
    return { dataSource: 'sqlserver' };
  }

  async run(config) {
    return this.runFeasibility(config);
  }

  async loadConceptCatalog() {
    const pool = await this.getPool();
    const entries = await Promise.all(
      Object.entries(DOMAIN_META).map(async ([domain, meta]) => {
        const response = await pool.request().query(buildConceptCatalogSql(meta));
        return [domain, response.recordset.map((row) => normalizeConcept(row, Boolean(meta.groupColumn)))];
      })
    );
    return Object.fromEntries(entries);
  }

  async getPool() {
    if (!this.poolPromise) {
      this.assertConfigured();
      this.poolPromise = this.connect();
    }
    return this.poolPromise;
  }

  async connect() {
    const module = await this.loadMssql();
    const sql = module.default || module;
    const pool = new sql.ConnectionPool(this.connectionConfig);
    return pool.connect();
  }

  assertConfigured() {
    const missing = ['server', 'database', 'user', 'password'].filter((key) => !this.connectionConfig[key]);
    if (missing.length > 0) {
      throw new Error(`SQL Server data source is missing configuration: ${missing.join(', ')}`);
    }
  }
}

export function createSqlServerRepository(options = {}) {
  const normalized = options?.config || options;
  return new SqlServerFeasibilityRepository(normalized);
}

function buildConceptCatalogSql(meta) {
  const groupSelect = meta.groupColumn ? `, ${meta.groupColumn} AS groupName` : ", '' AS groupName";
  const groupBy = meta.groupColumn ? `, ${meta.groupColumn}` : '';
  return `
    SELECT
      ${meta.codeColumn} AS code,
      ${meta.nameColumn} AS name${groupSelect},
      COUNT(*) AS count
    FROM ${meta.table}
    WHERE ${meta.codeColumn} IS NOT NULL
      AND ${meta.nameColumn} IS NOT NULL
    GROUP BY ${meta.codeColumn}, ${meta.nameColumn}${groupBy}
    ORDER BY ${meta.codeColumn}, ${meta.nameColumn}
  `;
}

function normalizeConcept(row, includeGroupName) {
  return {
    code: row.code,
    name: row.name,
    groupName: includeGroupName ? row.groupName || '' : '',
    count: Number(row.count || 0)
  };
}

function normalizeCountResult(row) {
  const indexEligibleCount = Number(row.indexEligibleCount || 0);
  const demographicCount = Number(row.demographicCount || 0);
  const inclusionCount = Number(row.inclusionCount || 0);
  const finalCount = Number(row.finalCount || 0);
  return {
    totalPatients: Number(row.totalPatients || 0),
    indexEligibleCount,
    excludedCount: Math.max(0, indexEligibleCount - finalCount),
    finalCount,
    included: [],
    rows: [],
    conceptSummary: { diagnosis: [], lab: [], drug: [] },
    attrition: [
      { label: 'Has index event (T0)', count: indexEligibleCount },
      { label: 'After demographic filters', count: demographicCount, removed: Math.max(0, indexEligibleCount - demographicCount) },
      { label: 'After inclusion condition logic', count: inclusionCount, removed: Math.max(0, demographicCount - inclusionCount) },
      { label: 'After exclusion condition logic', count: finalCount, removed: Math.max(0, inclusionCount - finalCount) }
    ]
  };
}
