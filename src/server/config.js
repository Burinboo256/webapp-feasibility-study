import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { normalizeDataSource } from './dataSourceConfig.js';

export async function loadServerConfig(options = {}) {
  const normalized = normalizeLoadOptions(options);
  const configPath = normalized.configPath || join(normalized.root, 'config', 'app.config.json');
  const fileConfig = JSON.parse(await readFile(configPath, 'utf8'));
  const config = applyEnvOverrides(fileConfig, normalized.env);
  const redirectUri = config.auth.google.redirectUri || defaultGoogleRedirectUri(config.server.host, config.server.port);

  return {
    configPath,
    server: {
      host: String(config.server.host || '127.0.0.1'),
      port: Number(config.server.port || 4173),
      cookieSecure: Boolean(config.server.cookieSecure)
    },
    auth: {
      session: {
        cookieName: String(config.auth.session.cookieName || 'cohort_lens_session'),
        maxAgeSeconds: Number(config.auth.session.maxAgeSeconds || 60 * 60 * 8)
      },
      oauthState: {
        cookieName: String(config.auth.oauthState.cookieName || 'cohort_lens_oauth_state'),
        maxAgeSeconds: Number(config.auth.oauthState.maxAgeSeconds || 600)
      },
      otp: {
        ttlMinutes: Number(config.auth.otp.ttlMinutes || 10),
        maxAttempts: Number(config.auth.otp.maxAttempts || 5)
      },
      google: {
        clientId: String(config.auth.google.clientId || ''),
        clientSecret: String(config.auth.google.clientSecret || ''),
        redirectUri,
        allowedEmails: normalizeEmailList(config.auth.google.allowedEmails)
      }
    },
    smtp: {
      host: String(config.smtp.host || ''),
      port: Number(config.smtp.port || 587),
      secure: Boolean(config.smtp.secure),
      user: String(config.smtp.user || ''),
      pass: String(config.smtp.pass || ''),
      from: String(config.smtp.from || config.smtp.user || '')
    },
    clinicalDataSource: normalizeDataSource(config.clinicalDataSource || config.dataSource),
    dataSource: normalizeDataSource(config.clinicalDataSource || config.dataSource),
    appStorage: normalizeAppStorage(config.appStorage),
    sqlServer: {
      server: String(config.sqlServer.server || '').trim(),
      port: Number(config.sqlServer.port || 1433),
      database: String(config.sqlServer.database || '').trim(),
      user: String(config.sqlServer.user || '').trim(),
      password: String(config.sqlServer.password || ''),
      options: {
        encrypt: config.sqlServer.options?.encrypt !== false,
        trustServerCertificate: config.sqlServer.options?.trustServerCertificate === true
      }
    }
  };
}

function normalizeLoadOptions(options) {
  if (isEnvOnlyShape(options)) {
    return {
      env: options,
      root: process.cwd(),
      configPath: null
    };
  }

  return {
    env: options.env || process.env,
    root: options.root || resolve(process.cwd()),
    configPath: options.configPath || null
  };
}

function isEnvOnlyShape(options) {
  if (!options || Array.isArray(options) || typeof options !== 'object') return false;
  const keys = Object.keys(options);
  if (keys.length === 0) return false;
  return !('env' in options) && !('root' in options) && !('configPath' in options);
}

function applyEnvOverrides(fileConfig, env) {
  return {
    ...fileConfig,
    server: {
      ...fileConfig.server,
      host: readString(env.HOST, fileConfig.server?.host),
      port: readNumber(env.PORT, fileConfig.server?.port),
      cookieSecure: readBoolean(env.COOKIE_SECURE, fileConfig.server?.cookieSecure)
    },
    auth: {
      ...fileConfig.auth,
      google: {
        ...fileConfig.auth?.google,
        clientId: readString(env.GOOGLE_CLIENT_ID, fileConfig.auth?.google?.clientId),
        clientSecret: readString(env.GOOGLE_CLIENT_SECRET, fileConfig.auth?.google?.clientSecret),
        redirectUri: readString(env.GOOGLE_REDIRECT_URI, fileConfig.auth?.google?.redirectUri),
        allowedEmails: env.GOOGLE_ALLOWED_EMAILS !== undefined
          ? String(env.GOOGLE_ALLOWED_EMAILS).split(',').map((email) => email.trim()).filter(Boolean)
          : fileConfig.auth?.google?.allowedEmails
      },
      otp: {
        ...fileConfig.auth?.otp
      },
      session: {
        ...fileConfig.auth?.session
      },
      oauthState: {
        ...fileConfig.auth?.oauthState
      }
    },
    smtp: {
      ...fileConfig.smtp,
      host: readString(env.SMTP_HOST, fileConfig.smtp?.host),
      port: readNumber(env.SMTP_PORT, fileConfig.smtp?.port),
      secure: readBoolean(env.SMTP_SECURE, fileConfig.smtp?.secure),
      user: readString(env.SMTP_USER, fileConfig.smtp?.user),
      pass: readString(env.SMTP_PASS, fileConfig.smtp?.pass),
      from: readString(env.SMTP_FROM, fileConfig.smtp?.from)
    },
    clinicalDataSource: readString(
      env.CLINICAL_DATA_SOURCE ?? env.DATA_SOURCE,
      fileConfig.clinicalDataSource ?? fileConfig.dataSource
    ),
    appStorage: readString(env.APP_STORAGE, fileConfig.appStorage),
    sqlServer: {
      ...fileConfig.sqlServer,
      server: readString(env.SQLSERVER_HOST, fileConfig.sqlServer?.server),
      port: readNumber(env.SQLSERVER_PORT, fileConfig.sqlServer?.port),
      database: readString(env.SQLSERVER_DATABASE, fileConfig.sqlServer?.database),
      user: readString(env.SQLSERVER_USER, fileConfig.sqlServer?.user),
      password: readString(env.SQLSERVER_PASSWORD, fileConfig.sqlServer?.password),
      options: {
        ...(fileConfig.sqlServer?.options || {}),
        encrypt: readBoolean(env.SQLSERVER_ENCRYPT, fileConfig.sqlServer?.options?.encrypt),
        trustServerCertificate: readBoolean(
          env.SQLSERVER_TRUST_SERVER_CERTIFICATE,
          fileConfig.sqlServer?.options?.trustServerCertificate
        )
      }
    }
  };
}

function normalizeAppStorage(value) {
  const normalized = String(value || 'local').trim().toLowerCase();
  if (['local', 'sqlserver'].includes(normalized)) return normalized;
  throw new Error(`Unsupported APP_STORAGE "${value}". Use "local" or "sqlserver".`);
}

function normalizeEmailList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((email) => String(email).trim().toLowerCase()).filter(Boolean);
}

function defaultGoogleRedirectUri(host, port) {
  return `http://${host}:${port}/api/auth/google/callback`;
}

function readString(value, fallback) {
  return value === undefined ? fallback : String(value);
}

function readNumber(value, fallback) {
  return value === undefined ? fallback : Number(value);
}

function readBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
}
