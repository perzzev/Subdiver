export type DebugEvent = {
  id: number;
  time: string;
  scope: string;
  message: string;
  data?: unknown;
};

export function createDebugEvent(scope: string, message: string, data?: unknown): DebugEvent {
  return {
    id: Date.now() + Math.floor(Math.random() * 1000),
    time: new Date().toLocaleTimeString(),
    scope,
    message,
    data,
  };
}

export function logDebug(scope: string, message: string, data?: unknown) {
  const prefix = `[subdiver:${scope}] ${message}`;
  if (data === undefined) {
    console.debug(prefix);
  } else {
    console.debug(prefix, data);
  }
}
