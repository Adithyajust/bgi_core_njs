import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

async function read(relativePath) {
  return fs.readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
}

test("replenish client retries nested document endpoints through the stable work-order endpoint on HTML 404", async () => {
  for (const relativePath of [
    "app/transactions/replenish/page.jsx",
    "app/transactions/replenish/[id]/surat-tugas/page.jsx",
  ]) {
    const source = await read(relativePath)
    assert.match(source, /function replenishCompatibilityUrl\(url\)/)
    assert.match(source, /response\.status === 404 && !contentType\.includes\("application\/json"\)/)
    assert.match(source, /resourcePath === "key-handover"/)
    if (relativePath.endsWith("page.jsx") && !relativePath.includes("surat-tugas/page.jsx")) {
      assert.match(source, /resourcePath === "key-handover\/pdf"/)
    }
    assert.match(source, /resourcePath === "surat-tugas\/pdf"/)
    assert.match(source, /params\.set\("resource", resource\)/)
    assert.match(source, /response = await fetch\(compatibilityUrl, fetchOptions\)/)
  }
})

test("stable replenish work-order endpoint delegates compatibility resources to existing handlers", async () => {
  const source = await read("app/api/transactions/replenish/[id]/route.js")

  assert.match(source, /getKeyHandoverResource/)
  assert.match(source, /postKeyHandoverResource/)
  assert.match(source, /getKeyHandoverPdfResource/)
  assert.match(source, /getAssignmentLetterResource/)
  assert.match(source, /getAssignmentLetterPdfResource/)
  assert.match(source, /postAssignmentLetterPdfResource/)
  assert.match(source, /patchAssignmentLetterPdfResource/)
  assert.match(source, /resource === "key-handover"/)
  assert.match(source, /resource === "key-handover-pdf"/)
  assert.match(source, /resource === "surat-tugas"/)
  assert.match(source, /resource === "surat-tugas-pdf"/)
})

test("PDF fallback URL remains frameable by the same-origin CSP policy", async () => {
  const pdfRoute = await read("app/api/transactions/replenish/[id]/surat-tugas/pdf/route.js")
  const proxy = await read("proxy.js")

  assert.match(pdfRoute, /currentUrl\.searchParams\.get\("resource"\) === "surat-tugas-pdf"/)
  assert.match(pdfRoute, /fallbackUrl\.searchParams\.set\("resource", "surat-tugas-pdf"\)/)
  assert.match(proxy, /\["surat-tugas-pdf", "key-handover-pdf"\]\.includes\(searchParams\?\.get\("resource"\)\)/)
  assert.match(proxy, /isReplenishPdfRoute\(pathname, request\.nextUrl\.searchParams\)/)
})
