import { useLocalSearchParams } from 'expo-router';

import { FileViewerScreen } from '@/screens/file-viewer';

export default function FileViewerRoute() {
  const { uri, name } = useLocalSearchParams<{ uri: string; name: string }>();
  return <FileViewerScreen uri={uri} name={name} />;
}
