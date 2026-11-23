/** Streamed single-shot AI draft (Tier B, flag `draft`). Output is labelled and saved as a draft only. */
import { useRef, useState } from 'react';
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@databricks/appkit-ui/react';
import { Sparkles, Square } from 'lucide-react';
import { AiBadge, Section, notify } from '@/components/common';
import { CodeView } from '@/components/common/CodeView';
import { api } from '@/lib/api';
import { useSession } from '@/lib/me';
import { useApi } from '@/lib/poll';

export function AiDraft({ onSaved }: { onSaved: () => void }) {
  const me = useSession();
  const tree = useApi<Array<{ path: string; size: number }>>('/api/pack/tree?dir=legacy');
  const uploads = useApi<{ files: Array<{ name: string }> }>('/api/uploads');
  const [source, setSource] = useState('');
  const [target, setTarget] = useState(me.pack.manifest[0]?.file ?? '');
  const [extra, setExtra] = useState('');
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'streaming' | 'done' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);

  const start = async () => {
    setText('');
    setErr(null);
    setState('streaming');
    const ac = new AbortController();
    ctl.current = ac;
    try {
      const r = await fetch('/api/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source_path: source, target, instructions: extra || undefined }), signal: ac.signal });
      if (!r.ok || !r.body) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const p of parts) {
          const line = p.trim();
          if (!line.startsWith('data:')) continue;
          const msg = JSON.parse(line.slice(5)) as { delta?: string; done?: boolean; error?: string };
          if (msg.delta) setText((t) => t + msg.delta);
          if (msg.error) throw new Error(msg.error);
        }
      }
      setState('done');
    } catch (e) {
      if ((e as Error).name === 'AbortError') setState('idle');
      else {
        setErr((e as Error).message);
        setState('error');
      }
    }
  };
  const save = async () => {
    const base = target.replace(/\.[^.]+$/, '');
    const ext = target.split('.').pop() ?? 'sql';
    try {
      await api.post('/api/drafts', { name: `ai_${base}.${ext}`, content: text, source: 'assistant_draft', from: source });
      notify.ok('Saved to drafts as an AI draft. Review it, then promote it to a team file.');
      onSaved();
    } catch (e) {
      notify.error((e as Error).message);
    }
  };

  return (
    <Section title="Draft with AI" description={<span>One model call with the framework skill as guidance. <AiBadge /></span>}>
      <div className="grid gap-2 md:grid-cols-3">
        <Select value={source || undefined} onValueChange={setSource}>
          <SelectTrigger aria-label="Legacy source file">
            <SelectValue placeholder="Legacy file to convert" />
          </SelectTrigger>
          <SelectContent>
            {(tree.data ?? []).map((f) => (
              <SelectItem key={f.path} value={f.path}>
                {f.path.split('/').slice(-1)[0]}
              </SelectItem>
            ))}
            {(uploads.data?.files ?? []).map((f) => (
              <SelectItem key={`u_${f.name}`} value={`uploads/${f.name}`}>
                Your upload: {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger aria-label="Target team file">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {me.pack.manifest.map((m) => (
              <SelectItem key={m.file} value={m.file}>
                {m.artifact} ({m.kind})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input placeholder="Extra instructions (optional)" value={extra} onChange={(e) => setExtra(e.target.value)} aria-label="Extra instructions" />
      </div>
      <div className="mt-2 flex gap-2">
        {state === 'streaming' ? (
          <Button variant="outline" onClick={() => ctl.current?.abort()}>
            <Square className="mr-1 h-4 w-4" /> Stop
          </Button>
        ) : (
          <Button disabled={!source || !target} onClick={() => void start()}>
            <Sparkles className="mr-1 h-4 w-4" /> Draft
          </Button>
        )}
        {state === 'done' && text && <Button variant="secondary" onClick={() => void save()}>Save as draft</Button>}
        {state === 'streaming' && <span className="self-center text-sm text-muted-foreground">Writing… (no first token within 60 s cancels it)</span>}
      </div>
      {err && <div className="mt-2 text-sm text-red-700">{err} If the model is slow, use the prepared example instead.</div>}
      {text && (
        <div className="mt-3">
          <CodeView value={text} name={target} height="360px" />
        </div>
      )}
    </Section>
  );
}
