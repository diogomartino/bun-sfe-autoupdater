import fs from 'fs/promises';
import path from 'path';
import { parseArgs } from 'util';
import z from 'zod';

const { values } = parseArgs({
  args: Bun.argv,
  options: {
    PUBLIC_URL: { type: 'string' },
    PRIVATE_URL: { type: 'string' },
    SHA256_CHECKSUM: { type: 'string' },
    GITHUB_TOKEN: { type: 'string' },
    CURRENT_BINARY_PATH: { type: 'string' },
    CURRENT_PID: { type: 'string' },
    IGNORE_CHECKSUM: { type: 'boolean' }
  },
  strict: true,
  allowPositionals: true
});

const {
  CURRENT_BINARY_PATH,
  PUBLIC_URL,
  PRIVATE_URL,
  GITHUB_TOKEN,
  CURRENT_PID,
  SHA256_CHECKSUM,
  IGNORE_CHECKSUM
} = z
  .object({
    PUBLIC_URL: z.url().optional(),
    PRIVATE_URL: z.url().optional(),
    GITHUB_TOKEN: z.string().optional(),
    CURRENT_BINARY_PATH: z.string(),
    CURRENT_PID: z.string(),
    SHA256_CHECKSUM: z.string(),
    IGNORE_CHECKSUM: z.boolean().default(false)
  })
  .parse(values);

if (!PUBLIC_URL && !PRIVATE_URL) {
  throw new Error('Either PUBLIC_URL or PRIVATE_URL must be provided.');
}

const waitForTargetPidToExit = async (pid: number) => {
  for (let i = 0; i < 40; i++) {
    try {
      process.kill(pid, 'SIGTERM');
      await Bun.sleep(250);
    } catch {
      return;
    }
  }

  throw new Error(`Process ${pid} did not exit after timeout`);
};

const waitForUnlock = async (file: string) => {
  for (let i = 0; i < 40; i++) {
    try {
      const handle = await fs.open(file, 'r+');
      await handle.close();
      return;
    } catch {
      await Bun.sleep(250);
    }
  }

  throw new Error(`File ${file} remained locked after timeout`);
};

const calculateSHA256 = async (filePath: string) => {
  const fileBuffer = await fs.readFile(filePath);
  const hashBuffer = await crypto.subtle.digest('SHA-256', fileBuffer.buffer);

  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return hashHex;
};

const downloadNewBinary = async (url: string, destPath: string) => {
  const headers: Record<string, string> = {
    Accept: 'application/octet-stream',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  if (GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
  }

  const response = await fetch(url, {
    headers
  });

  if (!response.ok) {
    throw new Error(
      `Error downloading new binary: ${response.status} ${response.statusText}`
    );
  }

  const fileData = await response.arrayBuffer();
  await fs.writeFile(destPath, new Uint8Array(fileData));
};

const currentBinaryName = path.basename(CURRENT_BINARY_PATH);
const newBinaryName = currentBinaryName + '.new';
const newBinaryPath = path.join(
  path.dirname(CURRENT_BINARY_PATH),
  newBinaryName
);

// kills current app process and waits for it to exit
await waitForTargetPidToExit(+CURRENT_PID);

// waits for the current binary file to be unlocked
// on Windows it may take a while after the process exits, just to be safe
await waitForUnlock(CURRENT_BINARY_PATH);

// downloads the new app binary
// the updater logic will inject the correct URL along with the GITHUB_TOKEN if needed
// it's gonna download to "<something>.new" path
await downloadNewBinary((PRIVATE_URL || PUBLIC_URL)!, newBinaryPath);

// verifies the checksum if provided
if (SHA256_CHECKSUM && !IGNORE_CHECKSUM) {
  const downloadedChecksum = await calculateSHA256(newBinaryPath);

  if (downloadedChecksum !== SHA256_CHECKSUM) {
    throw new Error(
      `Checksum verification failed. Expected: ${SHA256_CHECKSUM}, Got: ${downloadedChecksum}`
    );
  }
}

// make sure the new binary is executable
await fs.chmod(newBinaryPath, 0o755);

// rename the old to .old (to have a backup just in case)
await fs.rename(CURRENT_BINARY_PATH, CURRENT_BINARY_PATH + '.old');

// replaces the current binary with the new one
await fs.rename(newBinaryPath, CURRENT_BINARY_PATH);

// spawn the new binary
const child = Bun.spawn([CURRENT_BINARY_PATH], {
  detached: true,
  stdout: 'ignore',
  stderr: 'ignore',
  stdin: 'ignore'
});

// unref to let the updater exit independently
child.unref();

console.log(`Restarted application with PID: ${child.pid}`);

process.exit(0);
