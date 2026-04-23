export function buildConceptCatalog(data) {
  return {
    diagnosis: summarizeDomainConcepts(data.diagnosis_record || [], 'icd_code', 'disease_name'),
    lab: summarizeDomainConcepts(data.lab_result || [], 'test_code', 'test_name', 'test_group_name'),
    drug: summarizeDomainConcepts(data.prescription_order || [], 'drug_code', 'drug_name', 'drug_group_name')
  };
}

function summarizeDomainConcepts(rows, codeKey, nameKey, groupKey) {
  const concepts = new Map();
  for (const row of rows) {
    const concept = {
      code: row[codeKey],
      name: row[nameKey],
      groupName: groupKey ? row[groupKey] : '',
      count: 1
    };
    const key = encodeConcept(concept);
    if (concepts.has(key)) {
      concepts.get(key).count += 1;
    } else {
      concepts.set(key, concept);
    }
  }
  return [...concepts.values()].sort((a, b) => a.code.localeCompare(b.code));
}

function encodeConcept(concept) {
  return `${concept.code || ''}\u001f${concept.name || ''}\u001f${concept.groupName || ''}`;
}
