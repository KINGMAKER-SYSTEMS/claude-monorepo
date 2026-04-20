export { BrainDaemon, runDaemon, type DaemonOptions } from "./daemon.js";
export {
  startIpcServer,
  connectIpcClient,
  tryConnectIpcClient,
  IpcClient,
  IpcClientError,
  defaultSocketPath,
  defaultPidPath,
  defaultLogPath,
  type IpcServer,
  type RpcRequest,
  type RpcResponse,
  type RpcResponseOk,
  type RpcResponseErr,
} from "./ipc.js";
export { DaemonClient, type DaemonStatusResponse } from "./client.js";
export { WatchManager } from "./watch.js";
export { TickScheduler, type TickFn } from "./tick.js";
