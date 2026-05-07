// Reexport the native module. On web, it will be resolved to SubstreamerAutoModule.web.ts
// and on native platforms to SubstreamerAutoModule.ts
export { default } from './src/SubstreamerAutoModule';
export { default as SubstreamerAutoView } from './src/SubstreamerAutoView';
export * from  './src/SubstreamerAuto.types';
