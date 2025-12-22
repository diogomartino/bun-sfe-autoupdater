/// <reference types="bun-types" />

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      CURRENT_VERSION: string;
      GITHUB_TOKEN?: string;
    }
  }
}

export {};
