import { Ionicons } from '@expo/vector-icons';
import { Directory, File, Paths } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { listDirectoryAsync } from 'expo-async-fs';
import { EmptyState } from '../components/EmptyState';
import { useTheme } from '../hooks/useTheme';
import { isViewableFile } from './file-viewer';

interface RootEntry {
  label: string;
  directory: Directory;
}

const ROOTS: RootEntry[] = [
  { label: 'Document', directory: Paths.document },
  { label: 'Cache', directory: Paths.cache },
  { label: 'Bundle', directory: Paths.bundle },
];

type Entry = {
  name: string;
  isDirectory: boolean;
  size?: number;
  uri: string;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function listDirectoryEntries(dir: Directory): Promise<Entry[]> {
  try {
    const names = await listDirectoryAsync(dir.uri);
    return names
      .map((name) => {
        const subDir = new Directory(dir, name);
        const isDir = subDir.exists;
        let size: number | undefined;
        if (!isDir) {
          try {
            size = new File(dir, name).size ?? undefined;
          } catch {
            /* some files may not be readable */
          }
        }
        return {
          name: isDir ? name + '/' : name,
          isDirectory: isDir,
          size,
          uri: isDir ? subDir.uri : new File(dir, name).uri,
        };
      })
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch {
    return [];
  }
}

export function FileExplorerScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [path, setPath] = useState<string[] | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const currentDir = useMemo(() => {
    if (!path) return null;
    const root = ROOTS[Number(path[0])];
    if (!root) return null;
    if (path.length === 1) return root.directory;
    return new Directory(root.directory, ...path.slice(1));
  }, [path]);

  useEffect(() => {
    if (!currentDir) {
      setEntries(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listDirectoryEntries(currentDir).then((result) => {
      if (cancelled) return;
      setEntries(result);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [currentDir]);

  const breadcrumb = useMemo(() => {
    if (!path) return '';
    const root = ROOTS[Number(path[0])];
    if (!root) return '';
    return [root.label, ...path.slice(1)].join('/');
  }, [path]);

  const handleBack = useCallback(() => {
    if (!path) return;
    if (path.length <= 1) {
      setPath(null);
    } else {
      setPath(path.slice(0, -1));
    }
  }, [path]);

  const handleEntryPress = useCallback(
    (entry: Entry) => {
      if (entry.isDirectory) {
        const dirName = entry.name.replace(/\/$/, '');
        setPath((prev) => (prev ? [...prev, dirName] : null));
      } else if (isViewableFile(entry.name)) {
        router.push({
          pathname: '/file-viewer',
          params: { uri: entry.uri, name: entry.name },
        });
      }
    },
    [router],
  );

  const handleRootPress = useCallback((index: number) => {
    setPath([String(index)]);
  }, []);

  const renderEntry = useCallback(
    ({ item }: { item: Entry }) => {
      const tappable = item.isDirectory || isViewableFile(item.name);
      return (
        <Pressable
          onPress={() => handleEntryPress(item)}
          disabled={!tappable}
          style={({ pressed }) => [
            styles.row,
            {
              borderBottomColor: colors.border,
            },
            pressed && tappable && styles.pressed,
          ]}
        >
          <Ionicons
            name={item.isDirectory ? 'folder' : 'document-outline'}
            size={20}
            color={item.isDirectory ? colors.primary : colors.textSecondary}
            style={styles.icon}
          />
          <Text
            style={[styles.name, { color: colors.textPrimary }]}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          {item.size != null && (
            <Text style={[styles.size, { color: colors.textSecondary }]}>
              {formatBytes(item.size)}
            </Text>
          )}
          {tappable && (
            <Ionicons
              name="chevron-forward"
              size={16}
              color={colors.textSecondary}
            />
          )}
        </Pressable>
      );
    },
    [colors, handleEntryPress],
  );

  if (!path) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          {ROOTS.map((root, index) => (
            <Pressable
              key={root.label}
              onPress={() => handleRootPress(index)}
              style={({ pressed }) => [
                styles.row,
                index < ROOTS.length - 1 && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: colors.border,
                },
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                name="folder"
                size={20}
                color={colors.primary}
                style={styles.icon}
              />
              <View style={styles.rootText}>
                <Text style={[styles.name, { color: colors.textPrimary }]}>
                  {root.label}
                </Text>
                <Text
                  style={[styles.subtitle, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {root.directory.uri}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.textSecondary}
              />
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Pressable
        onPress={handleBack}
        style={({ pressed }) => [
          styles.breadcrumbRow,
          { backgroundColor: colors.card },
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="arrow-back" size={18} color={colors.primary} />
        <Text
          style={[styles.breadcrumb, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {breadcrumb}
        </Text>
      </Pressable>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : entries && entries.length === 0 ? (
        <EmptyState icon="folder-open-outline" title="Empty directory" subtitle="This directory contains no files or folders" />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.uri}
          renderItem={renderEntry}
          style={[styles.list, { backgroundColor: colors.card }]}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  card: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  icon: {
    marginRight: 12,
  },
  name: {
    flex: 1,
    fontSize: 15,
  },
  size: {
    fontSize: 13,
    marginRight: 8,
  },
  rootText: {
    flex: 1,
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  breadcrumbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginBottom: 12,
  },
  breadcrumb: {
    fontSize: 14,
    flex: 1,
  },
  list: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  listContent: {
    paddingBottom: 32,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
