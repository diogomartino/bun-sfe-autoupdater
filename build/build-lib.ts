import fs from 'fs/promises';
import path from 'path';

const cwd = process.cwd();
const rootCwd = path.resolve(cwd, '..');
const indexPath = path.join(rootCwd, 'src', 'index.ts');
const rootPckJson = path.join(rootCwd, 'package.json');
const distPath = path.join(rootCwd, 'dist');

const getCurrentVersion = async () => {
  const pkg = JSON.parse(await fs.readFile(rootPckJson, 'utf8'));

  return pkg.version;
};

const version = await getCurrentVersion();

console.log(`Building library version: ${version}`);
console.log('Generating TypeScript declarations...');

const tscProcess = Bun.spawn(
  ['bunx', 'tsc', '--project', path.join(rootCwd, 'tsconfig.build.json')],
  {
    cwd: rootCwd,
    stdout: 'inherit',
    stderr: 'inherit'
  }
);

const tscExitCode = await tscProcess.exited;

if (tscExitCode !== 0) {
  console.error('TypeScript declaration generation failed');
  process.exit(1);
}

console.log('Bundling with Bun...');

const buildResult = await Bun.build({
  entrypoints: [indexPath],
  target: 'node',
  outdir: distPath,
  format: 'esm',
  minify: false,
  sourcemap: 'external',
  define: {
    UPDATER_LIB_VERSION: `"${version}"`
  }
});

if (!buildResult.success) {
  console.error('Build failed', buildResult.logs);

  process.exit(1);
}
