-- RRR Production ERP - Batch 2 finishing migration
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS record_expectations (
  MODULE TEXT NOT NULL,
  RECORD_ID TEXT NOT NULL,
  EXPECTED_DATE TEXT,
  NOTE TEXT,
  UPDATED_BY TEXT,
  UPDATED_AT TEXT,
  PRIMARY KEY(MODULE,RECORD_ID)
);

CREATE INDEX IF NOT EXISTS idx_expectation_due
ON record_expectations(MODULE,EXPECTED_DATE);

CREATE INDEX IF NOT EXISTS idx_raw_inward_date
ON raw_inward(INWARD_DATE);

CREATE INDEX IF NOT EXISTS idx_dye_issue_date
ON dye_jobs(ISSUE_DATE);

CREATE INDEX IF NOT EXISTS idx_prod_plan_date
ON production_batches(PLAN_DATE);

CREATE INDEX IF NOT EXISTS idx_stitch_issue_date
ON stitching_jobs(ISSUE_DATE);

CREATE INDEX IF NOT EXISTS idx_qc_date
ON qc_events(QC_DATE);

CREATE INDEX IF NOT EXISTS idx_handover_date
ON warehouse_handover(HANDOVER_DATE);

CREATE INDEX IF NOT EXISTS idx_audit_module_record
ON audit_log(MODULE,RECORD_ID,TIMESTAMP);

CREATE INDEX IF NOT EXISTS idx_errors_module_time
ON app_errors(MODULE,TIMESTAMP);
