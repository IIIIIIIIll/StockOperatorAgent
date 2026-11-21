// react-native-webview 的最小测试替身:只提供一个可被 hook 引用/渲染的空组件。
// 真实的 WebView 是 native 模块,Node 下不可用;hook 只用它推导命令式 ref 类型。
export const WebView = (): null => null;
export default WebView;
