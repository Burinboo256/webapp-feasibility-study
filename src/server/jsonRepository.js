import { JsonFeasibilityRepository } from './jsonFeasibilityRepository.js';

export function createJsonRepository(options = {}) {
  const normalized = typeof options === 'string'
    ? { root: options }
    : { root: options.rootDir || options.baseDir || options.root };
  return new JsonFeasibilityRepository(normalized);
}
