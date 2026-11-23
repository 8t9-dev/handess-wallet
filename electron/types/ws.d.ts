declare module 'ws' {
  class WebSocket {
    constructor(address: string, options?: Record<string, unknown>);
    static readonly OPEN: number;
    readonly readyState: number;
    on(event: 'open' | 'close' | 'error' | 'message', listener: (...args: unknown[]) => void): void;
    send(data: string | Uint8Array): void;
    close(): void;
  }

  export default WebSocket;
}
