import { randomUUID } from 'node:crypto';

export class SqlServerAppStorage {
  constructor(options = {}) {
    this.connectionConfig = options.connectionConfig || options.connection || {};
    this.loadMssql = options.loadMssql || (() => import('mssql'));
    this.poolPromise = null;
    this.sqlPromise = null;
  }

  config() {
    return { appStorage: 'sqlserver' };
  }

  async getUserByEmail(email) {
    const { sql, pool } = await this.getDb();
    const response = await pool.request()
      .input('email', sql.NVarChar(255), email)
      .query(`
        SELECT TOP 1 USER_ID, EMAIL, NAME, ROLE, PROVIDER, GOOGLE_SUB, PASSWORD_HASH, ACTIVE, CREATED_AT, PASSWORD_UPDATED_AT, LAST_LOGIN_AT
        FROM dbo.App_Users
        WHERE LOWER(EMAIL) = LOWER(@email) AND ACTIVE = 1
      `);
    return mapUser(response.recordset[0]);
  }

  async createUser(user) {
    const { sql, pool } = await this.getDb();
    const created = {
      id: user.id || randomUUID(),
      email: user.email,
      name: user.name,
      role: user.role || 'researcher',
      provider: user.provider || 'credentials',
      googleSub: user.googleSub || null,
      passwordHash: user.passwordHash || null,
      active: user.active ?? true
    };
    await pool.request()
      .input('userId', sql.UniqueIdentifier, created.id)
      .input('email', sql.NVarChar(255), created.email)
      .input('name', sql.NVarChar(255), created.name)
      .input('role', sql.NVarChar(50), created.role)
      .input('provider', sql.NVarChar(50), created.provider)
      .input('googleSub', sql.NVarChar(255), created.googleSub)
      .input('passwordHash', sql.NVarChar(255), created.passwordHash)
      .input('active', sql.Bit, created.active ? 1 : 0)
      .query(`
        INSERT INTO dbo.App_Users (USER_ID, EMAIL, PASSWORD_HASH, NAME, PROVIDER, ROLE, GOOGLE_SUB, ACTIVE)
        VALUES (@userId, @email, @passwordHash, @name, @provider, @role, @googleSub, @active)
      `);
    return this.getUserById(created.id);
  }

  async updateUser(user) {
    const { sql, pool } = await this.getDb();
    await pool.request()
      .input('userId', sql.UniqueIdentifier, user.id)
      .input('email', sql.NVarChar(255), user.email)
      .input('name', sql.NVarChar(255), user.name)
      .input('role', sql.NVarChar(50), user.role)
      .input('provider', sql.NVarChar(50), user.provider)
      .input('googleSub', sql.NVarChar(255), user.googleSub || null)
      .input('passwordHash', sql.NVarChar(255), user.passwordHash || null)
      .input('active', sql.Bit, user.active === false ? 0 : 1)
      .input('passwordUpdatedAt', sql.DateTime2, toDateOrNull(user.passwordUpdatedAt))
      .input('lastLoginAt', sql.DateTime2, toDateOrNull(user.lastLoginAt))
      .query(`
        UPDATE dbo.App_Users
        SET EMAIL = @email,
            NAME = @name,
            ROLE = @role,
            PROVIDER = @provider,
            GOOGLE_SUB = @googleSub,
            PASSWORD_HASH = @passwordHash,
            ACTIVE = @active,
            PASSWORD_UPDATED_AT = @passwordUpdatedAt,
            LAST_LOGIN_AT = @lastLoginAt
        WHERE USER_ID = @userId
      `);
    return this.getUserById(user.id);
  }

  async upsertGoogleUser(profile) {
    const existing = await this.getUserByEmail(profile.email);
    if (existing) {
      return this.updateUser({
        ...existing,
        name: profile.name,
        provider: 'google',
        googleSub: profile.googleSub,
        lastLoginAt: new Date().toISOString(),
        active: true
      });
    }
    return this.createUser({
      email: profile.email,
      name: profile.name,
      provider: 'google',
      googleSub: profile.googleSub,
      role: 'researcher',
      active: true,
      lastLoginAt: new Date().toISOString()
    });
  }

