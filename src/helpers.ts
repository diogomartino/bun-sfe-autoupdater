import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { ETarget, type TAsset, type TRelease } from './types';

const downloadAsset = async (asset: TAsset) => {
  let releaseJsonResponse: Response;

  if (process.env.GITHUB_TOKEN) {
    // it's a private repo: use API endpoint with authentication
    releaseJsonResponse = await fetch(asset.url, {
      headers: {
        Accept: 'application/octet-stream',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`
      }
    });
  } else {
    // it's a public repo: use browser download URL (no auth needed)
    releaseJsonResponse = await fetch(asset.browser_download_url);
  }

  if (!releaseJsonResponse.ok) {
    throw new Error(
      `Error fetching release.json: ${releaseJsonResponse.status} ${releaseJsonResponse.statusText}`
    );
  }

  return releaseJsonResponse;
};

const downloadUpdater = async () => {
  const updaterOwner = 'diogomartino';
  const updaterRepo = 'bun-sfe-autoupdater';

  const response = await fetch(
    `https://api.github.com/repos/${updaterOwner}/${updaterRepo}/releases/latest`
  );

  if (!response.ok) {
    throw new Error(
      `Error fetching updater releases: ${response.status} ${response.statusText}`
    );
  }

  const release = (await response.json()) as TRelease;
  const currentArchitecture = getCurrentArchitecture();

  const updaterAsset = release.assets.find((asset) =>
    asset.name.includes(currentArchitecture)
  );

  if (!updaterAsset) {
    throw new Error(
      `No updater asset found for architecture: ${currentArchitecture}`
    );
  }

  const assetResponse = await downloadAsset(updaterAsset);
  const tempUpdaterDir = path.join(os.tmpdir(), 'bun-sfe-autoupdater');

  if (!(await fs.exists(tempUpdaterDir))) {
    await fs.mkdir(tempUpdaterDir, { recursive: true });
  }

  const updaterPath = path.join(tempUpdaterDir, updaterAsset.name);

  if (await fs.exists(updaterPath)) {
    await fs.unlink(updaterPath);
  }

  const arrayBuffer = await assetResponse.arrayBuffer();

  await fs.writeFile(updaterPath, new Uint8Array(arrayBuffer));

  return updaterPath;
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

export { downloadAsset, downloadUpdater, getCurrentArchitecture };
