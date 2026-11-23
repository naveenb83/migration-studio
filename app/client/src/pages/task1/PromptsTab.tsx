/** Task 1 · Ask Genie Code: how to reach Genie Code (it runs in the workspace, no API) + the prompt pack. */
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@databricks/appkit-ui/react';
import { ExternalLink } from 'lucide-react';
import { CopyButton, EmptyState } from '@/components/common';
import { useApi } from '@/lib/poll';
import type { PublicPack } from '@/lib/types';

interface GM {
  input_folder: string;
  input_url: string | null;
  workspace_url: string;
}
interface GC {
  skill: { name: string; installed: boolean };
}

export function PromptsTab({ prompts }: { prompts: PublicPack['prompts'] }) {
  const gm = useApi<GM>('/api/genie-migrate');
  const gc = useApi<GC>('/api/genie-code');
  const skill = gc.data?.skill.name ? `@${gc.data.skill.name}` : '';
  const forGenieCode = (text: string) => (skill ? `${skill} ${text}` : text);
  return (
    <div className="space-y-4">
      <Card className="border-indigo-200 bg-indigo-50/40 dark:bg-indigo-950/20">
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-2">
          <CardTitle className="text-base">How to use Genie Code for this task</CardTitle>
          {gc.data?.skill.name &&
            (gc.data.skill.installed ? <Badge className="bg-emerald-600">Skill {skill} installed</Badge> : <Badge variant="destructive">Skill {skill} not installed: ask the facilitator</Badge>)}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Open your team&rsquo;s copy of the legacy code in the workspace:{' '}
              {gm.data?.input_url ? (
                <Button asChild size="sm" variant="secondary" className="ml-1 h-7">
                  <a href={gm.data.input_url} target="_blank" rel="noreferrer">
                    Open my legacy code <ExternalLink className="ml-1 h-3.5 w-3.5" />
                  </a>
                </Button>
              ) : (
                <code className="break-all text-xs">{gm.data?.input_folder ?? 'your genie_in folder'}</code>
              )}
            </li>
            <li>Open a file: start with the SSIS package (<code>…ssis_ingestion.dtsx</code>) or the MERGE procedure (<code>…stg_to_edh_proc.sql</code>).</li>
            <li>Open Genie Code from the workspace: its button in the top bar, or the side panel next to the open file.</li>
            <li>
              Copy a prompt below with <b>Copy for Genie Code</b> (it adds <code>{skill || '@<skill>'}</code> so Genie Code follows the framework) and paste it.
            </li>
            <li>Check each answer against the file here in <b>Code browser</b>, then record what you verified in the <b>Lineage worksheet</b>.</li>
          </ol>
          <div className="text-xs text-muted-foreground">Genie Code can be wrong: the code is the evidence, not the answer.</div>
        </CardContent>
      </Card>
      {prompts.length === 0 ? (
        <EmptyState title="No prompts in this pack" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {prompts.map((p) => (
            <Card key={p.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {p.id} · {p.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <pre className="whitespace-pre-wrap break-words rounded-md bg-slate-50 p-2 text-xs dark:bg-slate-900">{p.text}</pre>
                <div className="flex gap-2">
                  <CopyButton text={forGenieCode(p.text)} label="Copy for Genie Code" />
                  <CopyButton text={p.text} label="Copy" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
