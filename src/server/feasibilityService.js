export class FeasibilityService {
  constructor({ dataSource, repository }) {
    this.dataSource = dataSource || repository?.config?.().dataSource || 'json';
    this.repository = repository;
    this.getBootstrap = this.getBootstrap.bind(this);
    this.runFeasibility = this.runFeasibility.bind(this);
    this.run = this.run.bind(this);
  }

  async getBootstrap() {
    const bootstrap = this.repository.getBootstrap
      ? await this.repository.getBootstrap()
      : {};
    return {
      dataSource: this.dataSource,
      ...bootstrap
    };
  }

  async runFeasibility(config) {
    const metadata = this.repository.config ? this.repository.config() : { dataSource: this.dataSource };
    const result = this.repository.runFeasibility
      ? await this.repository.runFeasibility(config)
      : await this.repository.run(config);
    const activeDataSource = metadata.dataSource || this.dataSource;
    return {
      dataSource: activeDataSource,
      metadata,
      result,
      data: result
    };
  }

  async run(config) {
    return this.runFeasibility(config);
  }
}

export function createFeasibilityService(options = {}) {
  const repository = options.repository || options.repo || options;
  const dataSource = options.dataSource || repository?.config?.().dataSource;
  return new FeasibilityService({ dataSource, repository });
}
