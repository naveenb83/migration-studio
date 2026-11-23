import { useEffect, useState } from 'react';
import { Alert, AlertDescription, Badge, GenieChat, Tabs, TabsList, TabsTrigger } from '@databricks/appkit-ui/react';
import { Info } from 'lucide-react';
import { CopyButton, EmptyState, PageHeader } from '@/components/common';
import { track } from '@/lib/api';
import { useSession } from '@/lib/me';

const FEATURE: Record<string, string> = { default: 'genie_results', results: 'genie_results', estate: 'genie_estate', data: 'genie_data' };

export default function GeniePage() {
  const me = useSession();
  const aliases = me.genie_aliases.filter((a) => me.features[FEATURE[a] ?? a] !== false);
  const [alias, setAlias] = useState(aliases[0] ?? '');
  useEffect(() => track('genie_open', null, { alias }), [alias]);
  if (!aliases.length) return <EmptyState title="No Genie spaces are configured for this session" />;
  const space = me.pack.genie_spaces?.[alias === 'default' ? 'results' : alias];
  return (
    <div className="space-y-4">
      <PageHeader title="Ask Genie" kicker="Questions in plain English, answered from your data">
        <Tabs value={alias} onValueChange={setAlias}>
          <TabsList>
            {aliases.map((a) => (
              <TabsTrigger key={a} value={a}>
                {me.pack.genie_spaces?.[a === 'default' ? 'results' : a]?.title ?? a}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </PageHeader>
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Genie writes SQL from your question and runs it with <b>your own</b> access. It can be wrong: open the generated SQL under each answer and check it. Gates and pass/fail claims always come from a labelled run, never from Genie.
        </AlertDescription>
      </Alert>
      <div className="grid gap-4 lg:grid-cols-4">
        <div className="space-y-2 lg:col-span-1">
          {space?.description && <div className="text-sm text-muted-foreground">{space.description}</div>}
          <div className="text-xs font-semibold uppercase text-muted-foreground">Try asking</div>
          {(space?.sample_questions ?? []).map((q) => (
            <div key={q} className="flex items-start gap-2 rounded-md border p-2 text-sm">
              <span className="flex-1">{q}</span>
              <CopyButton text={q} label="Copy" />
            </div>
          ))}
          <Badge variant="outline" className="mt-2">
            Space: {alias}
          </Badge>
        </div>
        <div className="rounded-lg border lg:col-span-3" style={{ height: 640 }}>
          <GenieChat key={alias} alias={alias} />
        </div>
      </div>
    </div>
  );
}
