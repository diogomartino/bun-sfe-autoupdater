import debug from 'debug';
import fs from 'fs/promises';
import { ETarget, zRelease, type TAsset } from './types';

const log: (message: string) => void = debug('updater');

const PARENT_PID_ENV = 'BUN_SFE_UPDATER_PARENT_PID';

const getGithubHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
};

const downloadAsset = async (asset: TAsset) => {
  let response: Response;

  if (process.env.GITHUB_TOKEN) {
    log(`Fetching asset with github authentication... ${asset.name}`);

    response = await fetch(asset.url, {
      headers: { ...getGithubHeaders(), Accept: 'application/octet-stream' }
    });
  } else {
    log(`Fetching asset without github authentication... ${asset.name}`);

    response = await fetch(asset.browser_download_url);
  }

  if (!response.ok) {
    throw new Error(
      `Error fetching ${asset.name}: ${response.status} ${response.statusText}`
    );
  }

  return response;
};

const getCurrentArchitecture = (): ETarget => {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'linux' && arch === 'x64') return ETarget.LINUX_X64;
  if (platform === 'linux' && arch === 'arm64') return ETarget.LINUX_ARM64;
  if (platform === 'win32' && arch === 'x64') return ETarget.WINDOWS_X64;
  if (platform === 'darwin' && arch === 'arm64') return ETarget.DARWIN_ARM64;
  if (platform === 'darwin' && arch === 'x64') return ETarget.DARWIN_X64;

  throw new Error(`Unsupported platform or architecture: ${platform}-${arch}`);
};

const isStandaloneBinary = () =>
  Bun.main.startsWith('/$bunfs/') || /^[a-z]:[\\/]~BUN[\\/]/i.test(Bun.main);

const installUpdate = async (asset: TAsset, checksum: string | undefined) => {
  const target = process.execPath;
  const newPath = `${target}.new`;
  const oldPath = `${target}.old`;

  const bytes = new Uint8Array(
    await (await downloadAsset(asset)).arrayBuffer()
  );

  if (checksum) {
    const actual = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');

    if (actual !== checksum.toLowerCase()) {
      throw new Error(
        `Checksum verification failed. Expected: ${checksum}, Got: ${actual}`
      );
    }
  } else {
    log('Ignoring checksum verification');
  }

  log(`Writing new binary to ${newPath}`);
  await fs.writeFile(newPath, bytes);
  await fs.chmod(newPath, 0o755);

  await fs.rm(oldPath, { force: true });
  await fs.rename(target, oldPath);

  try {
    await fs.rename(newPath, target);
  } catch (error) {
    await fs.rename(oldPath, target);
    throw error;
  }

  log(`Replaced ${target}`);
};

const relaunch = () => {
  if (process.env.SYSTEMD_EXEC_PID === String(process.pid)) {
    log('Running as a systemd service, leaving the restart to systemd');
    return;
  }

  const child = Bun.spawn([process.execPath, ...process.argv.slice(2)], {
    env: { ...process.env, [PARENT_PID_ENV]: String(process.pid) },
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true
  });

  child.unref();

  log(`Relaunched with PID: ${child.pid}`);
};

const waitForParentExit = () => {
  const pid = Number(process.env[PARENT_PID_ENV]);

  if (!pid) return;

  delete process.env[PARENT_PID_ENV];

  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }

    Bun.sleepSync(50);
  }

  log(`Previous instance ${pid} still alive after 10s, continuing anyway`);
};

const validateReleaseMetadata = (releaseMetadata: unknown) =>
  zRelease.parse(releaseMetadata);

export {
  downloadAsset,
  getCurrentArchitecture,
  getGithubHeaders,
  installUpdate,
  isStandaloneBinary,
  log,
  relaunch,
  validateReleaseMetadata,
  waitForParentExit
};
