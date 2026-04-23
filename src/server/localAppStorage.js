import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export class LocalAppStorage {
  constructor(options = {}) {
    this.root = options.root || process.cwd();
    this.now = options.now || (() => new Date().toISOString());
    this.paths = {
      users: join(this.root, 'data', 'users.json'),
      sessions: join(this.root, 'data', 'user-sessions.json'),
      pendingOtps: join(this.root, 'data', 'pending-otps.json'),
      savedCohorts: join(this.root, 'data', 'saved-cohorts.json'),
      runLogs: join(this.root, 'data', 'feasibility-run-logs.json'),
      auditSessions: join(this.root, 'data', 'audit-session-logs.json')
    };
  }

  config() {
    return { appStorage: 'local' };
  }

  async getUserByEmail(email) {
    const users = await this.readUsers();
    return users.find((user) => user.active !== false && user.email.toLowerCase() === email.toLowerCase()) || null;
  }

  async createUser(user) {
    const users = await this.readUsers();
    const created = {
      id: user.id || `user-${randomUUID()}`,
      email: user.email,
      name: user.name,
      role: user.role || 'researcher',
      provider: user.provider || 'credentials',
      googleSub: user.googleSub || null,
      passwordHash: user.passwordHash || null,
      active: user.active ?? true,
      createdAt: user.createdAt || this.now(),
      passwordUpdatedAt: user.passwordUpdatedAt || null,
      lastLoginAt: user.lastLoginAt || null
    };
    users.push(created);
    await this.writeJson(this.paths.users, users);
    return created;
  }

  async updateUser(user) {
    const users = await this.readUsers();
    const index = users.findIndex((item) => item.id === user.id);
    if (index === -1) return null;
    users[index] = { ...users[index], ...user };
    await this.writeJson(this.paths.users, users);
    return users[index];
  }

  async upsertGoogleUser(profile) {
    const users = await this.readUsers();
    const existing = users.find((user) => user.googleSub === profile.googleSub || user.email.toLowerCase() === profile.email.toLowerCase());
    if (existing) {
      const updated = {
        ...existing,
        name: profile.name,
        email: profile.email,
        googleSub: profile.googleSub,
        provider: 'google',
        lastLoginAt: this.now(),
        active: true
      };
      return this.updateUser(updated);
    }
    return this.createUser({
      email: profile.email,
      name: profile.name,
      googleSub: profile.googleSub,
      provider: 'google',
      role: 'researcher',
      active: true,
      lastLoginAt: this.now()
    });
  }

  async createSession(session) {
    const sessions = await this.readJson(this.paths.sessions);
    sessions.push(session);
    await this.writeJson(this.paths.sessions, sessions);
    return session;
  }

  async getSession(sessionId) {
    const sessions = await this.readJson(this.paths.sessions);
    const session = sessions.find((item) => item.sessionId === sessionId && !item.revokedAt);
    if (!session) return null;
    if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
    const user = await this.getUserById(session.userId);
    if (!user) return null;
    return { ...session, user };
  }

  async deleteSession(sessionId) {
    const sessions = await this.readJson(this.paths.sessions);
    const next = sessions.filter((item) => item.sessionId !== sessionId);
    await this.writeJson(this.paths.sessions, next);
  }

  async createPendingOtp(record) {
    const otps = await this.readJson(this.paths.pendingOtps);
    const next = otps.filter((item) => !(item.purpose === record.purpose && item.email === record.email));
    next.push(record);
    await this.writeJson(this.paths.pendingOtps, next);
    return record;
  }

  async getPendingOtp(purpose, email) {
    const otps = await this.readJson(this.paths.pendingOtps);
    return otps.find((item) => item.purpose === purpose && item.email === email) || null;
  }

  async updatePendingOtp(record) {
    const otps = await this.readJson(this.paths.pendingOtps);
    const next = otps.map((item) => item.purpose === record.purpose && item.email === record.email ? record : item);
    await this.writeJson(this.paths.pendingOtps, next);
  }

  async deletePendingOtp(purpose, email) {
    const otps = await this.readJson(this.paths.pendingOtps);
    const next = otps.filter((item) => !(item.purpose === purpose && item.email === email));
    await this.writeJson(this.paths.pendingOtps, next);
  }

  async touchAuditSession(session) {
    const logs = await this.readJson(this.paths.auditSessions);
    const now = this.now();
    const existing = logs.find((item) => item.id === session.id);
    if (existing) {
      existing.lastSeenAt = now;
      existing.pageViews = Number(existing.pageViews || 0) + 1;
      existing.user = session.user;
      existing.userAgent = session.userAgent;
      await this.writeJson(this.paths.auditSessions, logs);
      return existing;
    }
    const created = {
      id: session.id,
      startedAt: now,
      lastSeenAt: now,
      pageViews: 1,
      runCount: 0,
      user: session.user,
      userAgent: session.userAgent || ''
    };
    logs.unshift(created);
    await this.writeJson(this.paths.auditSessions, logs.slice(0, 200));
    return created;
  }

  async incrementAuditSessionRunCount(sessionId) {
    const logs = await this.readJson(this.paths.auditSessions);
    const session = logs.find((item) => item.id === sessionId);
    if (!session) return;
    session.runCount = Number(session.runCount || 0) + 1;
    session.lastSeenAt = this.now();
    await this.writeJson(this.paths.auditSessions, logs);
  }

  async createRunLog(run) {
    const runs = await this.readJson(this.paths.runLogs);
    runs.unshift(run);
    await this.writeJson(this.paths.runLogs, runs.slice(0, 500));
    await this.incrementAuditSessionRunCount(run.sessionId);
    return run;
  }

  async listRunLogs(userId) {
    const runs = await this.readJson(this.paths.runLogs);
    return runs.filter((run) => !userId || run.user?.id === userId);
  }

  async listAuditSessions(userId) {
    const sessions = await this.readJson(this.paths.auditSessions);
    return sessions.filter((session) => !userId || session.user?.id === userId);
  }

  async clearAuditLogs(userId) {
    const runs = await this.readJson(this.paths.runLogs);
    const sessions = await this.readJson(this.paths.auditSessions);
    await this.writeJson(this.paths.runLogs, runs.filter((run) => run.user?.id !== userId));
    await this.writeJson(this.paths.auditSessions, sessions.filter((session) => session.user?.id !== userId));
  }

  async listSavedCohorts(userId) {
    const cohorts = await this.readJson(this.paths.savedCohorts);
    return cohorts
      .filter((cohort) => cohort.userId === userId)
      .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  }

  async createSavedCohort(cohort) {
    const cohorts = await this.readJson(this.paths.savedCohorts);
    const created = {
      id: cohort.id || randomUUID(),
      userId: cohort.userId,
      name: cohort.name,
      savedAt: cohort.savedAt || this.now(),
      config: cohort.config
    };
    cohorts.unshift(created);
    await this.writeJson(this.paths.savedCohorts, cohorts.slice(0, 200));
    return created;
  }

  async deleteSavedCohort(userId, cohortId) {
    const cohorts = await this.readJson(this.paths.savedCohorts);
    const next = cohorts.filter((cohort) => !(cohort.userId === userId && cohort.id === cohortId));
    await this.writeJson(this.paths.savedCohorts, next);
  }

  async getUserById(userId) {
    const users = await this.readUsers();
    return users.find((user) => user.id === userId && user.active !== false) || null;
  }

  async readUsers() {
    return this.readJson(this.paths.users);
  }

  async readJson(filePath) {
    try {
      const raw = await readFile(filePath, 'utf8');
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async writeJson(filePath, data) {
    await mkdir(join(this.root, 'data'), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  }
}
