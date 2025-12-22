import fs from 'fs/promises';
import path from 'path';

type TTarget = {
  out: string;
  target: Bun.Build.Target;
};

const cwd = process.cwd();
const rootCwd = path.resolve(cwd, '..');
const rootPckJson = path.join(rootCwd, 'package.json');
const outPath = path.join(rootCwd, 'build', 'out');

const getCurrentVersion = async () => {
  const pkg = JSON.parse(await fs.readFile(rootPckJson, 'utf8'));

  return pkg.version;
};

const compileUpdater = async ({ out, target }: TTarget) => {
  const version = await getCurrentVersion();

  await Bun.build({
    entrypoints: [path.join(rootCwd, 'src', 'updater.ts')],
    compile: {
      outfile: out,
      target
    },
    define: {
      'process.env.BUILD_VERSION': `"${version}"`
    }
  });
};

const targets: TTarget[] = [
  { out: 'updater-linux-x64', target: 'bun-linux-x64' },
  { out: 'updater-linux-arm64', target: 'bun-linux-arm64' },
  { out: 'updater-windows-x64.exe', target: 'bun-windows-x64' },
  { out: 'updater-macos-arm64', target: 'bun-darwin-arm64' },
  { out: 'updater-macos-x64', target: 'bun-darwin-x64' }
];

for (const target of targets) {
  console.log(`Building updater for target: ${target.target}`);

  await compileUpdater({
    out: path.join(outPath, target.out),
    target: target.target
  });

  console.log(`Built: ${target.out}`);
}
