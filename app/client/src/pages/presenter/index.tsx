/** Full-screen walk-through built from the pack (arrow keys / buttons). Facilitator only. */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@databricks/appkit-ui/react';
import { ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';
import { useSession } from '@/lib/me';

export default function PresenterPage() {
  const me = useSession();
  const p = me.pack;
  const slides = useMemo<Array<{ title: string; body: ReactNode }>>(
    () => [
      { title: p.engagement.title, body: <p className="text-2xl text-muted-foreground">{p.dataset.summary ?? p.dataset.title}</p> },
      {
        title: 'Why we are here',
        body: (
          <div className="grid gap-4 md:grid-cols-2">
            {p.outcomes.map((o) => (
              <div key={o.id} className="rounded-xl border p-5">
                <div className="text-xl font-semibold">{o.challenge}</div>
                <div className="mt-2 text-lg text-muted-foreground">{o.today}</div>
              </div>
            ))}
          </div>
        ),
      },
      {
        title: 'The day',
        body: (
          <div className="space-y-2 text-xl">
            {p.agenda.map((a, i) => (
              <div key={i} className="flex gap-4">
                <span className="w-32 tabular-nums text-muted-foreground">
                  {a.start}–{a.end}
                </span>
                <span>{a.title}</span>
              </div>
            ))}
          </div>
        ),
      },
      ...p.tasks.map((t) => ({
        title: t.title,
        body: (
          <div className="space-y-4 text-xl">
            <div className="text-muted-foreground">{t.kicker}</div>
            <ol className="list-decimal space-y-2 pl-8">{(t.steps ?? []).map((s, i) => <li key={i}>{s}</li>)}</ol>
            <div className="rounded-lg bg-emerald-50 p-3 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">Done when: {(t.done_when ?? []).map((d) => d.label).join(' · ')}</div>
            {t.watch_for && <div className="rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-100">Watch for: {t.watch_for}</div>}
          </div>
        ),
      })),
      {
        title: 'Where each legacy pipeline goes',
        body: (
          <div className="space-y-3 text-lg">
            {p.pipelines_landing.map((l, i) => (
              <div key={i} className="grid grid-cols-3 gap-4 border-b pb-2">
                <b>{l.today}</b>
                <span>{l.goes_to}</span>
                <span className="text-muted-foreground">{l.check}</span>
              </div>
            ))}
          </div>
        ),
      },
      {
        title: 'From workshop to pilot',
        body: (
          <div className="grid gap-4 md:grid-cols-3">
            {Object.entries(p.pilot ?? {}).map(([k, items]) => (
              <div key={k} className="rounded-xl border p-5">
                <div className="text-xl font-semibold capitalize">{k.replace(/_/g, ' ')}</div>
                <ul className="mt-2 list-disc space-y-1 pl-6 text-lg">
                  {items.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ),
      },
    ],
    [p],
  );
  const [i, setI] = useState(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setI((x) => Math.min(slides.length - 1, x + 1));
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [slides.length]);
  const s = slides[i];
  return (
    <div id="presenter" className="flex min-h-[80vh] flex-col rounded-xl border bg-background p-10">
      <div className="mb-8 text-sm text-muted-foreground">
        {i + 1} / {slides.length}
      </div>
      <h2 className="mb-8 text-4xl font-semibold tracking-tight">{s.title}</h2>
      <div className="flex-1">{s.body}</div>
      <div className="mt-8 flex justify-between">
        <Button variant="outline" onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0}>
          <ChevronLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <Button variant="ghost" onClick={() => void document.getElementById('presenter')?.requestFullscreen?.()}>
          <Maximize2 className="mr-1 h-4 w-4" /> Full screen
        </Button>
        <Button onClick={() => setI((x) => Math.min(slides.length - 1, x + 1))} disabled={i === slides.length - 1}>
          Next <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
