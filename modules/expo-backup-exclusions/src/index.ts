import ExpoBackupExclusionsModule from './ExpoBackupExclusionsModule';

/**
 * Exclude configured folders from iCloud (iOS) backup.
 * On Android, exclusions are configured at build time via backup_exclusions;
 * this call is a no-op.
 *
 * Call this after cache directories have been created (e.g. in a useEffect
 * in your root layout).
 */
export async function excludeFromBackup(): Promise<void> {
  return ExpoBackupExclusionsModule.excludeFromBackup();
}
