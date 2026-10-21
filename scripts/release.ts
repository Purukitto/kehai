/**
 * Cuts a release: sets the version in every manifest the release workflow
 * checks, moves the Unreleased changelog entries under it, then commits and
 * tags. Pushing is left to you, because the tag is what starts the build.
 *
 *   bun run release patch | minor | major | 1.2.3 | 1.2.3-rc.1 [--dry-run]
 *
 * The workflow refuses a tag whose version disagrees with any manifest, or
 * whose changelog section is missing or empty. This is the way to never meet
 * either refusal.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const REPO = 'https://github.com/Purukitto/kehai';
const CHANGELOG = 'CHANGELOG.md';

function fail(message: string): never {
  console.error(`release: ${message}`);
  process.exit(1);
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

interface Version {
  core: [number, number, number];
  pre: string | null;
}

function parse(version: string): Version {
  const m = SEMVER.exec(version);
  if (!m) fail(`'${version}' is not a version like 1.2.3 or 1.2.3-rc.1`);
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null };
}

/** Semver precedence: a prerelease sorts before its release, numeric parts numerically. */
function compare(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  const xs = x.pre.split('.');
  const ys = y.pre.split('.');
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    if (xs[i] === undefined) return -1;
    if (ys[i] === undefined) return 1;
    const xn = /^\d+$/.test(xs[i]) ? Number(xs[i]) : NaN;
    const yn = /^\d+$/.test(ys[i]) ? Number(ys[i]) : NaN;
    if (!Number.isNaN(xn) && !Number.isNaN(yn)) {
      if (xn !== yn) return xn - yn;
    } else if (xs[i] !== ys[i]) {
      return xs[i] < ys[i] ? -1 : 1;
    }
  }
  return 0;
}

/**
 * From a prerelease, a bump releases it when it can: 0.2.0-rc.2 goes to 0.2.0
 * on `minor`, not to 0.3.0, the same as `npm version`.
 */
function bump(current: string, kind: string): string {
  const { core, pre } = parse(current);
  const [major, minor, patch] = core;
  switch (kind) {
    case 'major':
      return pre && minor === 0 && patch === 0 ? `${major}.0.0` : `${major + 1}.0.0`;
    case 'minor':
      return pre && patch === 0 ? `${major}.${minor}.0` : `${major}.${minor + 1}.0`;
    case 'patch':
      return pre ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch + 1}`;
    default:
      parse(kind);
      return kind;
  }
}

/** Replaces exactly one match, and only if it currently holds `expected`. */
function setVersion(path: string, pattern: RegExp, expected: string, next: string, files: Map<string, string>) {
  const text = files.get(path) ?? readFileSync(path, 'utf8');
  const m = pattern.exec(text);
  if (!m) fail(`no version found in ${path}`);
  if (m[2] !== expected) fail(`${path} says ${m[2]} but package.json says ${expected}. Line them up first.`);
  files.set(path, text.slice(0, m.index) + m[1] + next + m[3] + text.slice(m.index + m[0].length));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Up to the next version heading or the link definitions at the foot. */
const SECTION_END = String.raw`(?=^## \[|^\[[^\]]+\]: |(?![\s\S]))`;

/**
 * Gives the new version its section and points the compare links at it.
 *
 * A release takes the Unreleased entries. A prerelease only copies them: an
 * rc is a build to try, so its section lists everything since the last
 * release, and the release itself replaces it rather than being left with
 * nothing to say.
 */
function rollChangelog(next: string, prerelease: boolean, files: Map<string, string>) {
  const text = readFileSync(CHANGELOG, 'utf8');
  const section = new RegExp(String.raw`^## \[Unreleased\][^\n]*\n([\s\S]*?)` + SECTION_END, 'm').exec(text);
  if (!section) fail(`${CHANGELOG} has no '## [Unreleased]' section`);

  const entries = section[1].trim();
  if (!entries) {
    fail(`nothing under '## [Unreleased]' in ${CHANGELOG}. Write down what changed for people using Kehai first.`);
  }

  // The last release, which every link for the new version compares against.
  const link = /^\[Unreleased\]: .*\/compare\/v(.+?)\.\.\.HEAD$/m.exec(text);
  if (!link) fail(`${CHANGELOG} has no '[Unreleased]: .../compare/vX...HEAD' link to update`);
  const since = link[1];

  const date = new Date().toISOString().slice(0, 10);
  const heading = `## [${next}] - ${date}\n\n${entries}\n\n`;
  const end = section.index + section[0].length;
  const newLink = `[${next}]: ${REPO}/compare/v${since}...v${next}`;

  let rolled: string;
  if (prerelease) {
    rolled = text.slice(0, end) + heading + text.slice(end);
    rolled = rolled.replace(link[0], `${link[0]}\n${newLink}`);
  } else {
    rolled = text.slice(0, section.index) + `## [Unreleased]\n\n` + heading + text.slice(end);
    rolled = rolled
      .replace(new RegExp(String.raw`^## \[${escape(next)}-[^\]]+\][\s\S]*?` + SECTION_END, 'gm'), '')
      .replace(new RegExp(String.raw`^\[${escape(next)}-[^\]]+\]: .*\r?\n`, 'gm'), '')
      .replace(link[0], `[Unreleased]: ${REPO}/compare/v${next}...HEAD\n${newLink}`);
  }

  files.set(CHANGELOG, rolled);
  return entries;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const kind = args.find((a) => !a.startsWith('--'));
  if (!kind) fail('say which: bun run release patch | minor | major | <version> [--dry-run]');

  const current = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
  const next = bump(current, kind);
  if (compare(next, current) <= 0) fail(`${next} is not newer than ${current}`);
  const tag = `v${next}`;
  const prerelease = parse(next).pre !== null;

  const branch = git('branch', '--show-current');
  if (!dryRun) {
    if (git('status', '--porcelain') !== '') fail('the working tree has changes. Commit or set them aside first.');
    // A prerelease can come from a branch, to try a build out. A release is
    // what installed copies update to, so it comes from main.
    if (!prerelease && branch !== 'main') fail(`releases are cut from main, and this is ${branch}`);
    if (git('tag', '--list', tag) !== '') fail(`${tag} already exists`);
  }

  const files = new Map<string, string>();
  setVersion('package.json', /("version":\s*")([^"]+)(")/, current, next, files);
  setVersion('src-tauri/tauri.conf.json', /("version":\s*")([^"]+)(")/, current, next, files);
  setVersion('src-tauri/Cargo.toml', /^(version = ")([^"]+)(")/m, current, next, files);
  setVersion('src-tauri/Cargo.lock', /(name = "kehai"\r?\nversion = ")([^"]+)(")/, current, next, files);
  const entries = rollChangelog(next, prerelease, files);

  console.log(`${current} -> ${next}${prerelease ? ' (prerelease)' : ''}\n`);
  console.log(entries + '\n');

  if (dryRun) {
    console.log(`Would write ${[...files.keys()].join(', ')}, commit, and tag ${tag}.`);
    return;
  }

  for (const [path, text] of files) writeFileSync(path, text);
  git('add', ...files.keys());
  git('commit', '--quiet', '-m', `chore: release ${tag}`);
  git('tag', '--annotate', tag, '-m', `Kehai ${tag}`);

  console.log(`Committed and tagged ${tag}. Push both to build it:\n`);
  console.log(`  git push origin ${branch} ${tag}\n`);
  console.log('The release workflow drafts it on GitHub. Installed copies see it once the draft is published.');
}

main();
