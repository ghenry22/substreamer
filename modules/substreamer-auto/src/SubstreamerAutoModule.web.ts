import { registerWebModule, NativeModule } from 'expo';

import { ChangeEventPayload } from './SubstreamerAuto.types';

type SubstreamerAutoModuleEvents = {
  onChange: (params: ChangeEventPayload) => void;
}

class SubstreamerAutoModule extends NativeModule<SubstreamerAutoModuleEvents> {
  PI = Math.PI;
  async setValueAsync(value: string): Promise<void> {
    this.emit('onChange', { value });
  }
  hello() {
    return 'Hello world! 👋';
  }
};

export default registerWebModule(SubstreamerAutoModule, 'SubstreamerAutoModule');
