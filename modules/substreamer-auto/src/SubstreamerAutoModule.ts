import { NativeModule, requireNativeModule } from 'expo';

import { SubstreamerAutoModuleEvents } from './SubstreamerAuto.types';

declare class SubstreamerAutoModule extends NativeModule<SubstreamerAutoModuleEvents> {
  PI: number;
  hello(): string;
  setValueAsync(value: string): Promise<void>;
}

// This call loads the native module object from the JSI.
export default requireNativeModule<SubstreamerAutoModule>('SubstreamerAuto');
