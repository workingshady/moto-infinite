type Handler<T> = (payload: T) => void;

/** Tiny typed event bus so systems can talk without importing each other. */
export class Events<M extends object> {
  private map = new Map<keyof M, Set<Handler<never>>>();

  on<K extends keyof M>(type: K, fn: Handler<M[K]>): () => void {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => set.delete(fn as Handler<never>);
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    this.map.get(type)?.forEach((fn) => (fn as Handler<M[K]>)(payload));
  }

  clear() {
    this.map.clear();
  }
}
