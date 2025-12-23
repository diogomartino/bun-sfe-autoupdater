import debug from 'debug';
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

if (CURRENT_BINARY_PATH.includes('.bun/bin/')) {
  throw new Error(
    'Updater can only run on standalone Bun applications, not on "bun run" scripts.'
  );
}

debug('updater')('Updater started with the following parameters:');
debug('updater')(`CURRENT_BINARY_PATH: ${CURRENT_BINARY_PATH}`);
debug('updater')(`CURRENT_PID: ${CURRENT_PID}`);
debug('updater')(`PUBLIC_URL: ${PUBLIC_URL ? 'provided' : 'not provided'}`);
debug('updater')(`PRIVATE_URL: ${PRIVATE_URL ? 'provided' : 'not provided'}`);
debug('updater')(
  `SHA256_CHECKSUM: ${SHA256_CHECKSUM ? 'provided' : 'not provided'}`
);
debug('updater')(`IGNORE_CHECKSUM: ${IGNORE_CHECKSUM}`);

const waitForTargetPidToExit = async (pid: number) => {
  for (let i = 0; i < 40; i++) {
    try {
      debug('updater')(`Trying to kill process with PID: ${pid}`);

      process.kill(pid, 'SIGTERM');
      await Bun.sleep(250);
    } catch {
      debug('updater')(`Process with PID: ${pid} has exited.`);
      return;
    }
  }

  throw new Error(`Process ${pid} did not exit after timeout`);
};

const waitForUnlock = async (file: string) => {
  for (let i = 0; i < 40; i++) {
    try {
      debug('updater')(`Trying to acquire lock on file: ${file}`);
      const handle = await fs.open(file, 'r+');

      debug('updater')(`File ${file} is now unlocked.`);
      await handle.close();
      return;
    } catch {
      debug('updater')(`File ${file} is still locked, retrying...`);
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

  debug('updater')(`Downloading new binary from URL: ${url}`);

  const response = await fetch(url, {
    headers
  });

  if (!response.ok) {
    throw new Error(
      `Error downloading new binary: ${response.status} ${response.statusText}`
    );
  }

  const fileData = await response.arrayBuffer();

  debug('updater')(`Writing new binary to path: ${destPath}`);

  await fs.writeFile(destPath, new Uint8Array(fileData));
};

const currentBinaryName = path.basename(CURRENT_BINARY_PATH);
const newBinaryName = currentBinaryName + '.new';
const newBinaryPath = path.join(
  path.dirname(CURRENT_BINARY_PATH),
  newBinaryName
);

// kills current app process and waits for it to exit
debug('updater')(`Waiting for process with PID: ${CURRENT_PID} to exit...`);
await waitForTargetPidToExit(+CURRENT_PID);

// waits for the current binary file to be unlocked
// on Windows it may take a while after the process exits, just to be safe
debug('updater')(`Waiting for file to be unlocked: ${CURRENT_BINARY_PATH}...`);
await waitForUnlock(CURRENT_BINARY_PATH);

// downloads the new app binary
// the updater logic will inject the correct URL along with the GITHUB_TOKEN if needed
// it's gonna download to "<something>.new" path
const url = (PRIVATE_URL || PUBLIC_URL)!;
debug('updater')(
  `Downloading new binary to path: ${newBinaryPath} from URL: ${url}`
);
await downloadNewBinary(url, newBinaryPath);

// verifies the checksum if provided
if (SHA256_CHECKSUM && !IGNORE_CHECKSUM) {
  debug('updater')(
    `Verifying checksum for downloaded binary at path: ${newBinaryPath}`
  );

  const downloadedChecksum = await calculateSHA256(newBinaryPath);

  debug('updater')(
    `Downloaded checksum for new binary at path: ${newBinaryPath} is: ${downloadedChecksum}`
  );

  if (downloadedChecksum !== SHA256_CHECKSUM) {
    throw new Error(
      `Checksum verification failed. Expected: ${SHA256_CHECKSUM}, Got: ${downloadedChecksum}`
    );
  }
}

// make sure the new binary is executable
debug('updater')(
  `Setting executable permissions for new binary at path: ${newBinaryPath}`
);
await fs.chmod(newBinaryPath, 0o755);

// rename the old to .old (to have a backup just in case)
debug('updater')(
  `Backing up current binary by renaming to: ${CURRENT_BINARY_PATH}.old`
);
await fs.rename(CURRENT_BINARY_PATH, CURRENT_BINARY_PATH + '.old');

// replaces the current binary with the new one
debug('updater')(
  `Replacing current binary with new binary by renaming: ${newBinaryPath} to ${CURRENT_BINARY_PATH}`
);
await fs.rename(newBinaryPath, CURRENT_BINARY_PATH);

// spawn the new binary
debug('updater')(`Spawning new binary at path: ${CURRENT_BINARY_PATH}`);
const child = Bun.spawn([CURRENT_BINARY_PATH], {
  detached: true,
  stdout: 'ignore',
  stderr: 'ignore',
  stdin: 'ignore'
});

// unref to let the updater exit independently
child.unref();

debug('updater')('Update process completed successfully. Exiting updater.');

process.exit(0);