  async createSession(session) {
    const { sql, pool } = await this.getDb();
    await pool.request()
      .input('sessionId', sql.NVarChar(128), session.sessionId)
      .input('userId', sql.UniqueIdentifier, session.userId)
      .input('expiresAt', sql.DateTime2, toDateOrNull(session.expiresAt))
      .input('userAgent', sql.NVarChar(512), session.userAgent || null)
      .input('ipAddress', sql.NVarChar(64), session.ipAddress || null)
      .query(`
        INSERT INTO dbo.User_Sessions (SESSION_ID, USER_ID, STARTED_AT, LAST_SEEN_AT, PAGE_VIEWS, RUN_COUNT, USER_AGENT, EXPIRES_AT, REVOKED_AT, IP_ADDRESS)
        VALUES (@sessionId, @userId, SYSUTCDATETIME(), SYSUTCDATETIME(), 0, 0, @userAgent, @expiresAt, NULL, @ipAddress)
      `);
    return session;
  }

  async getSession(sessionId) {
    const { sql, pool } = await this.getDb();
    const response = await pool.request()
      .input('sessionId', sql.NVarChar(128), sessionId)
      .query(`
        SELECT TOP 1 s.SESSION_ID, s.USER_ID, s.STARTED_AT, s.LAST_SEEN_AT, s.EXPIRES_AT, s.REVOKED_AT, s.USER_AGENT, s.IP_ADDRESS,
               u.EMAIL, u.NAME, u.ROLE, u.PROVIDER, u.ACTIVE
        FROM dbo.User_Sessions s
        JOIN dbo.App_Users u ON u.USER_ID = s.USER_ID
        WHERE s.SESSION_ID = @sessionId
          AND s.REVOKED_AT IS NULL
          AND s.EXPIRES_AT > SYSUTCDATETIME()
          AND u.ACTIVE = 1
      `);
    const row = response.recordset[0];
    if (!row) return null;
    return {
      sessionId: row.SESSION_ID,
      userId: row.USER_ID,
      createdAt: row.STARTED_AT?.toISOString?.() || String(row.STARTED_AT),
      lastSeenAt: row.LAST_SEEN_AT?.toISOString?.() || String(row.LAST_SEEN_AT),
      expiresAt: row.EXPIRES_AT?.toISOString?.() || String(row.EXPIRES_AT),
      revokedAt: row.REVOKED_AT?.toISOString?.() || row.REVOKED_AT,
      userAgent: row.USER_AGENT || '',
      ipAddress: row.IP_ADDRESS || '',
      user: {
        id: row.USER_ID,
        email: row.EMAIL,
        name: row.NAME,
        role: row.ROLE,
        provider: row.PROVIDER
      }
    };
  }

  async deleteSession(sessionId) {
    const { sql, pool } = await this.getDb();
    await pool.request()
      .input('sessionId', sql.NVarChar(128), sessionId)
      .query('DELETE FROM dbo.User_Sessions WHERE SESSION_ID = @sessionId');
  }

  async createPendingOtp(record) {
    const { sql, pool } = await this.getDb();
    await this.deletePendingOtp(record.purpose, record.email);
    await pool.request()
      .input('otpId', sql.UniqueIdentifier, randomUUID())
      .input('purpose', sql.NVarChar(30), record.purpose)
      .input('email', sql.NVarChar(255), record.email)
      .input('userId', sql.UniqueIdentifier, record.userId || null)
      .input('otpHash', sql.NVarChar(255), record.otpHash)
      .input('attempts', sql.Int, record.attempts || 0)
      .input('expiresAt', sql.DateTime2, toDateOrNull(record.expiresAt))
      .input('payloadJson', sql.NVarChar(sql.MAX), JSON.stringify(record.payload || {}))
      .query(`
        INSERT INTO dbo.Pending_Otp (OTP_ID, OTP_PURPOSE, EMAIL, USER_ID, OTP_HASH, ATTEMPTS, EXPIRES_AT, CONSUMED_AT, CREATED_AT, PAYLOAD_JSON)
        VALUES (@otpId, @purpose, @email, @userId, @otpHash, @attempts, @expiresAt, NULL, SYSUTCDATETIME(), @payloadJson)
      `);
    return record;
  }

