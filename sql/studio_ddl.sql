CREATE SCHEMA IF NOT EXISTS {cat}.{studio} COMMENT 'Migration Studio: app state (append-only) + read views';

CREATE VOLUME IF NOT EXISTS {cat}.{studio}.pack COMMENT 'Engagement pack (pack.json + files). Read by the app.';

CREATE VOLUME IF NOT EXISTS {cat}.{studio}.exports COMMENT 'Team evidence exports written by the app.';

CREATE TABLE IF NOT EXISTS {cat}.{studio}.entries (
  id STRING NOT NULL, ts TIMESTAMP, team_id STRING, user_email STRING, kind STRING, entry_key STRING,
  payload STRING, deleted BOOLEAN)
COMMENT 'Append-only register rows (roster, lineage, rules, classifications, answers, agenda, progress). Latest per (team, kind, entry_key) wins.';

CREATE TABLE IF NOT EXISTS {cat}.{studio}.events (
  id STRING NOT NULL, ts TIMESTAMP, team_id STRING, user_email STRING, event_type STRING, task_id STRING, payload STRING)
COMMENT 'Append-only audit and timing events.';

CREATE TABLE IF NOT EXISTS {cat}.{studio}.requests (
  id STRING NOT NULL, ts TIMESTAMP, team_id STRING, user_email STRING, run_label STRING, job_key STRING,
  job_run_id BIGINT, kind STRING, params STRING)
COMMENT 'One row per job trigger from the app (recheck / prove). Results are found by run_label.';

CREATE OR REPLACE VIEW {cat}.{studio}.latest_entries
COMMENT 'Latest row per (team_id, kind, entry_key); deleted rows removed.' AS
SELECT id, ts, team_id, user_email, kind, entry_key, payload FROM (
  SELECT *, row_number() OVER (PARTITION BY team_id, kind, entry_key ORDER BY ts DESC, id DESC) AS rn
  FROM {cat}.{studio}.entries)
WHERE rn = 1 AND NOT coalesce(deleted, false);

CREATE OR REPLACE VIEW {cat}.{studio}.v_classifications
COMMENT 'Task 3: how each non-PASS check was classified, per team (latest).' AS
SELECT team_id, entry_key AS check_name, payload:class::string AS classification, payload:owner::string AS owner,
       payload:evidence::string AS evidence, payload:run_label::string AS run_label, user_email AS saved_by, ts AS saved_at
FROM {cat}.{studio}.latest_entries WHERE kind = 'classification';

CREATE OR REPLACE VIEW {cat}.{studio}.v_rule_decisions
COMMENT 'Task 1: agreed definition of correct, per team and rule (latest).' AS
SELECT team_id, entry_key AS rule_id, payload:status::string AS status, payload:owner::string AS business_owner,
       payload:signoff::string AS signed_off_by, payload:note::string AS note, user_email AS saved_by, ts AS saved_at
FROM {cat}.{studio}.latest_entries WHERE kind = 'rule_decision';

CREATE OR REPLACE VIEW {cat}.{studio}.v_lineage_rows
COMMENT 'Task 1: lineage worksheet rows, per team (latest).' AS
SELECT team_id, entry_key AS row_id, payload:step::string AS step, payload:source::string AS source,
       payload:logic::string AS logic, payload:target::string AS target, payload:file::string AS cited_file,
       coalesce(payload:verified::boolean, false) AS verified, user_email AS saved_by, ts AS saved_at
FROM {cat}.{studio}.latest_entries WHERE kind = 'lineage_row';

CREATE OR REPLACE VIEW {cat}.{studio}.v_question_answers
COMMENT 'Open questions register: answers and status, per team (latest).' AS
SELECT team_id, entry_key AS question_id, payload:status::string AS status, payload:answer::string AS answer,
       payload:owner::string AS owner, user_email AS saved_by, ts AS saved_at
FROM {cat}.{studio}.latest_entries WHERE kind = 'question_answer';

CREATE OR REPLACE VIEW {cat}.{studio}.v_findings_decisions
COMMENT 'Findings register: decision, owner and due date, per team (latest).' AS
SELECT team_id, entry_key AS finding_id, payload:decision::string AS decision, payload:owner::string AS owner,
       payload:due::string AS due, payload:note::string AS note, user_email AS saved_by, ts AS saved_at
FROM {cat}.{studio}.latest_entries WHERE kind = 'finding_decision';

CREATE OR REPLACE VIEW {cat}.{studio}.v_task_progress
COMMENT 'Which tasks each team has marked done (latest).' AS
SELECT team_id, entry_key AS task_id, payload:status::string AS status, user_email AS saved_by, ts AS saved_at
FROM {cat}.{studio}.latest_entries WHERE kind = 'task_progress';

CREATE OR REPLACE VIEW {cat}.{studio}.v_time_per_step
COMMENT 'Minutes from the first activity on a task to it being marked done, per team.' AS
WITH first_touch AS (
  SELECT team_id, task_id, min(ts) AS first_ts FROM {cat}.{studio}.events WHERE task_id IS NOT NULL GROUP BY team_id, task_id),
done AS (
  SELECT team_id, entry_key AS task_id, min(ts) AS done_ts FROM {cat}.{studio}.entries
  WHERE kind = 'task_progress' AND payload:status::string = 'done' GROUP BY team_id, entry_key)
SELECT f.team_id, f.task_id, f.first_ts, d.done_ts,
       round((unix_timestamp(d.done_ts) - unix_timestamp(f.first_ts)) / 60.0, 1) AS minutes
FROM first_touch f LEFT JOIN done d USING (team_id, task_id);
