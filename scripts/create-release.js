#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const APP_JSON = path.join(ROOT, 'app.json');
const PKG_JSON = path.join(ROOT, 'package.json');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');
const CHANGELOG_HEADER = '# Changelog\n\nAll notable changes to this project will be documented in this file.\n';
const IOS_RELEASE_NOTES = path.join(ROOT, 'fastlane/metadata/ios/en-US/release_notes.txt');
const ANDROID_CHANGELOG = path.join(ROOT, 'fastlane/metadata/android/en-US/changelogs/default.txt');

const STORE_MAX_LENGTH = 4000;
const EXCLUDED_PREFIXES = [
  'ci', 'test', 'tests', 'docs', 'chore', 'build', 'style',
  'release', 'publishing', 'clean up', 'refactor',
];

function run(cmd, opts = {}) {
  const result = execSync(cmd, { cwd: ROOT, encoding: 'utf-8', ...opts });
  return result == null ? '' : result.trim();
}

function fatal(msg) {
  console.error(`\n  Error: ${msg}\n`);
  process.exit(1);
}

function checkPrerequisites() {
  try {
    run('which gh');
  } catch {
    fatal('GitHub CLI (gh) is not installed. Install it from https://cli.github.com');
  }

  try {
    run('gh auth status', { stdio: 'pipe' });
  } catch {
    fatal('GitHub CLI is not authenticated. Run: gh auth login');
  }

  const status = run('git status --porcelain');
  if (status.length > 0) {
    fatal('Working tree is not clean. Commit or stash your changes before creating a release.');
  }
}

function readJSON(filepath) {
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}

function writeJSON(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2) + '\n');
}

function incrementVersion(version, type) {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    fatal(`Invalid version format: ${version}. Expected major.minor.patch`);
  }

  let [major, minor, patch] = parts;

  switch (type) {
    case 'major':
      major++;
      minor = 0;
      patch = 0;
      break;
    case 'minor':
      minor++;
      patch = 0;
      break;
    case 'patch':
      patch++;
      break;
  }

  return `${major}.${minor}.${patch}`;
}

function getLastTag() {
  try {
    return run('git describe --tags --abbrev=0');
  } catch {
    return null;
  }
}

function getCommitsSince(tag) {
  const range = tag ? `${tag}..HEAD` : 'HEAD';
  const log = run(`git log ${range} --oneline --no-decorate`);
  if (!log) return [];

  return log.split('\n').map((line) => {
    const spaceIdx = line.indexOf(' ');
    return spaceIdx > -1 ? line.substring(spaceIdx + 1) : line;
  });
}

