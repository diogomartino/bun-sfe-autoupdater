// end-to-end: compiles a real v1 and v2 app, serves a fake github api and lets v1 update itself
import { afterAll, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { getCurrentArchitecture } from '../src/helpers';

const exe = process.platform === 'win32' ? '.exe' : '';
// realpath: macos tmpdir is a symlink, and cwd reports the resolved path
const tmp = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), 'sfe-test-'))
);
const v1Path = path.join(tmp, `v1${exe}`);
const v2Path = path.join(tmp, `v2${exe}`);
let checksum: string;
let dirCount = 0;

const compile = async (version: string, outfile: string) => {
  const result = await Bun.build({
    entrypoints: [path.join(import.meta.dir, 'fixture-app.ts')],
    compile: { outfile },
    define: { 'process.env.CURRENT_VERSION': `"${version}"` }
  });

  if (!result.success) throw new AggregateError(result.logs, 'Build failed');
};

await compile('1.0.0', v1Path);
await compile('2.0.0', v2Path);
const v2Bytes = await Bun.file(v2Path).bytes();

const server = Bun.serve({
  port: 0,
  fetch(req, self) {
    const base = self.url.origin;
    const asset = (name: string, file: string) => ({
      name,
      url: `${base}/${file}`,
      browser_download_url: `${base}/${file}`,
      size: 0
    });

    switch (new URL(req.url).pathname) {
      case '/repos/o/r/releases/latest':
        return Response.json({
          tag_name: 'v2.0.0',
          published_at: '',
          assets: [asset('release.json', 'release.json'), asset('app', 'bin')]
        });
      case '/release.json':
        return Response.json({
          version: '2.0.0',
          releaseDate: '',
          artifacts: [
            {
              name: 'app',
              target: getCurrentArchitecture(),
              size: v2Bytes.length,
              checksum
            }
          ]
        });
      case '/bin':
        return new Response(v2Bytes);
      default:
        return new Response('not found', { status: 404 });
    }
  }
});

