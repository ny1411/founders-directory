import assert from "node:assert/strict"
import type { Firestore } from "firebase-admin/firestore"

type RecordData = Record<string, unknown>
/** In-memory datastore that enforces transaction ordering and records real reads. */
export function memoryFirestore(initial: Array<[string, RecordData]> = []) {
  const records = new Map(initial)
  const reads: Array<{ collection: string; count: number; limit?: number; after?: string }> = []
  const controls: { onCompanyPage?: () => void; failShardWrite?: boolean } = {}
  const snapshot = (path: string, selected?: string[]) => ({
    id: path.split("/").pop()!, exists: records.has(path),
    data: () => {
      const data = records.get(path)
      return data && (selected ? Object.fromEntries(selected.filter(key => key in data).map(key => [key, data[key]])) : { ...data })
    },
  })
  function collection(path: string) {
    const query = (fields?: string[], maximum?: number, after?: string, conditions: Array<[string, unknown]> = []) => ({
      select: (...keys: string[]) => query(keys, maximum, after, conditions),
      orderBy: () => query(fields, maximum, after, conditions),
      limit: (value: number) => query(fields, value, after, conditions),
      startAfter: (doc: { id: string }) => query(fields, maximum, doc.id, conditions),
      where: (field: string, operator: string, value: unknown) => {
        assert.equal(operator, "==")
        return query(fields, maximum, after, [...conditions, [field, value]])
      },
      async get() {
        const docs = [...records.keys()].filter(key => key.startsWith(`${path}/`) &&
          !key.slice(path.length + 1).includes("/") && (!after || key.slice(path.length + 1) > after) &&
          conditions.every(([field, value]) => records.get(key)?.[field] === value))
          .sort().slice(0, maximum).map(key => snapshot(key, fields))
        reads.push({ collection: path, count: Math.max(1, docs.length), limit: maximum, after })
        if (path === "companies") controls.onCompanyPage?.()
        return { docs, empty: docs.length === 0 }
      },
    })
    return {
      ...query(),
      doc(id: string) {
        const docPath = `${path}/${id}`
        return {
          id, path: docPath, collection: (name: string) => collection(`${docPath}/${name}`),
          async get() { reads.push({ collection: path, count: 1 }); return snapshot(docPath) },
          async set(data: RecordData) {
            if (controls.failShardWrite && path.endsWith("directoryShards")) throw new Error("Simulated shard write failure")
            records.set(docPath, data)
          },
        }
      },
    }
  }
  const db = {
    collection,
    async getAll(...args: Array<{ path?: string; fieldMask?: string[] }>) {
      const options = args.pop()!
      const refs = args as Array<{ path: string }>
      reads.push({ collection: "companies", count: refs.length })
      return refs.map(ref => snapshot(ref.path, options.fieldMask)).reverse()
    },
    async runTransaction<T>(callback: (transaction: unknown) => Promise<T>) {
      const pending = new Map<string, RecordData>()
      const transaction = {
        async get(ref: { get(): Promise<unknown> }) {
          assert.equal(pending.size, 0, "all transaction reads must precede writes")
          return ref.get()
        },
        set(ref: { path: string }, data: RecordData) { pending.set(ref.path, data) },
      }
      const value = await callback(transaction)
      for (const [path, data] of pending) records.set(path, data)
      return value
    },
  }
  return { db: db as unknown as Firestore, records, reads, controls }
}