  async getPendingOtp(purpose, email) {
    const { sql, pool } = await this.getDb();
    const response = await pool.request()
      .input('purpose', sql.NVarChar(30), purpose)
      .input('email', sql.NVarChar(255), email)
      .query(`
        SELECT TOP 1 OTP_PURPOSE, EMAIL, USER_ID, OTP_HASH, ATTEMPTS, EXPIRES_AT, CONSUMED_AT, PAYLOAD_JSON
        FROM dbo.Pending_Otp
        WHERE OTP_PURPOSE = @purpose AND LOWER(EMAIL) = LOWER(@email) AND CONSUMED_AT IS NULL
        ORDER BY CREATED_AT DESC
      `);
    const row = response.recordset[0];
    if (!row) return null;
    return {
      purpose: row.OTP_PURPOSE,
      email: row.EMAIL,
      userId: row.USER_ID || null,
      otpHash: row.OTP_HASH,
      attempts: Number(row.ATTEMPTS || 0),
      expiresAt: row.EXPIRES_AT?.toISOString?.() || String(row.EXPIRES_AT),
      consumedAt: row.CONSUMED_AT?.toISOString?.() || row.CONSUMED_AT,
      payload: parseJson(row.PAYLOAD_JSON)
    };
  }

  async updatePendingOtp(record) {
    const { sql, pool } = await this.getDb();
    await pool.request()
      .input('purpose', sql.NVarChar(30), record.purpose)
      .input('email', sql.NVarChar(255), record.email)
      .input('attempts', sql.Int, record.attempts || 0)
      .input('consumedAt', sql.DateTime2, toDateOrNull(record.consumedAt))
      .input('payloadJson', sql.NVarChar(sql.MAX), JSON.stringify(record.payload || {}))
      .query(`
        UPDATE dbo.Pending_Otp
        SET ATTEMPTS = @attempts,
            CONSUMED_AT = @consumedAt,
            PAYLOAD_JSON = @payloadJson
        WHERE OTP_PURPOSE = @purpose AND LOWER(EMAIL) = LOWER(@email) AND CONSUMED_AT IS NULL
      `);
  }

  async deletePendingOtp(purpose, email) {
    const { sql, pool } = await this.getDb();
    await pool.request()
      .input('purpose', sql.NVarChar(30), purpose)
      .input('email', sql.NVarChar(255), email)
      .query('DELETE FROM dbo.Pending_Otp WHERE OTP_PURPOSE = @purpose AND LOWER(EMAIL) = LOWER(@email)');
  }

  async touchAuditSession(session) {
    const { sql, pool } = await this.getDb();
    await pool.request()
      .input('sessionId', sql.NVarChar(128), session.id)
      .input('userId', sql.UniqueIdentifier, session.user?.id || null)
      .input('userAgent', sql.NVarChar(512), session.userAgent || null)
      .query(`
        MERGE dbo.Audit_Session_Log AS target
        USING (SELECT @sessionId AS AUDIT_SESSION_ID) AS source
        ON target.AUDIT_SESSION_ID = source.AUDIT_SESSION_ID
        WHEN MATCHED THEN
          UPDATE SET LAST_SEEN_AT = SYSUTCDATETIME(),
                     PAGE_VIEWS = ISNULL(target.PAGE_VIEWS, 0) + 1,
                     USER_ID = @userId,
                     USER_AGENT = @userAgent
        WHEN NOT MATCHED THEN
          INSERT (AUDIT_SESSION_ID, USER_ID, STARTED_AT, LAST_SEEN_AT, PAGE_VIEWS, RUN_COUNT, USER_AGENT, CREATED_AT)
          VALUES (@sessionId, @userId, SYSUTCDATETIME(), SYSUTCDATETIME(), 1, 0, @userAgent, SYSUTCDATETIME());
      `);
    return this.listAuditSessionById(session.id);
  }

