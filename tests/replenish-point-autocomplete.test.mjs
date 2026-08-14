import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

async function read(relativePath) {
  return fs.readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
}

test("machine autocomplete clears its text after a point is added", async () => {
  const page = await read("app/transactions/replenish/page.jsx")
  const autocomplete = await read("components/replenish-autocomplete.jsx")

  assert.match(page, /source="machine"[\s\S]*selected=\{null\}[\s\S]*clearOnSelect/)
  assert.match(page, /if \(option\) addMachine\(option\)/)
  assert.doesNotMatch(page, /machineCandidate/)

  assert.match(autocomplete, /clearOnSelect = false/)
  assert.match(autocomplete, /setQuery\(clearOnSelect \? "" : option\.label\)/)
  assert.match(autocomplete, /if \(clearOnSelect\) setOptions\(\[\]\)/)
})

test("selected ATM CRM points are excluded and duplicate additions are rejected", async () => {
  const page = await read("app/transactions/replenish/page.jsx")

  assert.match(page, /excludeValues=\{form\.points\.map\(\(point\) => point\.machine\.value\)\}/)
  assert.match(page, /ATM\/CRM tersebut sudah ditambahkan ke dalam urutan rute/)
  assert.match(page, /String\(point\.machine\.value\) === String\(option\.value\)/)
})

test("work order point input still enforces the maximum 50 points in the UI", async () => {
  const page = await read("app/transactions/replenish/page.jsx")

  assert.match(page, /form\.points\.length >= 50/)
  assert.match(page, /Maksimal 50 point ATM\/CRM dalam satu work order/)
})
