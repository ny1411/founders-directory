/** Share overlapping cold reads within one server instance; never retain results. */
export function createDirectoryReadFlight() {
  const pending = new Map<string, Promise<unknown>>()
  return function read<T>(key: string, load: () => Promise<T>): Promise<T> {
    const previous = pending.get(key)
    if (previous) return previous as Promise<T>
    const promise = Promise.resolve().then(load).finally(() => pending.delete(key))
    pending.set(key, promise)
    return promise
  }
}
