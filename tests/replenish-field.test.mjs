import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

import {
  comparePointScan,
  normalizeFieldEvent,
  normalizePointScan,
  ReplenishFieldValidationError,
} from "../modules/replenish/field-validation.js"

async function read(relativePath) {
  return fs.readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
}

function completeScan() {
  return {
    departure_bag_seal_no: "BAG-OUT-1",
    reject_cassette_serial: "REJECT-1",
    reject_cassette_seal_no: "REJECT-SEAL-1",
    return_bag_seal_no: "BAG-IN-1",
    cassettes: [
      {
        cassette_no: 1,
        old_cassette_serial: "OLD-1",
        old_seal_no: "OLD-SEAL-1",
        new_cassette_serial: "NEW-1",
        new_seal_no: "NEW-SEAL-1",
      },
    ],
  }
}

test("field scan requires every old/new cassette and seal and rejects duplicate codes", () => {
  const scan = normalizePointScan(completeScan(), 1)
  assert.equal(scan.cassettes[0].oldCassetteSerial, "OLD-1")
  assert.equal(scan.codes.length, 8)

  const duplicate = completeScan()
  duplicate.return_bag_seal_no = duplicate.reject_cassette_seal_no
  assert.throws(
    () => normalizePointScan(duplicate, 1),
    (error) => error instanceof ReplenishFieldValidationError
      && error.extra.code === "DUPLICATE_SCAN_CODE"
  )
})

test("field scan compares new/reject/BAG assets against CPC packing", () => {
  const scan = normalizePointScan(completeScan(), 1)
  const expected = {
    cassettes: [{ cassette_no: 1, cassette_serial: "NEW-1", seal_no: "NEW-SEAL-1" }],
    departure_bag_seal_no: "BAG-OUT-1",
    reject_cassette_serial: "REJECT-1",
    reject_cassette_seal_no: "REJECT-SEAL-1",
    return_bag_seal_no: "BAG-IN-1",
  }
  assert.deepEqual(comparePointScan(scan, expected), [])
  expected.return_bag_seal_no = "BAG-IN-EXPECTED"
  assert.deepEqual(comparePointScan(scan, expected).map((item) => item.field), ["return_bag_seal_no"])
})

test("field device event is UUID-based and normalizes an accurate GPS location", () => {
  const event = normalizeFieldEvent({
    client_event_id: "6ca1e437-ec35-4f8f-bd73-3a78eb76975f",
    action: "START_TRIP",
    recorded_at: "2026-08-10T08:00:00.000Z",
    location: { latitude: -6.2, longitude: 106.8, accuracy: 12.5 },
    offline_created: true,
  })
  assert.equal(event.action, "START_TRIP")
  assert.equal(event.location.accuracy, 12.5)
  assert.equal(event.offlineCreated, true)
})

test("field migration and API preserve audit, evidence, and idempotent offline sync", async () => {
  const migration = await read("scripts/migrations/047-replenish-field-pwa.sql")
  const syncRoute = await read("app/api/transactions/replenish/field/[id]/sync/route.js")
  const serviceWorker = await read("public/sw.js")
  const proxy = await read("proxy.js")

  assert.match(migration, /CREATE TABLE dbo\.replenish_field_events/i)
  assert.match(migration, /UNIQUE \(client_event_id\)/i)
  assert.match(migration, /CREATE TABLE dbo\.replenish_field_cassette_exchanges/i)
  assert.match(migration, /CREATE TABLE dbo\.replenish_field_exceptions/i)
  assert.match(migration, /CREATE TABLE dbo\.replenish_field_exception_evidence/i)
  assert.match(migration, /'Replenish Lapangan', '\/field_replenish'/i)
  assert.match(syncRoute, /sp_getapplock/i)
  assert.match(syncRoute, /insertAuditLog\(transaction/i)
  assert.match(syncRoute, /client_event_id/i)
  assert.match(syncRoute, /Foto bukti wajib/i)
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)/)
  assert.match(proxy, /camera=\(self\)/)
  assert.match(proxy, /geolocation=\(self\)/)
})
