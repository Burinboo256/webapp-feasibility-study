import { FeasibilityService } from './feasibilityService.js';
import { JsonFeasibilityRepository } from './jsonFeasibilityRepository.js';
import { SqlServerFeasibilityRepository } from './sqlServerFeasibilityRepository.js';
import { normalizeDataSource } from './dataSourceConfig.js';

export function createFeasibilityService(options = {}) {
  const runtimeConfig = normalizeRuntimeConfig(options);
  const repository = options.repository || createRepository(runtimeConfig, options);
  return new FeasibilityService({
    dataSource: runtimeConfig.dataSource,
    repository
  });
}

function createRepository(runtimeConfig, options) {
  if (runtimeConfig.dataSource === 'sqlserver') {
    return new SqlServerFeasibilityRepository({
      connectionConfig: runtimeConfig.sqlServer,
      loadMssql: options.loadMssql
    });
  }

  return new JsonFeasibilityRepository({
    root: options.root
  });
}

function normalizeRuntimeConfig(options) {
  if (options.config) {
    return {
      dataSource: normalizeDataSource(options.config.clinicalDataSource || options.config.dataSource),
      sqlServer: options.config.sqlServer || {}
    };
  }

  return {
    dataSource: normalizeDataSource(options.dataSource || 'json'),
    sqlServer: options.sqlServer || {}
  };
}