function buildChangelogEntry(version, commits) {
  const date = new Date().toISOString().split('T')[0];
  const lines = [`## [${version}] - ${date}`, ''];

  if (commits.length === 0) {
    lines.push('- No notable changes');
  } else {
    for (const msg of commits) {
      lines.push(`- ${msg}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

function updateChangelog(entry) {
  if (!fs.existsSync(CHANGELOG)) {
    fs.writeFileSync(CHANGELOG, CHANGELOG_HEADER + '\n' + entry);
    return;
  }

  const content = fs.readFileSync(CHANGELOG, 'utf-8');
  const headerEnd = content.indexOf('\n\n');

  if (headerEnd === -1) {
    fs.writeFileSync(CHANGELOG, content.trimEnd() + '\n\n' + entry);
    return;
  }

  const header = content.substring(0, headerEnd + 2);
  const body = content.substring(headerEnd + 2);
  fs.writeFileSync(CHANGELOG, header + entry + body);
}

// --- Store Changelog ---

function filterStoreCommits(commits) {
  const seen = new Set();
  return commits.filter((msg) => {
    const lower = msg.toLowerCase();

    // Exclude duplicates
    if (seen.has(lower)) return false;
    seen.add(lower);

    // Exclude commits that are just noise (e.g. "Create CNAME", "update readme")
    if (/^(create|update)\s+(cname|readme)/i.test(msg)) return false;

    // Exclude by prefix
    const colonIdx = msg.indexOf(':');
    if (colonIdx > -1) {
      const prefix = msg.substring(0, colonIdx).toLowerCase().trim();
      if (EXCLUDED_PREFIXES.includes(prefix)) return false;
    }

    return true;
  });
}

function formatStoreCommit(msg) {
  // Strip "area: " prefix
  const colonIdx = msg.indexOf(':');
  let text = colonIdx > -1 ? msg.substring(colonIdx + 1).trim() : msg.trim();

  // Remove GitHub issue references (e.g. "closes #33", "fixes #12")
  text = text.replace(/\s*(closes?|fixes?|resolves?)\s+#\d+/gi, '').trim();

  // Capitalize first letter
  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.substring(1);
  }

  return text;
}

function updateStoreChangelog(commits, filePath) {
  const filtered = filterStoreCommits(commits);
  if (filtered.length === 0) return false;

  const formatted = filtered.map(formatStoreCommit).filter((line) => line.length > 0);
  if (formatted.length === 0) return false;

  // Read existing content for accumulation
  let existing = '';
  if (fs.existsSync(filePath)) {
    existing = fs.readFileSync(filePath, 'utf-8').trim();
  }

  // Deduplicate against existing lines
  const existingLines = new Set(existing.split('\n').map((l) => l.trim().toLowerCase()));
  const newLines = formatted.filter((line) => !existingLines.has(line.toLowerCase()));

  if (newLines.length === 0) return false;

  // Prepend new entries above existing content
  let content = newLines.join('\n');
  if (existing.length > 0) {
    content = content + '\n\n' + existing;
  }

  // Truncate to store limit
  if (content.length > STORE_MAX_LENGTH) {
    content = content.substring(0, STORE_MAX_LENGTH - 3).trimEnd() + '...';
  }

  fs.writeFileSync(filePath, content + '\n');
  return true;
}

// --- Main ---

const VALID_TYPES = ['patch', 'minor', 'major'];
const type = process.argv[2];

if (!type || !VALID_TYPES.includes(type)) {
  console.log('');
  console.log('  Usage: node scripts/create-release.js <patch|minor|major>');
  console.log('');
  console.log('  Examples:');
  console.log('    npm run release -- patch   # 8.0.0 -> 8.0.1');
  console.log('    npm run release -- minor   # 8.0.0 -> 8.1.0');
  console.log('    npm run release -- major   # 8.0.0 -> 9.0.0');
  console.log('');
  process.exit(1);
}

checkPrerequisites();

const appJson = readJSON(APP_JSON);
const currentVersion = appJson.expo.version;
const newVersion = incrementVersion(currentVersion, type);
const tag = `v${newVersion}`;

console.log(`\n  ${currentVersion} → ${newVersion}\n`);

const lastTag = getLastTag();
const commits = getCommitsSince(lastTag);

console.log(`  ${commits.length} commit(s) since ${lastTag || 'beginning'}`);

const entry = buildChangelogEntry(newVersion, commits);

updateChangelog(entry);
console.log('  ✓ Updated CHANGELOG.md');

const iosUpdated = updateStoreChangelog(commits, IOS_RELEASE_NOTES);
const androidUpdated = updateStoreChangelog(commits, ANDROID_CHANGELOG);
if (iosUpdated || androidUpdated) {
  console.log('  ✓ Updated store release notes');
} else {
  console.log('  ⊘ No user-facing changes for store release notes');
}

appJson.expo.version = newVersion;
const currentBuildNum = parseInt(appJson.expo.ios.buildNumber, 10);
appJson.expo.ios.buildNumber = String(currentBuildNum + 1);
appJson.expo.android.versionCode = 80000000 + currentBuildNum + 1;
writeJSON(APP_JSON, appJson);
console.log(`  ✓ Updated app.json (build ${currentBuildNum} → ${currentBuildNum + 1})`);

const pkgJson = readJSON(PKG_JSON);
pkgJson.version = newVersion;
writeJSON(PKG_JSON, pkgJson);
console.log('  ✓ Updated package.json');

run('git add app.json package.json CHANGELOG.md fastlane/metadata/ios/en-US/release_notes.txt fastlane/metadata/android/en-US/changelogs/default.txt');
run(`git commit -m "release: ${tag}"`, { stdio: 'inherit' });
console.log(`  ✓ Committed release: ${tag}`);

run(`git tag ${tag}`);
console.log(`  ✓ Created tag ${tag}`);

run('git push origin HEAD --follow-tags', { stdio: 'inherit' });
console.log('  ✓ Pushed to origin');

const notesFile = path.join(ROOT, '.release-notes-tmp');
fs.writeFileSync(notesFile, entry);
try {
  run(`gh release create ${tag} --title "${tag}" --notes-file "${notesFile}" --target master`, { stdio: 'inherit' });
  console.log(`  ✓ Created GitHub release ${tag}`);
} finally {
  fs.unlinkSync(notesFile);
}

console.log(`\n  Release ${tag} complete!\n`);
