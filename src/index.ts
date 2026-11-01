import semver from 'semver';
import {
  downloadAsset,
  getCurrentArchitecture,
  getGithubHeaders,
  installUpdate,
  isStandaloneBinary,
  log,
  relaunch,
  validateReleaseMetadata,
  waitForParentExit
} from './helpers';
import type { TOptions, TOverrides, TRelease } from './types';

waitForParentExit();

class BunUpdater {
  private owner: string;
  private repo: string;
  private channel: string | undefined;
  private currentVersion: string;
  private isUpdating: boolean = false;
  private autoStart: boolean;
  private ignoreChecksum: boolean;

  constructor(options: TOptions) {
    this.owner = options.repoOwner;
    this.repo = options.repoName;
    this.channel = options.channel;
    this.currentVersion = options.currentVersion || process.env.CURRENT_VERSION;
    this.autoStart = options.autoStart ?? false;
    this.ignoreChecksum = options.ignoreChecksum ?? false;

    log(
      `Initialized BunUpdater for ${this.owner}/${this.repo} at version ${this.currentVersion}. Auto-start is ${this.autoStart ? 'enabled' : 'disabled'}.`
    );

    if (!semver.valid(this.currentVersion)) {
      throw new Error(
        `Invalid current version: ${this.currentVersion}. Must be a valid semver string.`
      );
    }
  }

  private getLatestRelease = async () => {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/releases/latest`;

    log(`Fetching latest release info... ${url}`);

    const response = await fetch(url, { headers: getGithubHeaders() });

    if (!response.ok) {
      throw new Error(
        `Error fetching releases: ${response.status} ${response.statusText}`
      );
    }

    const release = (await response.json()) as TRelease;
    const releaseFileName = this.channel
      ? `release-${this.channel}.json`
      : 'release.json';

    log(`Latest release version: ${release.tag_name}`);

    const releaseArtifact = release.assets.find(
      (asset) => asset.name === releaseFileName
    );

    if (!releaseArtifact) {
      throw new Error(
        `${releaseFileName} artifact not found in the latest release.`
      );
    }

    const metadata = validateReleaseMetadata(
      await (await downloadAsset(releaseArtifact)).json()
    );

    return { release, metadata };
  };

  private findUpdate = async () => {
    const { release, metadata } = await this.getLatestRelease();
    const currentArch = getCurrentArchitecture();
    const artifact = metadata.artifacts.find((a) => a.target === currentArch);
    const asset = release.assets.find((a) => a.name === artifact?.name);

    if (
      !artifact ||
      !asset ||
      !semver.gt(metadata.version, this.currentVersion)
    ) {
      return undefined;
    }

    return { version: metadata.version, artifact, asset };
  };

  public getLatestVersion = async () => {
    const { metadata } = await this.getLatestRelease();

    return metadata.version;
  };

  public hasUpdates = async (): Promise<boolean> => !!(await this.findUpdate());

  public checkForUpdates = async (options?: TOverrides) => {
    if (this.isUpdating) {
      log('Update already in progress, skipping...');
      return;
    }

    this.isUpdating = true;

    try {
      const update = await this.findUpdate();

      if (!update) {
        log('No updates available.');
        this.isUpdating = false;
        return;
      }

      if (!isStandaloneBinary()) {
        console.warn(
          `[bun-sfe-autoupdater] Update ${update.version} available, but updates only install in compiled executables, not "bun run".`
        );
        this.isUpdating = false;
        return;
      }

      log(
        `Update available: ${update.version} (current: ${this.currentVersion})`
      );

      await installUpdate(
        update.asset,
        this.ignoreChecksum ? undefined : update.artifact.checksum
      );
    } catch (error) {
      this.isUpdating = false;
      throw error;
    }

    if (options?.autoStart ?? this.autoStart) {
      relaunch();
    }

    process.kill(process.pid, 'SIGTERM');
  };
}

export type { TRelease, TReleaseMetadata } from './types';
export { BunUpdater, validateReleaseMetadata };
