type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export class CdpClient {
  private socket: WebSocket;
  private id = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Map<string, Set<(params: unknown) => void>>();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        method?: string;
        params?: unknown;
        result?: unknown;
        error?: { message?: string };
      };
      if (message.id) {
        const callback = this.pending.get(message.id);
        if (!callback) return;
        this.pending.delete(message.id);
        if (message.error)
          callback.reject(new Error(message.error.message ?? "CDP command failed"));
        else callback.resolve(message.result);
        return;
      }
      if (message.method) {
        this.listeners.get(message.method)?.forEach((listener) => listener(message.params));
      }
    });
  }

  static async connect(url: string) {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("Unable to connect to Chrome CDP")), {
        once: true,
      });
    });
    return new CdpClient(socket);
  }

  send<T = unknown>(method: string, params?: Record<string, unknown>) {
    const id = ++this.id;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  waitFor<T = unknown>(method: string, timeoutMs = 15_000) {
    return new Promise<T>((resolve, reject) => {
      const listener = (params: unknown) => {
        clearTimeout(timer);
        this.listeners.get(method)?.delete(listener);
        resolve(params as T);
      };
      const timer = setTimeout(() => {
        this.listeners.get(method)?.delete(listener);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      const listeners = this.listeners.get(method) ?? new Set();
      listeners.add(listener);
      this.listeners.set(method, listeners);
    });
  }

  close() {
    this.socket.close();
  }
}
