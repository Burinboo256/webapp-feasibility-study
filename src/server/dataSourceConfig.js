const SUPPORTED_DATA_SOURCES = new Set(['json', 'sqlserver']);

export function normalizeDataSource(value) {
  const normalized = String(value || 'json').trim().toLowerCase();
  if (SUPPORTED_DATA_SOURCES.has(normalized)) return normalized;
  throw new Error(`Unsupported DATA_SOURCE "${value}". Use "json" or "sqlserver".`);
}
