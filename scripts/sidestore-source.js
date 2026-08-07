#!/usr/bin/env node

const fs = require('fs');

const MAIN_BUNDLE_ID = 'com.louismollick.substreamer.dev';
const PR_BUNDLE_PATTERN = /^com\.louismollick\.substreamer\.pr([1-9]\d*)$/;
const SOURCE_DEFAULTS = {
  name: 'Substreamer',
  subtitle: 'Substreamer development builds',
  description: 'Main and active pull request builds of Substreamer.',
  iconURL: 'https://raw.githubusercontent.com/louismollick/substreamer/master/src/assets/icon.png',
  website: 'https://github.com/louismollick/substreamer',
  tintColor: '#1f6feb', featuredApps: [], apps: [], news: [],
};

function string(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value;
}
function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}
function url(value, name) {
  const result = string(value, name);
  try {
    if (new URL(result).protocol !== 'https:') throw new Error();
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }
  return result;
}
function validateMetadata(raw, operation) {
  const channel = operation === 'upsert-main' ? 'main' : 'pr';
  if (raw.channel !== channel) throw new Error(`channel must be ${channel}`);
  const prNumber = channel === 'pr' ? positiveInteger(raw.prNumber, 'prNumber') : undefined;
  const expectedBundle = channel === 'main' ? MAIN_BUNDLE_ID : `com.louismollick.substreamer.pr${prNumber}`;
  if (raw.bundleIdentifier !== expectedBundle) throw new Error(`bundleIdentifier must be ${expectedBundle}`);
  const headSHA = string(raw.headSHA, 'headSHA');
  if (!/^[0-9a-f]{40}$/i.test(headSHA)) throw new Error('headSHA must be a 40-character SHA');
  const metadata = {
    channel, headSHA, bundleIdentifier: expectedBundle,
    version: string(raw.version, 'version'), buildVersion: string(raw.buildVersion, 'buildVersion'),
    date: string(raw.date, 'date'), downloadURL: url(raw.downloadURL, 'downloadURL'),
    size: positiveInteger(raw.size, 'size'), minOSVersion: string(raw.minOSVersion, 'minOSVersion'),
    privacy: raw.privacy,
  };
  if (!raw.privacy || typeof raw.privacy !== 'object' || Array.isArray(raw.privacy)) throw new Error('privacy must be an object');
  if (Number.isNaN(Date.parse(metadata.date))) throw new Error('date must be ISO-8601');
  if (channel === 'pr') Object.assign(metadata, { prNumber, title: string(raw.title, 'title'), htmlURL: url(raw.htmlURL, 'htmlURL') });
  return metadata;
}
function normalizeSource(current) {
  if (current == null) return { ...SOURCE_DEFAULTS, apps: [], featuredApps: [] };
  if (typeof current !== 'object' || Array.isArray(current) || !Array.isArray(current.apps)) throw new Error('existing source must contain an apps array');
  for (const app of current.apps) {
    if (!app || typeof app !== 'object' || (app.bundleIdentifier !== MAIN_BUNDLE_ID && !PR_BUNDLE_PATTERN.test(app.bundleIdentifier))) {
      throw new Error('existing source contains an invalid app');
    }
  }
  return { ...SOURCE_DEFAULTS, ...current, apps: [...current.apps] };
}
function appFrom(metadata) {
  const main = metadata.channel === 'main';
  return {
    name: main ? 'Substreamer' : `Substreamer PR ${metadata.prNumber}`,
    bundleIdentifier: metadata.bundleIdentifier,
    developerName: 'Substreamer contributors',
    subtitle: main ? 'Development channel' : metadata.title,
    localizedDescription: main ? 'Latest Substreamer development build.' : `Preview of PR #${metadata.prNumber}: ${metadata.title}\n${metadata.htmlURL}`,
    iconURL: SOURCE_DEFAULTS.iconURL, tintColor: SOURCE_DEFAULTS.tintColor,
    category: main ? 'music' : 'developer',
    versions: [{ version: metadata.version, buildVersion: metadata.buildVersion, date: metadata.date,
      localizedDescription: `Build ${metadata.headSHA.slice(0, 7)}${main ? '' : ` from PR #${metadata.prNumber}`}`,
      downloadURL: metadata.downloadURL, size: metadata.size, minOSVersion: metadata.minOSVersion }],
    appPermissions: { entitlements: [], privacy: metadata.privacy },
  };
}
function sortAndFeature(source) {
  source.apps.sort((a, b) => {
    if (a.bundleIdentifier === MAIN_BUNDLE_ID) return -1;
    if (b.bundleIdentifier === MAIN_BUNDLE_ID) return 1;
    return Number(b.bundleIdentifier.match(PR_BUNDLE_PATTERN)?.[1] || 0) - Number(a.bundleIdentifier.match(PR_BUNDLE_PATTERN)?.[1] || 0);
  });
  source.featuredApps = source.apps.slice(0, 5).map((app) => app.bundleIdentifier);
  return source;
}
function updateSource(current, operation, raw) {
  const source = normalizeSource(current);
  if (operation === 'remove-pr') {
    const prNumber = positiveInteger(Number(raw), 'prNumber');
    source.apps = source.apps.filter((app) => app.bundleIdentifier !== `com.louismollick.substreamer.pr${prNumber}`);
    return sortAndFeature(source);
  }
  if (!['upsert-main', 'upsert-pr'].includes(operation)) throw new Error(`unknown operation: ${operation}`);
  const metadata = validateMetadata(raw, operation);
  source.apps = source.apps.filter((app) => app.bundleIdentifier !== metadata.bundleIdentifier);
  source.apps.push(appFrom(metadata));
  return sortAndFeature(source);
}
function main([operation, sourcePath, input, outputPath]) {
  if (!operation || !sourcePath || !input || !outputPath) throw new Error('Usage: sidestore-source.js <upsert-main|upsert-pr|remove-pr> <existing-source-or-dash> <metadata-or-pr-number> <output>');
  const current = sourcePath === '-' ? null : JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const raw = operation === 'remove-pr' ? input : JSON.parse(fs.readFileSync(input, 'utf8'));
  fs.writeFileSync(outputPath, `${JSON.stringify(updateSource(current, operation, raw), null, 2)}\n`);
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { MAIN_BUNDLE_ID, updateSource, validateMetadata };
