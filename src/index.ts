import debug from 'debug';
import semver from 'semver';
import {
  downloadAsset,
  downloadUpdater,
  getCurrentArchitecture,
  getGithubHeaders
} from './helpers';
import { zRelease, type TRelease, type TReleaseMetadata } from './types';

const getLatestRelease = async (owner: string, repo: string) => {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;

  debug('updater')(`Fetching latest release info... ${url}`);

  const response = await fetch(url, {
    headers: getGithubHeaders()
  });

  debug('updater')(
    `Response status: ${response.status} ${response.statusText}`
  );

  if (!response.ok) {
    throw new Error(
      `Error fetching releases: ${response.status} ${response.statusText}`
    );
  }

  const release = (await response.json()) as TRelease;

  debug('updater')(`Latest release version: ${release.tag_name}`);

  const releaseArtifact = release.assets.find(
    (asset) => asset.name === 'release.json'
  );

  if (!releaseArtifact) {
    throw new Error('release.json artifact not found in the latest release.');
  }

  const releaseJsonResponse = await downloadAsset(releaseArtifact);

  debug('updater')(`Downloaded release.json: ${releaseJsonResponse.url}`);

  const updaterMetadata: TReleaseMetadata = zRelease.parse(
    await releaseJsonResponse.json()
  );

  return { release, updaterMetadata };
};

const getLatestVersion = async (owner: string, repo: string) => {
  const { updaterMetadata } = await getLatestRelease(owner, repo);

  return updaterMetadata.version;
};

const hasUpdates = async (owner: string, repo: string): Promise<boolean> => {
  const { release, updaterMetadata } = await getLatestRelease(owner, repo);
  const currentArch = getCurrentArchitecture();

  const hasCorrectArch = release.assets.some((artifact) => {
    return artifact.name.includes(currentArch);
  });

  const hasNewerVersion = semver.gt(
    updaterMetadata.version,
    process.env.CURRENT_VERSION
  );

  return hasCorrectArch && hasNewerVersion;
};

const checkForUpdates = async (owner: string, repo: string) => {
  const updateAvailable = await hasUpdates(owner, repo);

  if (!updateAvailable) {
    console.log('No updates available.');
    return;
  }

  const { release, updaterMetadata } = await getLatestRelease(owner, repo);
  const targetArtifact = updaterMetadata.artifacts.find((artifact) =>
    artifact.name.includes(getCurrentArchitecture())
  );

  if (!targetArtifact) {
    throw new Error(
      'No suitable artifact found for the current architecture in release.json'
    );
  }

  const targetAsset = release.assets.find(
    (asset) => asset.name === targetArtifact?.name
  );

  if (!targetAsset) {
    throw new Error(
      'No asset found in the release matching the target artifact.'
    );
  }

  const updaterPath = await downloadUpdater();

  const args: Map<string, string> = new Map();

  args.set('PUBLIC_URL', targetAsset.browser_download_url);
  args.set('PRIVATE_URL', targetAsset.url);
  args.set('GITHUB_TOKEN', process.env.GITHUB_TOKEN || '');
  args.set('CURRENT_BINARY_PATH', process.execPath);
  args.set('CURRENT_PID', process.pid.toString());
  args.set('SHA256_CHECKSUM', targetArtifact.checksum);

  const arrayArgs = Array.from(args.entries()).map(
    ([key, value]) => `--${key}=${value}`
  );

  const updaterProcess = Bun.spawn([updaterPath, ...arrayArgs], {
    stdout: 'inherit',
    stderr: 'inherit',
    detached: true
  });

  await updaterProcess.exited;
};

export type { TRelease, TReleaseMetadata } from './types';
export { checkForUpdates, getLatestVersion, hasUpdates };
