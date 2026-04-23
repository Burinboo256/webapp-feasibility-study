import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { evaluateCohort } from '../cohortEngine.js';
import { buildConceptCatalog } from '../conceptCatalog.js';

export class JsonFeasibilityRepository {
  constructor(options = {}) {
    this.root = options.root || process.cwd();
    this.readFile = options.readFile || readFile;
    this.access = options.access || access;
    this.dataPromise = null;
    this.getBootstrap = this.getBootstrap.bind(this);
    this.runFeasibility = this.runFeasibility.bind(this);
    this.config = this.config.bind(this);
    this.run = this.run.bind(this);
    this.loadData = this.loadData.bind(this);
    this.loadSyntheticClinicalData = this.loadSyntheticClinicalData.bind(this);
  }

  async getBootstrap() {
    const data = await this.loadData();
    return {
      conceptCatalog: buildConceptCatalog(data)
    };
  }

  async runFeasibility(config) {
    const data = await this.loadData();
    return evaluateCohort(config, data);
  }

  config() {
    return { dataSource: 'json' };
  }

  async run(config) {
    return this.runFeasibility(config);
  }

  async loadSyntheticClinicalData() {
    return this.loadData();
  }

  async loadData() {
    if (!this.dataPromise) {
      this.dataPromise = this.readDataFile();
    }
    return this.dataPromise;
  }

  async readDataFile() {
    const filePath = await resolveSyntheticDataPath({
      root: this.root,
      access: this.access
    });
    const raw = await this.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  }
}

export async function resolveSyntheticDataPath({ root, access = defaultAccess }) {
  const candidates = [
    join(root, 'public', 'data', 'synthetic-clinical-data.json'),
    join(root, 'public', 'data', 'synthetic-clinical-data_example.json')
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error('Unable to locate a synthetic data file in public/data/.');
}

async function defaultAccess(path) {
  await access(path);
}
