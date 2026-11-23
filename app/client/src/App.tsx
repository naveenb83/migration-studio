import { Suspense, useState } from 'react';
import { createBrowserRouter, Navigate, NavLink, Outlet, RouterProvider, useLocation } from 'react-router';
import { Badge, Button, Sheet, SheetContent, SheetHeader, SheetTitle } from '@databricks/appkit-ui/react';
import { Menu } from 'lucide-react';
import { ErrorState, Loading, Notices } from '@/components/common';
import { MeProvider, useMe } from '@/lib/me';
import { GROUPS, PAGES, type PageDef } from '@/pages/registry';

function visiblePages(features: Record<string, boolean>, facilitator: boolean): PageDef[] {
  return PAGES.filter((p) => (features[p.id] ?? true) !== false && (!p.facilitatorOnly || facilitator));
}

function Nav({ onClick }: { onClick?: () => void }) {
  const { me } = useMe();
  if (!me) return null;
  const pages = visiblePages(me.features, me.is_facilitator);
  return (
    <nav className="flex flex-col gap-4" aria-label="Main">
      {GROUPS.map((g) => {
        const items = pages.filter((p) => p.group === g);
        if (!items.length) return null;
        return (
          <div key={g}>
            <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g}</div>
            {items.map((p) => (
              <NavLink
                key={p.id}
                to={p.path}
                end={p.path === '/'}
                onClick={onClick}
                className={({ isActive }) =>
                  `block rounded-md px-2 py-1.5 text-sm ${isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`
                }
              >
                {p.label}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

function Layout() {
  const { me, error, loading, refresh } = useMe();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  if (loading) return <div className="p-8"><Loading label="Starting Migration Studio" rows={4} /></div>;
  if (error || !me) return <div className="p-8"><ErrorState error={error ?? 'Could not load your session.'} retry={() => void refresh()} fallback="If this keeps happening, carry on in your team notebook: same files, same results." /></div>;
  const page = PAGES.find((p) => (p.path === '/' ? loc.pathname === '/' : loc.pathname.startsWith(p.path)));
  if (page?.needsTeam && !me.team) return <Navigate to="/setup" replace />;
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-56 shrink-0 border-r p-3 md:block">
        <div className="mb-4 px-2">
          <div className="text-sm font-semibold">Migration Studio</div>
          <div className="text-xs text-muted-foreground">{me.pack.engagement.title}</div>
        </div>
        <Nav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b px-4 py-2">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
            <Menu className="h-5 w-5" />
          </Button>
          <div className="text-sm text-muted-foreground md:hidden">Migration Studio</div>
          <div className="ml-auto flex items-center gap-2 text-sm">
            {me.team ? (
              <Badge variant="secondary" title={`Schema prefix ${me.team.prefix}`}>
                {me.team.name}
              </Badge>
            ) : (
              <NavLink to="/setup" className="text-amber-700 underline">
                Pick your team
              </NavLink>
            )}
            {me.role && <Badge variant="outline">{me.role.replace('_', ' ')}</Badge>}
            {me.is_facilitator && <Badge className="bg-indigo-600">facilitator</Badge>}
            <span className="hidden text-xs text-muted-foreground lg:inline">{me.email}</span>
          </div>
        </header>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="left">
            <SheetHeader>
              <SheetTitle>Migration Studio</SheetTitle>
            </SheetHeader>
            <div className="mt-4">
              <Nav onClick={() => setOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <Notices />
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [...PAGES.map((p) => ({ path: p.path, element: <p.component /> })), { path: '*', element: <Navigate to="/" replace /> }],
  },
]);

export default function App() {
  return (
    <MeProvider>
      <RouterProvider router={router} />
    </MeProvider>
  );
}
