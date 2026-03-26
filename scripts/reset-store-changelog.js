#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IOS_RELEASE_NOTES = path.join(ROOT, 'fastlane/metadata/ios/en-US/release_notes.txt');
const ANDROID_CHANGELOG = path.join(ROOT, 'fastlane/metadata/android/en-US/changelogs/default.txt');

const files = [IOS_RELEASE_NOTES, ANDROID_CHANGELOG];

for (const file of files) {
  if (fs.existsSync(file)) {
    fs.writeFileSync(file, '');
    console.log(`  ✓ Cleared ${path.relative(ROOT, file)}`);
  } else {
    console.log(`  ⊘ Not found: ${path.relative(ROOT, file)}`);
  }
}

console.log('\n  Store changelogs reset. Commit when ready.\n');
