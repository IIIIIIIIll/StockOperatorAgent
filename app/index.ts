// polyfill 必须是第一个 import:它要在 App 依赖图(含 node-tdx-market 的
// exhq-types.js 顶层 Buffer.from)求值前装上全局 Buffer。
import './lib/polyfill';
import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