afterAll(async () => {
  server.stop(true);
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

const waitFor = async (check: () => Promise<boolean>, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(100);
  }
};

// installs a fresh v1 in its own dir, returns how to run it and read what it logged
const setup = async () => {
  const dir = path.join(tmp, `case-${dirCount++}`);
  const app = path.join(dir, `app${exe}`);

  await fs.mkdir(dir);
  await fs.copyFile(v1Path, app);
  await fs.chmod(app, 0o755);

  const logFile = path.join(dir, 'log.txt');
  const readLog = async () =>
    (await Bun.file(logFile).exists()) ? await Bun.file(logFile).text() : '';
  const env = {
    ...process.env,
    TEST_API: server.url.origin,
    TEST_LOG: logFile,
    TEST_PORT: String(20_000 + Math.floor(Math.random() * 20_000))
  };

  return { dir, app, env, readLog };
};

// awkward on purpose: windows rebuilds the command line from these
const args = ['--flag', 'two words', 'say "hi"', 'C:\\my dir\\', ''];

test('updates, shuts down gracefully and relaunches with the same args and cwd', async () => {
  checksum = new Bun.CryptoHasher('sha256').update(v2Bytes).digest('hex');
  const { dir, app, env, readLog } = await setup();

  const output = Bun.file(path.join(dir, 'output.txt'));
  const v1 = Bun.spawn([app, ...args], {
    cwd: dir,
    env: { ...env, TEST_AUTOSTART: '1', DEBUG: 'updater' },
    stdio: ['ignore', output, output]
  });
  await v1.exited;
  await waitFor(async () => (await readLog()).includes('v2.0.0'));

  if (!(await readLog()).includes('v2.0.0')) {
    console.log(`v1 exit code: ${v1.exitCode}\n${await output.text()}`);
  }

  expect((await readLog()).split('\n')).toEqual([
    `v1.0.0 ${JSON.stringify(args)} ${dir}`,
    'graceful shutdown',
    `v2.0.0 ${JSON.stringify(args)} ${dir}`,
    ''
  ]);
  expect(await Bun.file(app).bytes()).toEqual(v2Bytes);
  expect(await Bun.file(`${app}.old`).exists()).toBe(true);
}, 30_000);

test('does not relaunch without autoStart', async () => {
  checksum = new Bun.CryptoHasher('sha256').update(v2Bytes).digest('hex');
  const { dir, app, env, readLog } = await setup();

  await Bun.spawn([app], {
    cwd: dir,
    env,
    stdio: ['ignore', 'ignore', 'ignore']
  }).exited;
  await Bun.sleep(1500);

  expect(await readLog()).not.toContain('v2.0.0');
  expect(await Bun.file(app).bytes()).toEqual(v2Bytes);
}, 30_000);

test('rejects a bad checksum and leaves the binary untouched', async () => {
  checksum = 'deadbeef';
  const { dir, app, env, readLog } = await setup();
  const before = await Bun.file(app).bytes();

  const v1 = Bun.spawn([app], {
    cwd: dir,
    env: { ...env, TEST_AUTOSTART: '1' },
    stdio: ['ignore', 'ignore', 'ignore']
  });

  expect(await v1.exited).toBe(1);
  expect(await readLog()).toContain('error: Checksum verification failed');
  expect(await Bun.file(app).bytes()).toEqual(before);
  expect(await fs.exists(`${app}.old`)).toBe(false);
}, 30_000);

test('only warns under "bun run", never replacing the bun binary', async () => {
  checksum = new Bun.CryptoHasher('sha256').update(v2Bytes).digest('hex');
  const { dir, env, readLog } = await setup();

  const v1 = Bun.spawn(
    [process.execPath, path.join(import.meta.dir, 'fixture-app.ts')],
    {
      cwd: dir,
      env: { ...env, CURRENT_VERSION: '1.0.0', TEST_AUTOSTART: '1' },
      stdio: ['ignore', 'ignore', 'pipe']
    }
  );

  expect(await v1.exited).toBe(0);
  expect(await new Response(v1.stderr).text()).toContain(
    'Update 2.0.0 available, but updates only install in compiled executables'
  );
  expect(await readLog()).toBe(`v1.0.0 [] ${dir}\n`);
  expect(await fs.exists(`${process.execPath}.old`)).toBe(false);
}, 30_000);

// regression for https://github.com/Sharkord/sharkord/issues/686
const hasUserSystemd =
  process.platform === 'linux' &&
  Bun.spawnSync(['systemctl', '--user', 'show-environment']).exitCode === 0;

test.skipIf(!hasUserSystemd)(
  'updates under a systemd service with Restart=always',
  async () => {
    checksum = new Bun.CryptoHasher('sha256').update(v2Bytes).digest('hex');
    const { dir, app, env, readLog } = await setup();
    const unit = `sfe-test-${process.pid}`;
    const pass = (name: 'TEST_API' | 'TEST_LOG' | 'TEST_PORT') =>
      `--setenv=${name}=${env[name]}`;

    const run = Bun.spawnSync([
      'systemd-run',
      '--user',
      '--quiet',
      `--unit=${unit}`,
      '--property=Restart=always',
      '--property=RestartSec=500ms',
      `--property=WorkingDirectory=${dir}`,
      pass('TEST_API'),
      pass('TEST_LOG'),
      pass('TEST_PORT'),
      '--setenv=TEST_AUTOSTART=1',
      '--setenv=DEBUG=updater',
      app
    ]);

    expect(run.stderr.toString()).toBe('');

    try {
      await waitFor(async () => (await readLog()).includes('v2.0.0'));

      if (!(await readLog()).includes('v2.0.0')) {
        const status = ['systemctl', '--user', 'status', '--no-pager', unit];
        const journal = ['journalctl', '--user', '--no-pager', '-u', unit];

        console.log(Bun.spawnSync(status).stdout.toString());
        console.log(Bun.spawnSync(journal).stdout.toString());
      }
    } finally {
      Bun.spawnSync(['systemctl', '--user', 'stop', unit]);
    }

    const lines = (await readLog()).split('\n');

    expect(lines.slice(0, 3)).toEqual([
      `v1.0.0 [] ${dir}`,
      'graceful shutdown',
      `v2.0.0 [] ${dir}`
    ]);
    expect(await Bun.file(app).bytes()).toEqual(v2Bytes);
  },
  30_000
);
