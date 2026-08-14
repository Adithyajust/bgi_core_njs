const DATABASE_NAME = "bgi-replenish-field"
const DATABASE_VERSION = 1
const EVENT_STORE = "pending-events"
const SNAPSHOT_STORE = "snapshots"

function openDatabase() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB tidak tersedia."))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(EVENT_STORE)) {
        const store = database.createObjectStore(EVENT_STORE, { keyPath: "client_event_id" })
        store.createIndex("created_at", "created_at")
      }
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
        database.createObjectStore(SNAPSHOT_STORE, { keyPath: "work_order_id" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error("Penyimpanan offline gagal dibuka."))
  })
}

async function runStore(storeName, mode, operation) {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode)
    const store = transaction.objectStore(storeName)
    let value
    try {
      value = operation(store)
    } catch (error) {
      database.close()
      reject(error)
      return
    }
    transaction.oncomplete = () => {
      database.close()
      resolve(value)
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error || new Error("Penyimpanan offline gagal diproses."))
    }
    transaction.onabort = transaction.onerror
  })
}

export function createFieldEvent(action, { pointId = null, location = null, payload = {} } = {}) {
  return {
    client_event_id: crypto.randomUUID(),
    action,
    work_order_point_id: pointId,
    recorded_at: new Date().toISOString(),
    location,
    offline_created: !navigator.onLine,
    payload,
  }
}

export async function queueFieldEvent(workOrderId, event) {
  const queued = {
    ...event,
    work_order_id: Number(workOrderId),
    created_at: new Date().toISOString(),
  }
  await runStore(EVENT_STORE, "readwrite", (store) => store.put(queued))
  return queued
}

export async function removeFieldEvent(clientEventId) {
  await runStore(EVENT_STORE, "readwrite", (store) => store.delete(clientEventId))
}

export async function listPendingFieldEvents() {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(EVENT_STORE, "readonly")
    const request = transaction.objectStore(EVENT_STORE).index("created_at").getAll()
    request.onsuccess = () => resolve(request.result || [])
    request.onerror = () => reject(request.error || new Error("Antrean offline gagal dibaca."))
    transaction.oncomplete = () => database.close()
  })
}

export async function countPendingFieldEvents() {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(EVENT_STORE, "readonly")
    const request = transaction.objectStore(EVENT_STORE).count()
    request.onsuccess = () => resolve(Number(request.result || 0))
    request.onerror = () => reject(request.error || new Error("Antrean offline gagal dihitung."))
    transaction.oncomplete = () => database.close()
  })
}

export async function cacheFieldSnapshot(snapshot) {
  if (!snapshot?.work_order?.id) return
  await runStore(SNAPSHOT_STORE, "readwrite", (store) => store.put({
    work_order_id: Number(snapshot.work_order.id),
    cached_at: new Date().toISOString(),
    snapshot,
  }))
}

export async function getCachedFieldSnapshot(workOrderId) {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(SNAPSHOT_STORE, "readonly")
    const request = transaction.objectStore(SNAPSHOT_STORE).get(Number(workOrderId))
    request.onsuccess = () => resolve(request.result?.snapshot || null)
    request.onerror = () => reject(request.error || new Error("Snapshot offline gagal dibaca."))
    transaction.oncomplete = () => database.close()
  })
}

export async function syncPendingFieldEvents({ onSynced } = {}) {
  if (!navigator.onLine) return { synced: 0, remaining: await countPendingFieldEvents() }
  const pending = await listPendingFieldEvents()
  let synced = 0
  for (const queued of pending) {
    const response = await fetch(`/api/transactions/replenish/field/${queued.work_order_id}/sync`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_event_id: queued.client_event_id,
        action: queued.action,
        work_order_point_id: queued.work_order_point_id,
        recorded_at: queued.recorded_at,
        location: queued.location,
        offline_created: queued.offline_created,
        payload: queued.payload,
      }),
    })
    const contentType = response.headers.get("content-type") || ""
    const result = contentType.includes("application/json") ? await response.json() : null
    if (!response.ok || !result?.success) {
      const error = new Error(result?.message || `Sinkronisasi gagal (HTTP ${response.status}).`)
      error.status = response.status
      error.details = result
      error.queuedEvent = queued
      throw error
    }
    await removeFieldEvent(queued.client_event_id)
    synced += 1
    if (result.data?.snapshot) await cacheFieldSnapshot(result.data.snapshot)
    onSynced?.({ queued, result })
  }
  return { synced, remaining: await countPendingFieldEvents() }
}

export async function registerFieldServiceWorker() {
  if (!("serviceWorker" in navigator)) return null
  return navigator.serviceWorker.register("/sw.js", { scope: "/" })
}
