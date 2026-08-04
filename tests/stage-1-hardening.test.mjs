import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8")

test("Pegawai and Uker lists use database pagination", async () => {
  const [pegawaiRoute, ukerRoute, pegawaiPage, ukerPage] = await Promise.all([
    read("app/api/masters/pegawai/route.js"),
    read("app/api/masters/uker/route.js"),
    read("app/masters/pegawai/page.jsx"),
    read("app/masters/uker/page.jsx"),
  ])

  for (const source of [pegawaiRoute, ukerRoute]) {
    assert.match(source, /OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY/i)
    assert.match(source, /pagination:\s*\{/)
    assert.match(source, /page_size:/)
  }

  assert.doesNotMatch(pegawaiPage, /filteredPegawai\.slice\(/)
  assert.doesNotMatch(ukerPage, /filteredUkers\.slice\(/)
  assert.match(pegawaiPage, /debouncedSearchText/)
  assert.match(ukerPage, /debouncedSearchText/)
})

test("User-role data and employee options are loaded separately", async () => {
  const [route, page] = await Promise.all([
    read("app/api/settings/user-role/route.js"),
    read("app/settings/user-role/page.jsx"),
  ])

  assert.match(route, /mode === "pegawai-options"/)
  assert.match(route, /SELECT TOP \(@limit\)/)
  assert.match(route, /OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY/i)
  assert.match(page, /fetchPegawaiOptions/)
  assert.match(page, /userModalOpen/)
})

test("Application chrome uses one bootstrap endpoint", async () => {
  const files = [
    "components/app-shell.jsx",
    "components/header.jsx",
    "components/sidebar.jsx",
    "components/navbar.jsx",
  ]
  const sources = await Promise.all(files.map(read))
  const joined = sources.join("\n")

  assert.match(sources[0], /fetch\("\/api\/bootstrap"/)
  assert.doesNotMatch(joined, /\/api\/auth\/me/)
  assert.doesNotMatch(joined, /fetch\("\/api\/navigation"/)
  assert.doesNotMatch(joined, /fetch\("\/api\/navbar"/)
  assert.match(joined, /useAppBootstrap/)
})

test("Protected master pages reuse bootstrap user identity", async () => {
  const pages = [
    "app/masters/kendaraan/page.jsx",
    "app/masters/tipe-mesin/page.jsx",
    "app/masters/cabang/page.jsx",
    "app/masters/merk/page.jsx",
    "app/masters/mesin/page.jsx",
    "app/masters/kanwil/page.jsx",
    "app/masters/uker/page.jsx",
    "app/masters/pegawai/page.jsx",
    "app/masters/project/page.jsx",
  ]

  for (const page of pages) {
    const source = await read(page)
    assert.match(source, /useAppBootstrap/)
    assert.doesNotMatch(source, /\/api\/auth\/me/)
  }
})

test("Mutable records use optimistic concurrency", async () => {
  const routes = [
    "app/api/masters/kendaraan/route.js",
    "app/api/masters/tipe-mesin/route.js",
    "app/api/masters/cabang/route.js",
    "app/api/masters/merk/route.js",
    "app/api/masters/mesin/route.js",
    "app/api/masters/kanwil/route.js",
    "app/api/masters/uker/route.js",
    "app/api/masters/pegawai/route.js",
    "app/api/masters/project/route.js",
    "app/api/settings/side-menu/route.js",
    "app/api/settings/user-role/route.js",
  ]

  for (const route of routes) {
    const source = await read(route)
    assert.match(source, /normalizeRowVersionToken/)
    assert.match(source, /row_version = @rowVersion/)
    assert.match(source, /rowsAffected|recordset\.length/)
  }

  const migration = await read("scripts/migrations/022-add-master-project-row-version.sql")
  assert.match(migration, /ALTER TABLE dbo\.master_project[\s\S]*ADD row_version ROWVERSION/i)
})

test("Private employee photos are excluded from version control", async () => {
  const [rootGitignore, privateGitignore] = await Promise.all([
    read(".gitignore"),
    read("storage/private/pegawai/.gitignore"),
  ])

  assert.match(rootGitignore, /storage\/private\/\*\*/)
  assert.match(rootGitignore, /!storage\/private\/\*\*\/\.gitignore/)
  assert.match(privateGitignore, /^\s*\*\s*$/m)
  assert.match(privateGitignore, /^\s*!\.gitignore\s*$/m)
  assert.equal(
    (await stat(path.join(root, "storage/private/pegawai/.gitignore"))).isFile(),
    true,
  )
})