  async incrementAuditSessionRunCount(sessionId) {
    const { sql, pool } = await this.getDb();
    await pool.request()
      .input('sessionId', sql.NVarChar(128), sessionId)
      .query(`
        UPDATE dbo.Audit_Session_Log
        SET RUN_COUNT = ISNULL(RUN_COUNT, 0) + 1,
            LAST_SEEN_AT = SYSUTCDATETIME()
        WHERE AUDIT_SESSION_ID = @sessionId
      `);
  }

  async createRunLog(run) {
    const { sql, pool } = await this.getDb();
    await pool.request()
      .input('runId', sql.UniqueIdentifier, run.id || randomUUID())
      .input('sessionId', sql.NVarChar(128), run.sessionId || null)
      .input('userId', sql.UniqueIdentifier, run.user?.id || null)
      .input('question', sql.NVarChar(1000), run.question || null)
      .input('indexEligibleCount', sql.Int, run.indexEligibleCount || 0)
      .input('finalCount', sql.Int, run.finalCount || 0)
      .input('excludedCount', sql.Int, run.excludedCount || 0)
      .input('attrition', sql.NVarChar(sql.MAX), JSON.stringify(run.attrition || []))
      .input('selectedConcepts', sql.NVarChar(sql.MAX), JSON.stringify(run.selectedConcepts || {}))
      .input('config', sql.NVarChar(sql.MAX), JSON.stringify(run.config || {}))
      .input('sqlText', sql.NVarChar(sql.MAX), run.sql || null)
      .input('dataSource', sql.NVarChar(50), run.dataSource || 'json')
      .query(`
        INSERT INTO dbo.Feasibility_Run_Logs (RUN_ID, SESSION_ID, USER_ID, CREATED_AT, QUESTION, INDEX_ELIGIBLE_COUNT, FINAL_COUNT, EXCLUDED_COUNT, ATTRITION, SELECTED_CONCEPTS, CONFIG, [SQL], DATA_SOURCE)
        VALUES (@runId, @sessionId, @userId, SYSUTCDATETIME(), @question, @indexEligibleCount, @finalCount, @excludedCount, @attrition, @selectedConcepts, @config, @sqlText, @dataSource)
      `);
    await this.incrementAuditSessionRunCount(run.sessionId);
    return run;
  }

  async listRunLogs(userId) {
    const { sql, pool } = await this.getDb();
    const response = await pool.request()
      .input('userId', sql.UniqueIdentifier, userId || null)
      .query(`
        SELECT r.RUN_ID, r.SESSION_ID, r.USER_ID, r.CREATED_AT, r.QUESTION, r.INDEX_ELIGIBLE_COUNT, r.FINAL_COUNT, r.EXCLUDED_COUNT, r.ATTRITION, r.SELECTED_CONCEPTS, r.CONFIG, r.[SQL], r.DATA_SOURCE,
               u.EMAIL AS USER_EMAIL, u.NAME AS USER_NAME, u.PROVIDER AS USER_PROVIDER, u.ROLE AS USER_ROLE
        FROM dbo.Feasibility_Run_Logs r
        LEFT JOIN dbo.App_Users u ON u.USER_ID = r.USER_ID
        WHERE @userId IS NULL OR USER_ID = @userId
        ORDER BY r.CREATED_AT DESC
      `);
    return response.recordset.map(mapRunLog);
  }

  async listAuditSessions(userId) {
    const { sql, pool } = await this.getDb();
    const response = await pool.request()
      .input('userId', sql.UniqueIdentifier, userId || null)
      .query(`
        SELECT s.AUDIT_SESSION_ID, s.USER_ID, s.STARTED_AT, s.LAST_SEEN_AT, s.PAGE_VIEWS, s.RUN_COUNT, s.USER_AGENT,
               u.EMAIL AS USER_EMAIL, u.NAME AS USER_NAME, u.PROVIDER AS USER_PROVIDER, u.ROLE AS USER_ROLE
        FROM dbo.Audit_Session_Log s
        LEFT JOIN dbo.App_Users u ON u.USER_ID = s.USER_ID
        WHERE @userId IS NULL OR s.USER_ID = @userId
        ORDER BY s.LAST_SEEN_AT DESC
      `);
    return response.recordset.map((row) => ({
      id: row.AUDIT_SESSION_ID,
      startedAt: row.STARTED_AT?.toISOString?.() || String(row.STARTED_AT),
      lastSeenAt: row.LAST_SEEN_AT?.toISOString?.() || String(row.LAST_SEEN_AT),
      pageViews: Number(row.PAGE_VIEWS || 0),
      runCount: Number(row.RUN_COUNT || 0),
      userAgent: row.USER_AGENT || '',
      user: row.USER_ID ? {
        id: row.USER_ID,
        email: row.USER_EMAIL,
        name: row.USER_NAME,
        provider: row.USER_PROVIDER,
        role: row.USER_ROLE
      } : null
    }));
  }

