import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const sqlFile = path.resolve(process.cwd(), 'tests', 'sql-initial-setup.sql');

test('sql initial setup file exists and documents its purpose', async () => {
  const sql = await readFile(sqlFile, 'utf8');

  assert.match(sql, /Initial SQL Server setup script/i);
  assert.match(sql, /Create the clinical tables expected by the current SQL builder/i);
  assert.match(sql, /Create the application tables needed for login, sessions, OTP flows, saved cohorts, and feasibility audit logging/i);
});

test('sql initial setup creates the core clinical tables used by the SQL builder', async () => {
  const sql = await readFile(sqlFile, 'utf8');

  assert.match(sql, /CREATE TABLE dbo\.Patient_Info/i);
  assert.match(sql, /OH_PID VARCHAR\(20\) NOT NULL/i);
  assert.match(sql, /BIRTH_DATE DATE NULL/i);
  assert.match(sql, /SEX VARCHAR\(20\) NULL/i);

  assert.match(sql, /CREATE TABLE dbo\.Diagnosis/i);
  assert.match(sql, /ICD_CODE VARCHAR\(20\) NOT NULL/i);
  assert.match(sql, /VISIT_DATE DATE NOT NULL/i);

  assert.match(sql, /CREATE TABLE dbo\.Laboratory/i);
  assert.match(sql, /LAB_CODE VARCHAR\(30\) NOT NULL/i);
  assert.match(sql, /RESULT_DATE DATE NOT NULL/i);
  assert.match(sql, /LAB_VALUE DECIMAL\(18,4\) NULL/i);
  assert.match(sql, /LAB_NAME VARCHAR\(200\) NOT NULL/i);
  assert.match(sql, /LAB_GROUP_NAME VARCHAR\(100\) NULL/i);

  assert.match(sql, /CREATE TABLE dbo\.Medication/i);
  assert.match(sql, /DRUG_CODE VARCHAR\(30\) NOT NULL/i);
  assert.match(sql, /ORDER_DATE DATE NOT NULL/i);
  assert.match(sql, /DRUG_NAME VARCHAR\(200\) NOT NULL/i);
  assert.match(sql, /DRUG_GROUP_NAME VARCHAR\(200\) NULL/i);
});

test('sql initial setup includes app tables for multi-user backend usage', async () => {
  const sql = await readFile(sqlFile, 'utf8');

  assert.match(sql, /CREATE TABLE dbo\.App_Users/i);
  assert.match(sql, /EMAIL NVARCHAR\(255\) NOT NULL/i);
  assert.match(sql, /PASSWORD_HASH NVARCHAR\(255\) NULL/i);

  assert.match(sql, /CREATE TABLE dbo\.User_Sessions/i);
  assert.match(sql, /SESSION_ID NVARCHAR\(128\) NOT NULL/i);
  assert.match(sql, /EXPIRES_AT DATETIME2\(0\) NOT NULL/i);

  assert.match(sql, /CREATE TABLE dbo\.Pending_Otp/i);
  assert.match(sql, /OTP_PURPOSE NVARCHAR\(30\) NOT NULL/i);
  assert.match(sql, /OTP_HASH NVARCHAR\(255\) NOT NULL/i);

  assert.match(sql, /CREATE TABLE dbo\.Saved_Cohorts/i);
  assert.match(sql, /CONFIG_JSON NVARCHAR\(MAX\) NOT NULL/i);

  assert.match(sql, /CREATE TABLE dbo\.Audit_Session_Log/i);
  assert.match(sql, /RUN_COUNT INT NOT NULL/i);

  assert.match(sql, /CREATE TABLE dbo\.Feasibility_Run_Logs/i);
  assert.match(sql, /\[SQL\] NVARCHAR\(MAX\) NULL/i);

  assert.match(sql, /CREATE TABLE dbo\.Auth_Event_Log/i);
  assert.match(sql, /EVENT_TYPE NVARCHAR\(50\) NOT NULL/i);
});
