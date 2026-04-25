export function filterDictionaryEntries(conceptCatalog = {}, options = {}) {
  const domain = normalizeDomain(options.domain);
  const query = String(options.query || '').trim().toLowerCase();
  const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 250;
  const domains = domain === 'all' ? ['diagnosis', 'lab', 'drug'] : [domain];

  return domains.flatMap((currentDomain) => {
    const entries = Array.isArray(conceptCatalog[currentDomain]) ? conceptCatalog[currentDomain] : [];
    return entries
      .filter((entry) => matchesEntry(entry, query))
      .slice(0, limit)
      .map((entry) => ({
        domain: currentDomain,
        code: entry.code || '',
        name: entry.name || '',
        groupName: entry.groupName || '',
        count: Number(entry.count || 0)
      }));
  });
}

export function dictionaryStats(conceptCatalog = {}) {
  const counts = {
    diagnosis: countEntries(conceptCatalog.diagnosis),
    lab: countEntries(conceptCatalog.lab),
    drug: countEntries(conceptCatalog.drug)
  };
  return {
    ...counts,
    all: counts.diagnosis + counts.lab + counts.drug
  };
}

function normalizeDomain(domain) {
  return ['diagnosis', 'lab', 'drug'].includes(domain) ? domain : 'all';
}

function matchesEntry(entry = {}, query = '') {
  if (!query) return true;
  const haystack = [
    entry.code,
    entry.name,
    entry.groupName,
    String(entry.count || '')
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return query.split(/\s+/).every((part) => haystack.includes(part));
}

function countEntries(entries) {
  return Array.isArray(entries) ? entries.length : 0;
}
