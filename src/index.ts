import debug from 'debug';
import semver from 'semver';
import {
  downloadAsset,
  downloadUpdater,
  getCurrentArchitecture,
  getGithubHeaders,
  validateReleaseMetadata
} from './helpers';
import {
  zRelease,
  type TOptions,
  type TRelease,
  type TReleaseMetadata
} from './types';

class BunUpdater {
  private owner: string;
  private repo: string;
  private channel: string | undefined;
  private currentVersion: string;
  private isUpdating: boolean = false;

  constructor(options: TOptions) {
    this.owner = options.repoOwner;
    this.repo = options.repoName;
    this.channel = options.channel;
    this.currentVersion = options.currentVersion || process.env.CURRENT_VERSION;

    debug('updater')(
      `Initialized BunUpdater for ${this.owner}/${this.repo} at version ${this.currentVersion}`
    );

    if (!semver.valid(this.currentVersion)) {
      throw new Error(
        `Invalid current version: ${this.currentVersion}. Must be a valid semver string.`
      );
    }
  }

  private getLatestRelease = async () => {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/releases/latest`;

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

    const releaseFileName = this.channel
      ? `release-${this.channel}.json`
      : 'release.json';

    debug('updater')(`Latest release version: ${release.tag_name}`);

    const releaseArtifact = release.assets.find(
      (asset) => asset.name === releaseFileName
    );

    if (!releaseArtifact) {
      throw new Error(
        `${releaseFileName} artifact not found in the latest release.`
      );
    }

    const releaseJsonResponse = await downloadAsset(releaseArtifact);

    debug('updater')(
      `Downloaded ${releaseFileName}: ${releaseJsonResponse.url}`
    );

    const updaterMetadata: TReleaseMetadata = zRelease.parse(
      await releaseJsonResponse.json()
    );

    return { release, updaterMetadata };
  };

  public getLatestVersion = async () => {
    const { updaterMetadata } = await this.getLatestRelease();

    return updaterMetadata.version;
  };

  public hasUpdates = async (): Promise<boolean> => {
    const { release, updaterMetadata } = await this.getLatestRelease();
    const currentArch = getCurrentArchitecture();

    const artifact = updaterMetadata.artifacts.find(
      (artifact) => artifact.target === currentArch
    );

    const hasCorrectArch = release.assets.some((asset) => {
      return asset.name === artifact?.name;
    });

    const hasNewerVersion = semver.gt(
      updaterMetadata.version,
      this.currentVersion
    );

    return hasCorrectArch && hasNewerVersion;
  };

  public checkForUpdates = async () => {
    if (this.isUpdating) {
      debug('updater')('Update already in progress, skipping...');
      return;
    }

    this.isUpdating = true;

    try {
      const { release, updaterMetadata } = await this.getLatestRelease();
      const currentArch = getCurrentArchitecture();

      const artifact = updaterMetadata.artifacts.find(
        (artifact) => artifact.target === currentArch
      );

      const hasCorrectArch = release.assets.some((asset) => {
        return asset.name === artifact?.name;
      });

      const hasNewerVersion = semver.gt(
        updaterMetadata.version,
        this.currentVersion
      );

      if (!hasCorrectArch || !hasNewerVersion) {
        debug('updater')('No updates available.');
        return;
      }

      const targetArtifact = updaterMetadata.artifacts.find(
        (artifact) => artifact.target === getCurrentArchitecture()
      );

      if (!targetArtifact) {
        throw new Error(
          'No suitable artifact found for the current architecture in release.json'
        );
      }

      debug('updater')(
        `Update available: ${updaterMetadata.version} (current: ${this.currentVersion})`
      );

      const targetAsset = release.assets.find(
        (asset) => asset.name === targetArtifact?.name
      );

      if (!targetAsset) {
        throw new Error(
          'No asset found in the release matching the target artifact.'
        );
      }

      debug('updater')(`Downloading updater...`);

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

      debug('updater')(
        `Spawning updater process with args: ${arrayArgs.join(' ')}`
      );

      const updaterProcess = Bun.spawn([updaterPath, ...arrayArgs], {
        stdout: 'inherit',
        stderr: 'inherit',
        detached: true
      });

      updaterProcess.unref();

      await updaterProcess.exited;
    } catch (error) {
      this.isUpdating = false;
      throw error;
    }
  };
}

export type { TRelease, TReleaseMetadata } from './types';
export { BunUpdater, validateReleaseMetadata };
