import { describe, expect, it } from 'vitest';
import { splitSql, validateTeamFile } from './lib/validate';

const view = { artifact: 'stage_view', file: 'v.sql', required: true, kind: 'view_sql' };
const yamlItem = { artifact: 'edh_yaml', file: 'e.yml', required: true, kind: 'framework_yaml', allowed_mechanisms: ['m_upsert', 'm_upsert_delete'] };

describe('splitSql', () => {
  it('ignores semicolons in strings and comments', () => {
    expect(splitSql("CREATE VIEW v AS SELECT ';' AS x -- a; b\n /* c; d */ FROM t;")).toHaveLength(1);
  });
  it('splits real statements', () => {
    expect(splitSql('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
  });
});

describe('validateTeamFile: view files', () => {
  it('accepts exactly one CREATE [OR REPLACE] VIEW', () => {
    expect(validateTeamFile(view, 'CREATE OR REPLACE VIEW s.v AS SELECT 1 AS x;')).toEqual([]);
    expect(validateTeamFile(view, '-- note\ncreate view v as select 1')).toEqual([]);
  });
  it('rejects a second statement (the recheck executes these files)', () => {
    expect(validateTeamFile(view, 'CREATE VIEW v AS SELECT 1; DROP TABLE t').length).toBeGreaterThan(0);
  });
  it('rejects anything that is not a view', () => {
    expect(validateTeamFile(view, 'DROP TABLE t').length).toBeGreaterThan(0);
    expect(validateTeamFile(view, 'INSERT INTO t VALUES (1)').length).toBeGreaterThan(0);
    expect(validateTeamFile(view, '   ').length).toBeGreaterThan(0);
  });
});

describe('validateTeamFile: framework YAML', () => {
  it('accepts allowed mechanisms', () => {
    expect(validateTeamFile(yamlItem, 'tables:\n  - name: x\n    mechanism: m_upsert\n')).toEqual([]);
  });
  it('rejects unknown mechanisms and bad YAML', () => {
    expect(validateTeamFile(yamlItem, 'tables:\n  - name: x\n    mechanism: custom_notebook\n').length).toBeGreaterThan(0);
    expect(validateTeamFile(yamlItem, 'tables: [unclosed').length).toBeGreaterThan(0);
    expect(validateTeamFile(yamlItem, '- just\n- a list\n').length).toBeGreaterThan(0);
  });
});