  async clearAuditLogs(userId) {
    const { sql, pool } = await this.getDb();
    await pool.request()
      .input('userId', sql.UniqueIdentifier, userId || null)
      .query(`
        DELETE FROM dbo.Feasibility_Run_Logs WHERE USER_ID = @userId;
        DELETE FROM dbo.Audit_Session_Log WHERE USER_ID = @userId;
      `);
  }

  async listSavedCohorts(userId) {
    const { sql, pool } = await this.getDb();
    const response = await pool.request()
      .input('userId', sql.UniqueIdentifier, userId)
      .query(`
        SELECT COHORT_ID, USER_ID, NAME, QUESTION, CONFIG_JSON, CREATED_AT, UPDATED_AT
        FROM dbo.Saved_Cohorts
        WHERE USER_ID = @userId AND DELETED_AT IS NULL
        ORDER BY UPDATED_AT DESC
      `);
    return response.recordset.map((row) => ({
      id: row.COHORT_ID,
      userId: row.USER_ID,
      name: row.NAME,
      savedAt: row.UPDATED_AT?.toISOString?.() || row.CREATED_AT?.toISOString?.() || String(row.CREATED_AT),
      config: parseJson(row.CONFIG_JSON),
      question: row.QUESTION || ''
    }));
  }

  async createSavedCohort(cohort) {
    const { sql, pool } = await this.getDb();
    const id = cohort.id || randomUUID();
    await pool.request()
      .input('cohortId', sql.UniqueIdentifier, id)
      .input('userId', sql.UniqueIdentifier, cohort.userId)
      .input('name', sql.NVarChar(200), cohort.name)
      .input('question', sql.NVarChar(1000), cohort.config?.question || cohort.question || null)
      .input('configJson', sql.NVarChar(sql.MAX), JSON.stringify(cohort.config || {}))
      .query(`
        INSERT INTO dbo.Saved_Cohorts (COHORT_ID, USER_ID, NAME, CONFIG_JSON, QUESTION, CREATED_AT, UPDATED_AT, DELETED_AT)
        VALUES (@cohortId, @userId, @name, @configJson, @question, SYSUTCDATETIME(), SYSUTCDATETIME(), NULL)
      `);
    return {
      id,
      userId: cohort.userId,
      name: cohort.name,
      savedAt: new Date().toISOString(),
      config: cohort.config
    };
  }

  async deleteSavedCohort(userId, cohortId) {
    const { sql, pool } = await this.getDb();
    await pool.request()
      .input('userId', sql.UniqueIdentifier, userId)
      .input('cohortId', sql.UniqueIdentifier, cohortId)
      .query(`
        DELETE FROM dbo.Saved_Cohorts
        WHERE USER_ID = @userId AND COHORT_ID = @cohortId
      `);
  }

  async getUserById(userId) {
    const { sql, pool } = await this.getDb();
    const response = await pool.request()
      .input('userId', sql.UniqueIdentifier, userId)
      .query(`
        SELECT TOP 1 USER_ID, EMAIL, NAME, ROLE, PROVIDER, GOOGLE_SUB, PASSWORD_HASH, ACTIVE, CREATED_AT, PASSWORD_UPDATED_AT, LAST_LOGIN_AT
        FROM dbo.App_Users
        WHERE USER_ID = @userId AND ACTIVE = 1
      `);
    return mapUser(response.recordset[0]);
  }

