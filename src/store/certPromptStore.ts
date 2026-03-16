import { create } from 'zustand';

import { type CertificateInfo } from '../../modules/expo-ssl-trust/src';

interface CertPromptState {
  visible: boolean;
  certInfo: CertificateInfo | null;
  hostname: string;
  isRotation: boolean;

  show: (certInfo: CertificateInfo, hostname: string, isRotation: boolean) => void;
  hide: () => void;
}

export const certPromptStore = create<CertPromptState>()((set) => ({
  visible: false,
  certInfo: null,
  hostname: '',
  isRotation: false,

  show: (certInfo, hostname, isRotation) =>
    set({ visible: true, certInfo, hostname, isRotation }),
  hide: () =>
    set({ visible: false, certInfo: null, hostname: '', isRotation: false }),
}));
