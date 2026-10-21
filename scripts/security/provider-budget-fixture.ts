import type { Firestore } from 'firebase-admin/firestore';

// Serial transactions model Firestore's conflict retries and atomic writes.
export function memoryBudgetDb() {
  const values = new Map<string, Record<string, unknown>>();
  let tail = Promise.resolve();
  let unavailable = false;
  const db = {
    collection: (name: string) => ({doc: (id: string) => ({path: `${name}/${id}`})}),
    runTransaction<T>(work: (transaction: unknown) => Promise<T>): Promise<T> {
      const next = tail.then(async () => {
        if (unavailable) throw new Error('private storage error');
        const writes = new Map<string, Record<string, unknown>>();
        const result = await work({
          getAll: async (...refs: {path: string}[]) => refs.map(ref => ({exists: values.has(ref.path), data: () => values.get(ref.path)})),
          update: (ref: {path: string}, data: Record<string, unknown>) => writes.set(ref.path, {...values.get(ref.path), ...data}),
          set: (ref: {path: string}, data: Record<string, unknown>) => writes.set(ref.path, data),
        });
        writes.forEach((data, path) => values.set(path, data));
        return result;
      });
      tail = next.then(() => {}, () => {});
      return next;
    },
  } as unknown as Firestore;
  return {db, values, down: (value = true) => { unavailable = value; }, units: () => [...values.entries()].filter(([path]) => path.startsWith('apiQuota/')).map(([, data]) => data.units)};
}
