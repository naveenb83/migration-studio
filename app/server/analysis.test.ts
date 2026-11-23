import { describe, expect, it } from 'vitest';
import { AnalysisFormatError, parseAnalysis } from './lib/analysis';

// Hand-written FICTIONAL analysis in the Genie Migrate Analyze layout (schema 0.2): one view file reading two tables
// that are not in the project (undetermined = missing dependencies) and creating one view.
const fixture = {
  report: { schemaVersion: '0.2', generatedAt: '2026-11-23T10:00:00Z', dialect: 'tsql', base: '/Workspace/Shared/example/teams/t1/genie_in' },
  summary: { files: 1, objects: { total: 3, internal: 1, external: 0, undetermined: 2 }, references: { resolved: 3, unresolved: 0 }, objectLineageEdges: 2, cycles: 0 },
  files: [
    { id: 1, path: 'meter_reads_view.sql', loc: 24, contentHash: 'sha256:abc', statementsAnalyzed: 3, statementsFailed: 0,
      references: [{ object: 2, aspect: 'data', op: 'read' }, { object: 3, aspect: 'data', op: 'read' }, { object: 4, aspect: 'definition', op: 'create' }], unresolvedReferences: [] },
  ],
  objects: [
    { id: 2, name: 'ExampleDB.dbo.meter', provenance: 'undetermined' },
    { id: 3, name: 'ExampleDB.dbo.reading', provenance: 'undetermined' },
    { id: 4, name: 'ExampleDB.dbo.vw_meter_reads', provenance: 'internal' },
  ],
  objectLineage: [
    { from: 2, to: 4, aspect: 'definition', op: 'create', in: 1, via: 'CREATE VIEW', selfReference: false },
    { from: 3, to: 4, aspect: 'definition', op: 'create', in: 1, via: 'CREATE VIEW', selfReference: false },
  ],
  fileLineage: { edges: [], cycles: [], executionOrder: [1] },
  facts: {
    entities: [
      { id: 1, type: 'file', path: 'meter_reads_view.sql' }, { id: 9, type: 'analysis', analyzerComponent: 'example', analyzerVersion: '0.1.0' },
      { id: 10, type: 'statement', verb: 'create' }, { id: 11, type: 'query' },
      { id: 12, type: 'relation', object: 2 }, { id: 13, type: 'relation', object: 3 }, { id: 14, type: 'relation', object: 4 }, { id: 15, type: 'relation' },
    ],
    relationships: [
      { id: 20, type: 'contains', source: 1, target: 10 }, { id: 21, type: 'location', source: 10, target: 1, range: [4, 0, 20, 10] },
      { id: 22, type: 'contains', source: 10, target: 11, role: 'body' }, { id: 23, type: 'location', source: 11, target: 1, range: [6, 0, 20, 10] },
      { id: 24, type: 'operates', source: 11, target: 12, aspect: 'data', op: 'read' }, { id: 25, type: 'operates', source: 11, target: 13, aspect: 'data', op: 'read' },
      { id: 26, type: 'operates', source: 10, target: 14, aspect: 'definition', op: 'create' }, { id: 27, type: 'operates', source: 11, target: 15, aspect: 'data', op: 'read' },
    ],
  },
};

describe('parseAnalysis (Genie Migrate Analyze, schema 0.2)', () => {
  const m = parseAnalysis(fixture);
  it('reads the report header and summary', () => {
    expect(m.schemaVersion).toBe('0.2');
    expect(m.dialect).toBe('tsql');
    expect(m.analyzer).toBe('example 0.1.0');
    expect(m.warnings).toEqual([]);
  });
  it('lists missing (undetermined) dependencies with the files that read them', () => {
    expect(m.missing.map((x) => x.name)).toEqual(['ExampleDB.dbo.meter', 'ExampleDB.dbo.reading']);
    expect(m.missing[0].readBy).toEqual(['meter_reads_view.sql']);
  });
  it('builds read and lineage edges with 1-based line evidence', () => {
    const reads = m.edges.filter((e) => e.kind === 'reads');
    expect(reads.map((e) => e.to).sort()).toEqual([2, 3]);
    expect(reads[0].lines).toEqual([7, 21]); // query range [6..20] → lines 7–21
    const lineage = m.edges.filter((e) => e.kind === 'lineage');
    expect(lineage).toHaveLength(2);
    expect(lineage[0]).toMatchObject({ fromObject: 2, to: 4, via: 'CREATE VIEW', lines: [5, 21] });
    expect(m.objects.find((o) => o.id === 4)?.createdBy).toEqual([1]);
  });
  it('gives each edge a stable key for review decisions', () => {
    expect(new Set(m.edges.map((e) => e.key)).size).toBe(m.edges.length);
  });
  it('rejects files that are not an analysis, and warns on newer schemas', () => {
    expect(() => parseAnalysis({ hello: 1 })).toThrow(AnalysisFormatError);
    expect(parseAnalysis({ ...fixture, report: { ...fixture.report, schemaVersion: '1.0' } }).warnings.length).toBe(1);
  });
});
