import { describe, expect, it } from 'vitest';
import { chunkCandidates, draftNameFor, fileCandidates, notebookSource } from './lib/geniemigrate';

// FICTIONAL names: the layout matches what Genie Migrate writes, the content is made up.
const out = '/Workspace/Shared/example/teams/t1/genie_out';

describe('Genie Migrate converted outputs', () => {
  it('expects one query per plain input file, and none for SSIS packages or folders', () => {
    const c = fileCandidates(out, [
      { path: 'x/meter_view.sql', name: 'meter_view.sql', type: 'FILE' },
      { path: 'x/load.dtsx', name: 'load.dtsx', type: 'FILE' },
      { path: 'x/sub', name: 'sub', type: 'DIRECTORY' },
    ]);
    expect(c).toEqual([{ path: `${out}/meter_view.dbquery.ipynb`, name: 'meter_view.dbquery.ipynb', type: 'QUERY', label: 'meter_view', from: 'meter_view.sql' }]);
  });
  it('expects one converted query per SSIS chunk, numbered from part 1', () => {
    const dir = `${out}/.lakebridge/chunks/123`;
    const c = chunkCandidates(dir, 'load.dtsx', ['registry.txt', 'chunk_01.sql', 'context_00.txt', 'chunk_00.sql']);
    expect(c.map((x) => [x.path.split('/').pop(), x.part, x.parts])).toEqual([
      ['chunk_00.sql.converted.dbquery.ipynb', 1, 2],
      ['chunk_01.sql.converted.dbquery.ipynb', 2, 2],
    ]);
    expect(c[0].label).toBe('load.dtsx · part 1 of 2');
  });
  it('reads the code out of an exported query (Jupyter JSON)', () => {
    const raw = JSON.stringify({ cells: [{ source: ['-- converted\n', 'SELECT 1\n'] }, { source: 'SELECT 2' }] });
    expect(notebookSource(raw)).toBe('-- converted\nSELECT 1\n\n\nSELECT 2');
    expect(notebookSource('SELECT 3')).toBe('SELECT 3');
  });
  it('names drafts after the source file', () => {
    expect(draftNameFor(`${out}/meter_view.dbquery.ipynb`)).toBe('meter_view.sql');
    expect(draftNameFor(`${out}/.lakebridge/chunks/123/chunk_04.sql.converted.dbquery.ipynb`)).toBe('genie_migrate_ssis_part5.sql');
    expect(draftNameFor(`${out}/plain_file.yml`)).toBe('plain_file.yml');
  });
});
