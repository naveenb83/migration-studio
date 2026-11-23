/** Legacy estate: inventory, retirement blockers, schedule timeline, packages and data flows, and landing. */
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@databricks/appkit-ui/react';
import { PageHeader } from '@/components/common';
import { useApi } from '@/lib/poll';
import { BlockerTab } from './BlockerTab';
import { InventoryTab } from './InventoryTab';
import { LandingTab } from './LandingTab';
import { PackagesTab } from './PackagesTab';
import { TimelineTab } from './TimelineTab';

interface ScanLog {
  scan_id: string;
  scanned_at: string;
  n_artifacts: number | string;
  n_packages: number | string;
  n_jobs: number | string;
  n_errors: number | string;
}

export default function Page() {
  const scan = useApi<ScanLog[]>('/api/estate/estate_scan_log');
  const last = scan.data?.[0];
  return (
    <div className="space-y-4">
      <PageHeader title="Legacy estate" kicker="Where each legacy pipeline goes; what we noticed">
        <span className="max-w-xl text-right text-xs text-muted-foreground">
          {last
            ? `Scanned from the legacy code in this pack at ${last.scanned_at}: ${last.n_artifacts} files, ${last.n_packages} packages, ${last.n_jobs} jobs, ${last.n_errors} errors. The scanner's suggestions need checking.`
            : `Scanned from the legacy code in this pack. The scanner's suggestions need checking.`}
        </span>
      </PageHeader>
      <Tabs defaultValue="inventory">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="blockers">Retirement blockers</TabsTrigger>
          <TabsTrigger value="timeline">Schedule timeline</TabsTrigger>
          <TabsTrigger value="packages">Packages and data flows</TabsTrigger>
          <TabsTrigger value="landing">Landing</TabsTrigger>
        </TabsList>
        <TabsContent value="inventory">
          <InventoryTab />
        </TabsContent>
        <TabsContent value="blockers">
          <BlockerTab />
        </TabsContent>
        <TabsContent value="timeline">
          <TimelineTab />
        </TabsContent>
        <TabsContent value="packages">
          <PackagesTab />
        </TabsContent>
        <TabsContent value="landing">
          <LandingTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
