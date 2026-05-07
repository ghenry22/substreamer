import * as React from 'react';

import { SubstreamerAutoViewProps } from './SubstreamerAuto.types';

export default function SubstreamerAutoView(props: SubstreamerAutoViewProps) {
  return (
    <div>
      <iframe
        style={{ flex: 1 }}
        src={props.url}
        onLoad={() => props.onLoad({ nativeEvent: { url: props.url } })}
      />
    </div>
  );
}
