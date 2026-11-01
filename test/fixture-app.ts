// compiled twice by update.test.ts: as v1.0.0 (updates itself) and as v2.0.0 (the update)
import { appendFileSync } from 'fs';
import { BunUpdater } from '../src/index';

const version = process.env.CURRENT_VERSION;
const log = (line: string) =>
  appendFileSync(process.env.TEST_LOG!, line + '\n');

// point the updater at the test's fake github api
const realFetch = fetch;
globalThis.fetch = ((url: string, init?: RequestInit) =>
  realFetch(
    String(url).replace('https://api.github.com', process.env.TEST_API!),
    init
  )) as typeof fetch;

// fails if the previous instance still holds the port
const server = Bun.serve({
  port: Number(process.env.TEST_PORT),
  fetch: () => new Response()
});

log(`v${version} ${JSON.stringify(process.argv.slice(2))} ${process.cwd()}`);

if (version === '1.0.0') {
  process.on('SIGTERM', () => {
    log('graceful shutdown');
    server.stop(true);
    process.exit(0);
  });

  try {
    await new BunUpdater({
      repoOwner: 'o',
      repoName: 'r',
      autoStart: process.env.TEST_AUTOSTART === '1'
    }).checkForUpdates();
  } catch (error) {
    log(`error: ${(error as Error).message}`);
    process.exit(1);
  }

  // reached when nothing was installed; after an install the SIGTERM handler exits first
  setTimeout(() => process.exit(0), 1000);
} else {
  setTimeout(() => process.exit(0), 300);
}
