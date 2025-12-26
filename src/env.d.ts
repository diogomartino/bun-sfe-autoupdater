/// <reference types="bun-types" />

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      CURRENT_VERSION: string;
      GITHUB_TOKEN?: string;
      BUILD_VERSION: string;
      UPDATER_REPO_OWNER?: string;
      UPDATER_REPO_NAME?: string;
    }
  }

  // injected at build time via Bun.build's define option
  const UPDATER_LIB_VERSION: string;
}

export {};
