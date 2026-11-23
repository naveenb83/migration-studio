// Client build step used by `npm run build`.
// The Databricks Apps npm proxy can refuse some UI libraries (they are optionalDependencies, so install
// continues). So the browser bundle is built locally (`npm run prebuild:client`) into client/prebuilt/, which
// is synced with the app source; on the platform we copy it into client/dist instead of compiling.
// Set STUDIO_BUILD_CLIENT=1 to force a full client build.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';

const prebuilt = 'client/prebuilt/index.html';
const canBuild = existsSync('node_modules/@xyflow/react') && existsSync('node_modules/@uiw/react-codemirror');
if (process.env.STUDIO_BUILD_CLIENT === '1' || (!existsSync(prebuilt) && canBuild)) {
  execSync('npm run build:client', { stdio: 'inherit' });
} else if (existsSync(prebuilt)) {
  rmSync('client/dist', { recursive: true, force: true });
  cpSync('client/prebuilt', 'client/dist', { recursive: true });
  console.log('[client-build] using the prebuilt client bundle (client/prebuilt -> client/dist)');
} else {
  console.error('[client-build] no prebuilt client and the UI libraries are not installed: run `npm run prebuild:client` locally first');
  process.exit(1);
}
