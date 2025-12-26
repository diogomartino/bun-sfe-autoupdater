import debug from 'debug';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import semver from 'semver';
import { ETarget, zRelease, type TAsset, type TRelease } from './types';

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
  let releaseJsonResponse: Response;

  if (process.env.GITHUB_TOKEN) {
    debug('updater')(
      `Fetching asset with github authentication... ${asset.name}`
    );

    // it's a private repo: use API endpoint with authentication
    releaseJsonResponse = await fetch(asset.url, {
      headers: { ...getGithubHeaders(), Accept: 'application/octet-stream' }
    });
  } else {
    debug('updater')(
      `Fetching asset without github authentication... ${asset.name}`
    );

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

const getLibVersion = async (): Promise<string> => {
  const version =
    typeof UPDATER_LIB_VERSION !== 'undefined'
      ? UPDATER_LIB_VERSION
      : undefined;

  if (!version) {
    throw new Error('UPDATER_LIB_VERSION is not defined.');
  }

  if (!semver.valid(version)) {
    throw new Error(
      `Invalid lib version: ${version}. Must be a valid semver string.`
    );
  }

  return version;
};

const downloadUpdater = async () => {
  const updaterOwner = process.env.UPDATER_REPO_OWNER || 'diogomartino';
  const updaterRepo = process.env.UPDATER_REPO_NAME || 'bun-sfe-autoupdater';

  debug('updater')(`Using updater repo: ${updaterOwner}/${updaterRepo}`);

  const targetVersion = await getLibVersion();

  debug('updater')(`Target updater version: ${targetVersion}`);

  const url = `https://api.github.com/repos/${updaterOwner}/${updaterRepo}/releases/tags/v${targetVersion}`;

  debug('updater')(`Fetching latest updater release info from ${url}`);

  const response = await fetch(url, {
    headers: getGithubHeaders()
  });

  if (!response.ok) {
    throw new Error(
      `Error fetching updater releases: ${response.status} ${response.statusText}`
    );
  }

  const release = (await response.json()) as TRelease;

  debug('updater')(`Latest updater release version: ${release.tag_name}`);

  const currentArchitecture = getCurrentArchitecture();

  debug('updater')(`Current architecture: ${currentArchitecture}`);

  const updaterAsset = release.assets.find((asset) =>
    asset.name.includes(currentArchitecture)
  );

  if (!updaterAsset) {
    throw new Error(
      `No updater asset found for architecture: ${currentArchitecture}`
    );
  }

  debug('updater')(`Found updater asset: ${updaterAsset.name}`);

  const assetResponse = await downloadAsset(updaterAsset);
  const tempUpdaterDir = path.join(os.tmpdir(), 'bun-sfe-autoupdater');

  debug('updater')(`Using temporary updater directory: ${tempUpdaterDir}`);

  if (!(await fs.exists(tempUpdaterDir))) {
    debug('updater')(`Creating temporary updater directory: ${tempUpdaterDir}`);

    await fs.mkdir(tempUpdaterDir, { recursive: true });
  }

  const updaterPath = path.join(tempUpdaterDir, updaterAsset.name);

  debug('updater')(`Downloading updater to path: ${updaterPath}`);

  if (await fs.exists(updaterPath)) {
    debug('updater')(`Removing existing updater at path: ${updaterPath}`);

    await fs.unlink(updaterPath);
  }

  const arrayBuffer = await assetResponse.arrayBuffer();

  debug('updater')(`Writing updater binary to path: ${updaterPath}`);
  await fs.writeFile(updaterPath, new Uint8Array(arrayBuffer));

  debug('updater')(
    `Setting executable permissions for updater at path: ${updaterPath}`
  );
  await fs.chmod(updaterPath, 0o755);

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

const validateReleaseMetadata = (releaseMetadata: any) =>
  zRelease.parse(releaseMetadata);

export {
  downloadAsset,
  downloadUpdater,
  getCurrentArchitecture,
  getGithubHeaders,
  getLibVersion,
  validateReleaseMetadata
};
