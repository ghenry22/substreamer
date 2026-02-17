import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { PlayerView } from '@/screens/player-view';

export default function PlayerRoute() {
  const router = useRouter();
  const handleClose = useCallback(() => router.back(), [router]);
  return <PlayerView onClose={handleClose} />;
}
