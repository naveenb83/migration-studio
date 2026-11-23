/** Prompt pack: one card per pack prompt, with copy. */
import { Card, CardContent, CardHeader, CardTitle } from '@databricks/appkit-ui/react';
import { CopyButton, EmptyState } from '@/components/common';
import type { PublicPack } from '@/lib/types';

export function PromptsTab({ prompts }: { prompts: PublicPack['prompts'] }) {
  if (prompts.length === 0) return <EmptyState title="No prompts in this pack" />;
  return (
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
            <CopyButton text={p.text} label="Copy prompt" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
