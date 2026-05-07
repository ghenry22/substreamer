import { requireNativeView } from 'expo';
import * as React from 'react';

import { SubstreamerAutoViewProps } from './SubstreamerAuto.types';

const NativeView: React.ComponentType<SubstreamerAutoViewProps> =
  requireNativeView('SubstreamerAuto');

export default function SubstreamerAutoView(props: SubstreamerAutoViewProps) {
  return <NativeView {...props} />;
}