  async listAuditSessionById(sessionId) {
    const { sql, pool } = await this.getDb();
    const response = await pool.request()
      .input('sessionId', sql.NVarChar(128), sessionId)
      .query(`
        SELECT TOP 1 s.AUDIT_SESSION_ID, s.USER_ID, s.STARTED_AT, s.LAST_SEEN_AT, s.PAGE_VIEWS, s.RUN_COUNT, s.USER_AGENT,
                     u.EMAIL AS USER_EMAIL, u.NAME AS USER_NAME, u.PROVIDER AS USER_PROVIDER, u.ROLE AS USER_ROLE
        FROM dbo.Audit_Session_Log s
        LEFT JOIN dbo.App_Users u ON u.USER_ID = s.USER_ID
        WHERE s.AUDIT_SESSION_ID = @sessionId
      `);
    const row = response.recordset[0];
    if (!row) return null;
    return {
      id: row.AUDIT_SESSION_ID,
      startedAt: row.STARTED_AT?.toISOString?.() || String(row.STARTED_AT),
      lastSeenAt: row.LAST_SEEN_AT?.toISOString?.() || String(row.LAST_SEEN_AT),
      pageViews: Number(row.PAGE_VIEWS || 0),
      runCount: Number(row.RUN_COUNT || 0),
      userAgent: row.USER_AGENT || '',
      user: row.USER_ID ? {
        id: row.USER_ID,
        email: row.USER_EMAIL,
        name: row.USER_NAME,
        provider: row.USER_PROVIDER,
        role: row.USER_ROLE
      } : null
    };
  }

  async getDb() {
    if (!this.sqlPromise) {
      this.sqlPromise = this.loadMssql().then((module) => module.default || module);
    }
    if (!this.poolPromise) {
      this.assertConfigured();
      this.poolPromise = this.sqlPromise.then((sql) => new sql.ConnectionPool(this.connectionConfig).connect());
    }
    const [sql, pool] = await Promise.all([this.sqlPromise, this.poolPromise]);
    return { sql, pool };
  }

  assertConfigured() {
    const missing = ['server', 'database', 'user', 'password'].filter((key) => !this.connectionConfig[key]);
    if (missing.length > 0) {
      throw new Error(`SQL Server app storage is missing configuration: ${missing.join(', ')}`);
    }
  }
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.USER_ID,
    email: row.EMAIL,
    name: row.NAME,
    role: row.ROLE,
    provider: row.PROVIDER,
    googleSub: row.GOOGLE_SUB,
    passwordHash: row.PASSWORD_HASH,
    active: row.ACTIVE,
    createdAt: row.CREATED_AT?.toISOString?.() || row.CREATED_AT,
    passwordUpdatedAt: row.PASSWORD_UPDATED_AT?.toISOString?.() || row.PASSWORD_UPDATED_AT,
    lastLoginAt: row.LAST_LOGIN_AT?.toISOString?.() || row.LAST_LOGIN_AT
  };
}

function mapRunLog(row) {
  return {
    id: row.RUN_ID,
    sessionId: row.SESSION_ID,
    user: row.USER_ID ? {
      id: row.USER_ID,
      email: row.USER_EMAIL,
      name: row.USER_NAME,
      provider: row.USER_PROVIDER,
      role: row.USER_ROLE
    } : null,
    createdAt: row.CREATED_AT?.toISOString?.() || String(row.CREATED_AT),
    question: row.QUESTION || '',
    indexEligibleCount: Number(row.INDEX_ELIGIBLE_COUNT || 0),
    finalCount: Number(row.FINAL_COUNT || 0),
    excludedCount: Number(row.EXCLUDED_COUNT || 0),
    attrition: parseJson(row.ATTRITION),
    selectedConcepts: parseJson(row.SELECTED_CONCEPTS),
    config: parseJson(row.CONFIG),
    sql: row.SQL || row['SQL'] || null,
    dataSource: row.DATA_SOURCE || 'json'
  };
}

function parseJson(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function toDateOrNull(value) {
  return value ? new Date(value) : null;
}
