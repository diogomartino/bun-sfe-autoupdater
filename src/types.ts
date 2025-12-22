import z from 'zod';

enum ETarget {
  LINUX_X64 = 'linux-x64',
  LINUX_ARM64 = 'linux-arm64',
  WINDOWS_X64 = 'windows-x64',
  DARWIN_ARM64 = 'darwin-arm64',
  DARWIN_X64 = 'darwin-x64'
}

const zArtifact = z.object({
  name: z.string(),
  target: z.enum(ETarget),
  size: z.number(),
  checksum: z.string()
});

const zRelease = z.object({
  version: z.string(),
  releaseDate: z.string(),
  artifacts: z.array(zArtifact)
});

type TArtifact = z.infer<typeof zArtifact>;
type TReleaseMetadata = z.infer<typeof zRelease>;

type TOptions = {
  token: string;
};

type TAsset = {
  name: string;
  browser_download_url: string;
  url: string;
  size: number;
};

type TRelease = {
  tag_name: string;
  published_at: string;
  assets: Array<TAsset>;
};

export { ETarget, zArtifact, zRelease };
export type { TArtifact, TAsset, TOptions, TRelease, TReleaseMetadata };
