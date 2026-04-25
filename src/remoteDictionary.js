export const REMOTE_DICTIONARY_SOURCES = Object.freeze([
  {
    key: 'icd10',
    domain: 'diagnosis',
    label: 'ICD-10',
    sheetId: '1LUkz2iFHE34DK2MLXuZl5EXvWgn3Xikl',
    gid: '582609863',
    link: 'https://docs.google.com/spreadsheets/d/1LUkz2iFHE34DK2MLXuZl5EXvWgn3Xikl/edit?gid=582609863#gid=582609863'
  },
  {
    key: 'icd9',
    domain: 'diagnosis',
    label: 'ICD-9',
    sheetId: '1P1BlnGh2O972UX5D3xHDC6L6RqyTDNn9',
    gid: '1234208350',
    link: 'https://docs.google.com/spreadsheets/d/1P1BlnGh2O972UX5D3xHDC6L6RqyTDNn9/edit?gid=1234208350#gid=1234208350'
  },
  {
    key: 'lab',
    domain: 'lab',
    label: 'Lab',
    sheetId: '1hIld3JpJ4JfsCElOoxBsfsODlQD8z5O_',
    gid: '201536504',
    link: 'https://docs.google.com/spreadsheets/d/1hIld3JpJ4JfsCElOoxBsfsODlQD8z5O_/edit?gid=201536504#gid=201536504'
  },
  {
    key: 'drug',
    domain: 'drug',
    label: 'Drug',
    sheetId: '1dH-J71VZFE9YV8gSxbH-nqdc2rXRmJXx',
    gid: '959152876',
    link: 'https://docs.google.com/spreadsheets/d/1dH-J71VZFE9YV8gSxbH-nqdc2rXRmJXx/edit?gid=959152876#gid=959152876'
  }
]);

export async function fetchRemoteDictionary({ fetchImpl = globalThis.fetch } = {}) {
  const entries = await Promise.all(REMOTE_DICTIONARY_SOURCES.map(async (source) => {
    const response = await fetchImpl(googleSheetCsvUrl(source), {
      headers: { accept: 'text/csv,text/plain;q=0.9,*/*;q=0.1' }
    });
    if (!response.ok) {
      throw new Error(`Unable to fetch ${source.label} dictionary source.`);
    }
    const csv = await response.text();
    return normalizeSourceRows(source, parseCsv(csv));
  }));

  return {
    conceptCatalog: {
      diagnosis: mergeEntries([...entries[0], ...entries[1]]),
      lab: mergeEntries(entries[2]),
      drug: mergeEntries(entries[3])
    },
    sources: REMOTE_DICTIONARY_SOURCES.map((source) => ({
      key: source.key,
      domain: source.domain,
      label: source.label,
      link: source.link
    }))
  };
}

export function googleSheetCsvUrl(source) {
  return `https://docs.google.com/spreadsheets/d/${source.sheetId}/export?format=csv&gid=${source.gid}`;
}

export function parseCsv(csvText = '') {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const next = csvText[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ',') {
      row.push(value);
      value = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(value);
      if (row.some((cell) => String(cell).trim() !== '')) {
        rows.push(row);
      }
      row = [];
      value = '';
      continue;
    }

    value += char;
  }

  if (value !== '' || row.length > 0) {
    row.push(value);
    if (row.some((cell) => String(cell).trim() !== '')) {
      rows.push(row);
    }
  }

  if (rows.length === 0) return [];
  const headers = rows[0].map((cell) => sanitizeHeader(cell));
  return rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])));
}

export function normalizeSourceRows(source, rows = []) {
  switch (source.key) {
    case 'icd10':
      return rows.map((row) => ({
        code: cleanupValue(row.icd_code),
        name: cleanupValue(row.disease_name),
        groupName: 'ICD-10',
        count: null
      })).filter(isValidEntry);
    case 'icd9':
      return rows.map((row) => ({
        code: cleanupValue(row.icdcm_code),
        name: cleanupValue(row.icdcm_desc),
        groupName: 'ICD-9',
        count: null
      })).filter(isValidEntry);
    case 'lab':
      return rows.map((row) => {
        const parsed = parseLabelValue(row.lab_code);
        return {
          code: parsed.code,
          name: parsed.name,
          groupName: cleanupValue(row.group_name),
          count: null
        };
      }).filter(isValidEntry);
    case 'drug':
      return rows.map((row) => ({
        code: cleanupValue(row.generic_id),
        name: cleanupValue(row.generic_name),
        groupName: [cleanupValue(row.nlem_cls1), cleanupValue(row.nlem_cls2)].filter(Boolean).join(' / '),
        count: numberOrNull(row.number_of_drugs)
      })).filter(isValidEntry);
    default:
      return [];
  }
}

function mergeEntries(entries) {
  const merged = new Map();
  for (const entry of entries) {
    const key = `${entry.code}\u001f${entry.name}\u001f${entry.groupName}`;
    if (!merged.has(key)) {
      merged.set(key, {
        code: entry.code,
        name: entry.name,
        groupName: entry.groupName,
        count: entry.count
      });
      continue;
    }
    const current = merged.get(key);
    if (current.count === null && entry.count !== null) current.count = entry.count;
  }
  return [...merged.values()].sort((a, b) => (
    a.code.localeCompare(b.code) ||
    a.name.localeCompare(b.name)
  ));
}

function sanitizeHeader(value) {
  return cleanupValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function cleanupValue(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseLabelValue(value) {
  const cleaned = cleanupValue(value);
  const match = cleaned.match(/^\(([^)]+)\)\s*(.+)$/);
  if (match) {
    return {
      code: cleanupValue(match[1]),
      name: cleanupValue(match[2])
    };
  }
  return {
    code: cleaned,
    name: cleaned
  };
}

function isValidEntry(entry) {
  return Boolean(entry.code || entry.name);
}

function numberOrNull(value) {
  const number = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) ? number : null;
}
