import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import test from "node:test"

import {
  InvalidJsonBodyError,
  readJsonBody,
  RequestBodyTooLargeError,
} from "../lib/http/json-body.js"
import {
  assertSafeCellValue,
  assertSafeWorksheetCell,
  assertSafeWorksheetRow,
  assertSafeZipDataRange,
  assertSafeZipDirectory,
  assertSafeZipEntryMetadata,
  MAX_XLSX_WORKSHEET_COLUMNS,
  MAX_XLSX_WORKSHEET_ROWS,
} from "../modules/shared/spreadsheet-safety.js"

const root = new URL("../", import.meta.url)

async function source(path) {
  return readFile(new URL(path, root), "utf8")
}

test("bounded JSON reader accepts valid payloads", async () => {
  const request = new Request("http://localhost/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows: [{ id: 1 }] }),
  })

  const result = await readJsonBody(request, { maxBytes: 1024 })
  assert.deepEqual(result, { rows: [{ id: 1 }] })
})

test("bounded JSON reader rejects oversized content-length before parsing", async () => {
  const request = new Request("http://localhost/import", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": "9999",
    },
    body: "{}",
  })

  await assert.rejects(
    () => readJsonBody(request, { maxBytes: 100 }),
    RequestBodyTooLargeError
  )
})

test("bounded JSON reader stops chunked bodies that exceed the limit", async () => {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('{"value":"'))
      controller.enqueue(encoder.encode("x".repeat(200)))
      controller.enqueue(encoder.encode('"}'))
      controller.close()
    },
  })
  const request = new Request("http://localhost/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  })

  await assert.rejects(
    () => readJsonBody(request, { maxBytes: 64 }),
    RequestBodyTooLargeError
  )
})

test("bounded JSON reader rejects invalid JSON", async () => {
  const request = new Request("http://localhost/import", {
    method: "POST",
    body: "{invalid",
  })

  await assert.rejects(
    () => readJsonBody(request, { maxBytes: 1024 }),
    InvalidJsonBodyError
  )
})

test("spreadsheet guards reject sparse rows, extreme columns, and oversized cells", () => {
  assert.throws(
    () => assertSafeWorksheetRow(MAX_XLSX_WORKSHEET_ROWS + 1, 1),
    /Worksheet terlalu besar/
  )
  assert.throws(
    () => assertSafeWorksheetCell(MAX_XLSX_WORKSHEET_COLUMNS, 1),
    /Worksheet terlalu lebar/
  )
  assert.throws(() => assertSafeCellValue("x".repeat(10001)), /Nilai satu sel/)
})

test("ZIP guards reject invalid metadata and out-of-range data", () => {
  assert.throws(
    () =>
      assertSafeZipDirectory({
        bufferByteLength: 100,
        entryCount: 5000,
        centralOffset: 10,
        endOffset: 80,
      }),
    /terlalu banyak entri/
  )

  assert.throws(
    () =>
      assertSafeZipEntryMetadata({
        compressedSize: 10,
        uncompressedSize: 20 * 1024 * 1024,
        localHeaderOffset: 0,
        bufferByteLength: 100,
      }),
    /terlalu besar/
  )

  assert.throws(
    () =>
      assertSafeZipDataRange({
        dataOffset: 90,
        compressedSize: 20,
        bufferByteLength: 100,
      }),
    /di luar batas/
  )
})

test("both import routes enforce streaming request limits", async () => {
  for (const path of [
    "app/api/masters/mesin/import/route.js",
    "app/api/masters/kendaraan/import/route.js",
  ]) {
    const text = await source(path)
    assert.match(text, /readJsonBody\(request/)
    assert.match(text, /RequestBodyTooLargeError/)
    assert.doesNotMatch(text, /body = await request\.json\(\)/)
  }
})

test("spreadsheet parsers use bounded decompression", async () => {
  for (const path of [
    "modules/master-mesin/spreadsheet-parser.js",
    "modules/master-kendaraan/spreadsheet-parser.js",
  ]) {
    const text = await source(path)
    assert.match(text, /inflateRawWithLimit/)
    assert.match(text, /assertSafeWorksheetRow/)
    assert.match(text, /assertSafeWorksheetCell/)
    assert.doesNotMatch(text, /new Response\(stream\)\.arrayBuffer\(\)/)
  }
})

test("repository has one Next.js configuration and large-data indexes", async () => {
  const files = await readdir(root)
  const configs = files.filter((name) => /^next\.config\.(js|mjs|cjs|ts)$/.test(name))
  assert.deepEqual(configs, ["next.config.mjs"])

  const migration = await source("scripts/migrations/023-large-data-query-indexes.sql")
  assert.match(migration, /IX_pegawai_list_name/)
  assert.match(migration, /IX_master_project_recent/)
  assert.match(migration, /IX_master_kendaraan_recent/)
})
