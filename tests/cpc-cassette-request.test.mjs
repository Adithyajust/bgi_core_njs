import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

async function read(relativePath) {
  return fs.readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
}

function stripTsqlLiteralsAndComments(sqlText) {
  let result = ""
  let index = 0
  let state = "normal"

  while (index < sqlText.length) {
    const char = sqlText[index]
    const next = sqlText[index + 1] || ""

    if (state === "normal") {
      if (char === "'") {
        result += " "
        state = "string"
        index += 1
        continue
      }
      if (char === "-" && next === "-") {
        result += "  "
        state = "line-comment"
        index += 2
        continue
      }
      if (char === "/" && next === "*") {
        result += "  "
        state = "block-comment"
        index += 2
        continue
      }

      result += char
      index += 1
      continue
    }

    if (state === "string") {
      if (char === "'" && next === "'") {
        result += "  "
        index += 2
        continue
      }
      if (char === "'") {
        result += " "
        state = "normal"
        index += 1
        continue
      }

      result += char === "\n" ? "\n" : " "
      index += 1
      continue
    }

    if (state === "line-comment") {
      if (char === "\n") {
        result += "\n"
        state = "normal"
      } else {
        result += " "
      }
      index += 1
      continue
    }

    if (char === "*" && next === "/") {
      result += "  "
      state = "normal"
      index += 2
      continue
    }

    result += char === "\n" ? "\n" : " "
    index += 1
  }

  return result
}

test("CPC page follows the existing menu permission and App Router structure", async () => {
  const layout = await read("app/transaksi_cpc/layout.jsx")
  const page = await read("app/transaksi_cpc/page.jsx")
  const routes = await read("lib/routes.js")

  assert.match(layout, /AccessGuard menuHref="\/transaksi_cpc"/)
  assert.match(page, /useAppBootstrap\(\)/)
  assert.match(page, /permissions\?\.\[CPC_MENU_HREF\]/)
  assert.match(page, /Permintaan Kaset &amp; Lembar Uang/)
  assert.match(page, /\/api\/transactions\/cpc/)
  assert.match(routes, /path: "\/transaksi_cpc"/)
})

test("CPC queue contains packing approval lifecycle without changing the existing entry statuses", async () => {
  const constants = await read("modules/cpc/constants.js")
  const database = await read("modules/cpc/database.js")

  for (const status of [
    "DISETUJUI",
    "MENUNGGU_VALIDASI_KASET",
    "KASET_DALAM_PERSIAPAN",
    "MENUNGGU_APPROVAL_CPC",
    "KASET_SIAP",
  ]) {
    assert.match(constants, new RegExp(status))
    assert.match(database, new RegExp(status))
  }

  assert.match(constants, /CPC_RECEIVE_REQUEST/)
  assert.match(constants, /CPC_START_PREPARATION/)
  assert.match(constants, /CPC_SUBMIT_APPROVAL/)
  assert.match(constants, /CPC_APPROVE_PACKING/)
  assert.match(constants, /CPC_REJECT_PACKING/)
})

test("CPC demand reuses immutable replenish point calculations and fixes every cassette at 2000 sheets", async () => {
  const database = await read("modules/cpc/database.js")
  const page = await read("app/transaksi_cpc/page.jsx")
  const sparePage = await read("app/spare_kaset/page.jsx")
  const constants = await read("modules/cpc/constants.js")

  assert.match(database, /point\.pagu/)
  assert.match(database, /point\.required_cassettes/)
  assert.match(database, /wo\.total_requested_amount/)
  assert.match(constants, /CPC_PACKING_SHEETS_PER_CASSETTE = 2000/)
  assert.match(page, /Setiap kaset berisi tepat/)
  assert.match(sparePage, /Form Sortir ke Kaset/)
  assert.match(sparePage, /segel karet/i)
  assert.doesNotMatch(page, /<input[^>]+requested_amount/i)
})

test("CPC lifecycle mutation is server locked, scoped, auditable, and recorded in status history", async () => {
  const route = await read("app/api/transactions/cpc/[id]/route.js")

  assert.match(route, /authorizeApiRequest\(request, CPC_MENU_HREF, "update"\)/)
  assert.match(route, /getUserDataScope/)
  assert.match(route, /getLockedCpcWorkOrder/)
  assert.match(route, /sql\.Binary\(8\)/)
  assert.match(route, /AND row_version = @rowVersion/)
  assert.match(route, /INSERT INTO dbo\.replenish_status_history/)
  assert.match(route, /insertAuditLog\(transaction/)
  assert.match(route, /module: "transactions\.cpc"/)
  assert.match(route, /SERVER_LOCKED_CPC_V2/)
})

test("packing form persists cassette serial and globally unique seal scans", async () => {
  const migration = await read("scripts/migrations/039-cpc-cassette-packing-and-approval.sql")
  const route = await read("app/api/transactions/cpc/[id]/packing/route.js")
  const database = await read("modules/cpc/database.js")

  assert.match(migration, /CREATE TABLE dbo\.cpc_packing_batches/)
  assert.match(migration, /CREATE TABLE dbo\.cpc_packing_cassettes/)
  assert.match(migration, /sheets_count = 2000/)
  assert.match(migration, /CREATE UNIQUE INDEX UX_cpc_packing_cassettes_seal_no/)
  assert.match(route, /cassette_serial/)
  assert.match(route, /seal_no/)
  assert.match(route, /CPC_SAVE_PACKING/)
  assert.match(route, /status !== "KASET_DALAM_PERSIAPAN"/)
  assert.match(database, /ensureCpcPackingBatch/)
  assert.match(database, /numbers\.n <= ISNULL\(point\.required_cassettes, 0\)/)
})

test("spare cassette inventory lets CPC choose a supported denomination, fixes 2000 sheets, and preserves denomination-only RPL allocation", async () => {
  const migration = await read("scripts/migrations/049-cpc-spare-cassette-inventory.sql")
  const menuMigration = await read("scripts/migrations/050-spare-cassette-menu.sql")
  const emptyPlaceholderMigration = await read("scripts/migrations/051-empty-spare-cassette-placeholders.sql")
  const flexibleDenominationMigration = await read("scripts/migrations/052-flexible-spare-cassette-denomination.sql")
  const constants = await read("modules/cpc/constants.js")
  const spareRoute = await read("app/api/transactions/cpc/spare-cassettes/route.js")
  const packingRoute = await read("app/api/transactions/cpc/[id]/packing/route.js")
  const database = await read("modules/cpc/database.js")
  const cpcPage = await read("app/transaksi_cpc/page.jsx")
  const sparePage = await read("app/spare_kaset/page.jsx")
  const spareLayout = await read("app/spare_kaset/layout.jsx")
  const spareStyles = await read("app/spare_kaset/spare-kaset.css")
  const routes = await read("lib/routes.js")

  assert.match(constants, /CPC_SPARE_CASSETTE_DENOMINATIONS = Object\.freeze\(\[50000, 100000\]\)/)
  assert.doesNotMatch(constants, /CPC_SPARE_CASSETTE_PLAN/)
  assert.match(constants, /CPC_SPARE_CASSETTE_MENU_HREF = "\/spare_kaset"/)
  assert.match(migration, /CREATE TABLE dbo\.cpc_spare_cassettes/)
  assert.match(migration, /CK_cpc_spare_cassettes_serial_denom/)
  assert.match(migration, /sheets_count = 2000/)
  assert.match(migration, /rubber_seal_no VARCHAR\(100\)/)
  assert.match(migration, /prepared_by INT/)
  assert.match(migration, /allocated_packing_cassette_id BIGINT/)
  assert.match(migration, /CREATE TABLE dbo\.cpc_spare_cassette_history/)
  assert.match(migration, /ALTER TABLE dbo\.cpc_packing_cassettes ADD spare_cassette_id BIGINT NULL/)
  assert.match(migration, /sys\.sp_executesql/)
  assert.match(flexibleDenominationMigration, /DROP CONSTRAINT CK_cpc_spare_cassettes_serial_denom/)
  assert.match(flexibleDenominationMigration, /CK_cpc_spare_cassettes_denomination/)
  assert.match(flexibleDenominationMigration, /denomination_value IN \(50000, 100000\)/)
  assert.match(flexibleDenominationMigration, /sys\.sp_executesql/)

  const outerSpareMigrationBatch = stripTsqlLiteralsAndComments(migration)
  assert.doesNotMatch(
    outerSpareMigrationBatch,
    /\b(?:spare_assigned_by|spare_assigned_at|UX_cpc_packing_cassettes_spare|FK_cpc_packing_cassettes_spare)\b/i,
    "Kolom spare baru tidak boleh direferensikan langsung di outer batch migration SQL Server."
  )

  assert.match(spareRoute, /CPC_PREPARE_SPARE_CASSETTE/)
  assert.match(spareRoute, /authorizeApiRequest\(request, CPC_SPARE_CASSETTE_MENU_HREF, "view"\)/)
  assert.match(spareRoute, /authorizeApiRequest\(request, CPC_SPARE_CASSETTE_MENU_HREF, "update"\)/)
  assert.match(spareRoute, /status = 'READY'/)
  assert.match(spareRoute, /INSERT INTO dbo\.cpc_spare_cassettes/)
  assert.match(spareRoute, /VALUES[\s\S]*\(@cassetteSerial, @denominationValue, @sheetsCount, 'KOSONG'\)/)
  assert.match(spareRoute, /const denominationValue = Number\(body\?\.denomination_value\)/)
  assert.match(spareRoute, /ALLOWED_DENOMINATIONS\.has\(denominationValue\)/)
  assert.match(spareRoute, /prepared_by = @userId/)
  assert.match(spareRoute, /Nomor segel karet wajib discan/)
  assert.doesNotMatch(spareRoute, /PLAN_BY_SERIAL|CPC_SPARE_CASSETTE_PLAN/)
  assert.match(database, /listCpcSpareCassettes/)
  assert.match(database, /prepared_by_name/)

  assert.match(packingRoute, /resolveSpareCassetteSelections/)
  assert.match(packingRoute, /Number\(spare\.denomination_value\) !== Number\(item\.denominationValue\)/)
  assert.match(packingRoute, /status = 'ALLOCATED'/)
  assert.match(packingRoute, /spare_assigned_by/)
  assert.match(cpcPage, /availableSpareCassettesForPackingItem/)
  assert.match(cpcPage, /Scan \/ cari kaset denom/)
  assert.match(cpcPage, /spareMatchesScanCode/)
  assert.doesNotMatch(cpcPage, /cpc-spare-select|updatePackingSpareSelection/)
  assert.match(cpcPage, /spare_cassette_id: item\.spare_cassette_id \|\| null/)
  assert.doesNotMatch(cpcPage, /Form Spare Kaset \/ Sortir ke Kaset/)

  assert.match(spareLayout, /AccessGuard menuHref=\{CPC_SPARE_CASSETTE_MENU_HREF\}/)
  assert.match(sparePage, /import "\.\/spare-kaset\.css"/)
  assert.doesNotMatch(spareLayout, /spare-kaset\.css/)
  assert.match(sparePage, /spare-cassette-page/)
  assert.match(sparePage, /data-spare-layout-version="17"/)
  assert.match(spareStyles, /\.spare-cassette-page \.cpc-spare-create-grid/)
  assert.match(spareStyles, /\.spare-cassette-page \.cpc-spare-table/)
  assert.match(spareStyles, /@media \(max-width: 820px\)/)
  assert.match(sparePage, /<h2>Spare Kaset<\/h2>/)
  assert.match(sparePage, /Form Sortir ke Kaset/)
  assert.match(sparePage, /SPARE_CASSETTE_DENOMINATIONS = Object\.freeze\(\[50000, 100000\]\)/)
  assert.doesNotMatch(sparePage, /CPC_SPARE_CASSETTE_DENOMINATIONS\.map/)
  assert.match(sparePage, /Pilih Denom/)
  assert.match(sparePage, /newDenominationValue/)
  assert.match(sparePage, /denomination_value: Number\(denominationValue\)/)
  assert.match(sparePage, /Input Spare Kaset dari Nol/)
  assert.match(sparePage, /addCassetteFromZero/)
  assert.doesNotMatch(sparePage, /Denom Otomatis|CST0000011–CST0000014|CST0000015–CST0000018/)
  assert.match(sparePage, /Tabel masih kosong/)
  assert.match(emptyPlaceholderMigration, /DELETE spare[\s\S]*spare\.status = 'KOSONG'/)
  assert.match(emptyPlaceholderMigration, /NOT EXISTS[\s\S]*cpc_spare_cassette_history/)
  assert.match(emptyPlaceholderMigration, /NOT EXISTS[\s\S]*cpc_packing_cassettes/)
  assert.doesNotMatch(emptyPlaceholderMigration, /DELETE[\s\S]*status = 'READY'/)
  assert.doesNotMatch(emptyPlaceholderMigration, /DELETE[\s\S]*status = 'ALLOCATED'/)
  assert.match(menuMigration, /'Spare Kaset'[\s\S]*'\/spare_kaset'[\s\S]*'IconTransfer'/)
  assert.match(menuMigration, /route\.href = '\/transaksi_cpc'/)
  assert.match(menuMigration, /LIKE '%CPC%'/)
  assert.match(routes, /path: "\/spare_kaset"/)
})

test("packing approval is maker-checker controlled by Asisten Manager CPC", async () => {
  const authorization = await import(new URL("../modules/cpc/authorization.js", import.meta.url))
  const route = await read("app/api/transactions/cpc/[id]/route.js")

  assert.equal(authorization.isCpcPackingApprover({ pegawai: { jabatan: "Asisten Manager CPC" } }), true)
  assert.equal(authorization.isCpcPackingApprover({ roleCode: "ASISTEN_MANAGER_CPC" }), true)
  assert.equal(authorization.isCpcPackingApprover({ roleCode: "CPC" }), false)
  assert.match(route, /Packing hanya dapat dilakukan oleh Asisten Manager CPC|Approval packing hanya dapat dilakukan oleh Asisten Manager CPC/)
  assert.match(route, /Petugas yang mengajukan packing tidak boleh menyetujui packing yang sama/)
  assert.match(route, /packing\.summary\.all_complete/)
})

test("approved CPC packing exposes printable ATM Blotter Transaction PDF", async () => {
  const page = await read("app/transaksi_cpc/page.jsx")
  const route = await read("app/api/transactions/cpc/[id]/blotter/route.js")
  const pdf = await read("modules/cpc/blotter-pdf.js")

  assert.match(page, /Cetak Blotter/)
  assert.match(page, /\/api\/transactions\/cpc\/\$\{detail\.id\}\/blotter/)
  assert.match(route, /Content-Type": "application\/pdf"/)
  assert.match(route, /detail\.status !== "KASET_SIAP"/)
  assert.match(pdf, /FORM ATM BLOTTER TRANSACTION/)
  assert.match(pdf, /ACTUAL CASH COUNTED RETURNED CASSETTE/)
  assert.match(pdf, /RECAPITULATION MONEY JAM/)
  assert.match(pdf, /BILL COUNT/)
  assert.match(pdf, /BG-KLY-FRM-004-02/)
})

test("CPC list uses cursor pagination and unit-work scope", async () => {
  const route = await read("app/api/transactions/cpc/route.js")
  const database = await read("modules/cpc/database.js")

  assert.match(route, /after_id/)
  assert.match(route, /getUserDataScope/)
  assert.match(database, /wo\.id < @afterId/)
  assert.match(database, /@scopeUkerId IS NULL OR wo\.uker_id = @scopeUkerId/)
  assert.doesNotMatch(database, /\bOFFSET\b/i)
})

test("approved packing continues to cassette handover verification before ready-to-depart", async () => {
  const constants = await read("modules/cpc/constants.js")
  const route = await read("app/api/transactions/cpc/[id]/route.js")
  const handoverRoute = await read("app/api/transactions/cpc/[id]/handover/route.js")
  const database = await read("modules/cpc/database.js")

  assert.match(constants, /CPC_COMPLETE_CASSETTE_HANDOVER/)
  assert.match(constants, /from: "KASET_SIAP"[\s\S]*to: "SIAP_BERANGKAT"/)
  assert.match(route, /getLockedCpcCassetteHandover/)
  assert.match(route, /handover\.summary\.all_verified/)
  assert.match(route, /NIP yang diverifikasi tidak sesuai dengan Custody/)
  assert.match(handoverRoute, /Scan serah terima hanya dapat dilakukan saat status KASET_SIAP/)
  assert.match(handoverRoute, /scannedSealNo !== String\(expected\.expected_seal_no/)
  assert.match(handoverRoute, /CPC_SAVE_CASSETTE_HANDOVER_SCAN/)
  assert.match(database, /ensureCpcCassetteHandover/)
  assert.match(database, /getCpcCassetteHandoverSnapshot/)
  assert.doesNotMatch(database, /DECLARE @custodyEmployeeId INT/)
  assert.match(database, /SELECT TOP \(1\)[\s\S]*employee_id[\s\S]*member_role = 'CUSTODY'/)
})

test("cassette handover schema snapshots custody and verifies each approved packing seal", async () => {
  const migration = await read("scripts/migrations/040-cpc-cassette-handover.sql")
  const page = await read("app/transaksi_cpc/page.jsx")

  assert.match(migration, /CREATE TABLE dbo\.cpc_cassette_handovers/)
  assert.match(migration, /CREATE TABLE dbo\.cpc_cassette_handover_items/)
  assert.match(migration, /expected_seal_no VARCHAR\(100\) NOT NULL/)
  assert.match(migration, /recipient_nip_snapshot/)
  assert.match(migration, /custody_employee_id/)
  assert.match(migration, /@pegawaiIdType/)
  assert.match(migration, /ALTER TABLE dbo\.cpc_cassette_handovers ADD custody_employee_id/)
  assert.doesNotMatch(migration, /custody_employee_id INT NOT NULL/)
  assert.match(page, /Serah Terima Kaset CPC → Custody/)
  assert.match(page, /Scan Segel Keluar CPC/)
  assert.match(page, /Verifikasi NIP Custody penerima/)
  assert.match(page, /Simpan Scan Serah Terima/)
})

test("Blotter remains reprintable after cassette handover is completed", async () => {
  const route = await read("app/api/transactions/cpc/[id]/blotter/route.js")
  assert.match(route, /detail\.status !== "KASET_SIAP"/)
  assert.match(route, /detail\.status !== "SIAP_BERANGKAT"/)
})


test("receiving a CPC request immediately opens the cassette and seal scan packing flow", async () => {
  const constants = await read("modules/cpc/constants.js")
  const route = await read("app/api/transactions/cpc/[id]/route.js")
  const page = await read("app/transaksi_cpc/page.jsx")

  assert.match(constants, /CPC_RECEIVE_REQUEST[\s\S]*from: "DISETUJUI"[\s\S]*to: "KASET_DALAM_PERSIAPAN"/)
  assert.match(route, /\[CPC_ACTIONS\.RECEIVE_REQUEST, CPC_ACTIONS\.START_PREPARATION\]\.includes\(action\)/)
  assert.match(route, /ensureCpcPackingBatch\(transaction, workOrderId, authorization\.user\.id\)/)
  assert.match(page, /action === CPC_ACTIONS\.RECEIVE_REQUEST[\s\S]*setDetailOpen\(true\)[\s\S]*applyDetailResult\(result\)/)
  assert.match(page, /Kaset Harus Disiapkan/)
  assert.match(page, /Seal Harus Discan/)
  assert.match(page, /Sisa Scan Seal/)
  assert.match(constants, /Ajukan ke Asisten Manager CPC/)
})

test("Blotter stays locked until ASISTEN_MANAGER_CPC approval", async () => {
  const page = await read("app/transaksi_cpc/page.jsx")
  const blotterRoute = await read("app/api/transactions/cpc/[id]/blotter/route.js")

  assert.match(page, /Blotter baru dapat dicetak setelah approval/)
  assert.match(page, /Blotter akan terbuka setelah approval ASISTEN_MANAGER_CPC/)
  assert.match(blotterRoute, /detail\.cpc_packing\?\.batch\?\.status !== "DISETUJUI"/)
})

test("CPC packing extension creates one reject cassette Rp0 and two bag seals per TID without changing cash cassette constraints", async () => {
  const migration = await read("scripts/migrations/041-cpc-packing-per-tid-reject-and-bag-seals.sql")
  const database = await read("modules/cpc/database.js")
  const packingRoute = await read("app/api/transactions/cpc/[id]/packing/route.js")
  const page = await read("app/transaksi_cpc/page.jsx")

  assert.match(migration, /CREATE TABLE dbo\.cpc_packing_tid_assets/)
  assert.match(migration, /reject_denomination_value DECIMAL\(19,2\) NOT NULL/)
  assert.match(migration, /CHECK \(reject_denomination_value = 0\)/)
  assert.match(migration, /CHECK \(reject_sheets_count = 0\)/)
  assert.match(migration, /departure_bag_seal_no VARCHAR\(100\)/)
  assert.match(migration, /return_bag_seal_no VARCHAR\(100\)/)
  assert.match(migration, /UNIQUE \(batch_id, work_order_point_id\)/)

  assert.match(database, /INSERT INTO dbo\.cpc_packing_tid_assets/)
  assert.match(database, /tid_assets: tidAssets/)
  assert.match(database, /expected_reject_cassettes: tidAssets\.length/)
  assert.match(database, /expected_bag_seals: tidAssets\.length \* 2/)
  assert.match(database, /completed_tids: completedTids/)

  assert.match(packingRoute, /body\?\.tid_assets/)
  assert.match(packingRoute, /reject_cassette_serial/)
  assert.match(packingRoute, /departure_bag_seal_no/)
  assert.match(packingRoute, /return_bag_seal_no/)
  assert.match(packingRoute, /sys\.sp_getapplock/)
  assert.match(packingRoute, /Nomor segel .*sudah digunakan pada packing CPC lain/)

  assert.match(page, /Packing Kaset &amp; Scan Segel per TID/)
  assert.match(page, /Kaset Reject/)
  assert.match(page, /Segel Bag Berangkat/)
  assert.match(page, /Segel Bag Kembali/)
  assert.match(page, /formatCurrency\(0\)/)
})

test("CPC approval requires the per-TID extension and keeps maker-checker separation", async () => {
  const route = await read("app/api/transactions/cpc/[id]/route.js")

  assert.match(route, /action === CPC_ACTIONS\.SUBMIT_APPROVAL[\s\S]*ensureCpcPackingBatch/)
  assert.match(route, /packing\.summary\.(completed_tids|packing_complete_tids)/)
  assert.match(route, /packing\.summary\.expected_tids/)
  assert.match(route, /packing\.tid_assets\.some/)
  assert.match(route, /menyiapkan kaset reject/)
})

test("CPC Blotter maps the per-TID reject cassette into the existing DIVERT row", async () => {
  const pdf = await read("modules/cpc/blotter-pdf.js")

  assert.match(pdf, /cassette: "DIVERT"/)
  assert.match(pdf, /tidAsset\?\.reject_cassette_serial/)
  assert.match(pdf, /const tidAssets = new Map\(\)/)
  assert.match(pdf, /packing\.tid_assets/)
})

test("CPC packing keeps per-TID audit state but enforces one exclusive operator per Work Order", async () => {
  const tidMigration = await read("scripts/migrations/042-cpc-packing-tid-assignment.sql")
  const workOrderMigration = await read("scripts/migrations/043-cpc-exclusive-work-order-packing-claim.sql")
  const database = await read("modules/cpc/database.js")
  const assignmentRoute = await read("app/api/transactions/cpc/[id]/packing/assignment/route.js")

  assert.match(tidMigration, /assigned_to INT NULL/)
  assert.match(tidMigration, /assignment_status VARCHAR\(20\)/)
  assert.match(tidMigration, /started_by INT NULL/)
  assert.match(tidMigration, /completed_by INT NULL/)
  assert.match(tidMigration, /UNASSIGNED.*ASSIGNED.*IN_PROGRESS.*PACKING_COMPLETE/s)
  assert.match(tidMigration, /FK_cpc_packing_tid_assets_assigned_to/)
  assert.match(tidMigration, /IX_cpc_packing_tid_assets_assignment/)
  assert.match(tidMigration, /sys\.sp_executesql/)

  const outerTidMigrationBatch = stripTsqlLiteralsAndComments(tidMigration)
  assert.doesNotMatch(
    outerTidMigrationBatch,
    /\b(?:assigned_to|assigned_at|assignment_status|started_by|started_at|completed_by|completed_at)\b/i,
    "Kolom assignment baru tidak boleh direferensikan langsung di outer batch migration SQL Server."
  )

  assert.match(workOrderMigration, /packing_owner_user_id INT NULL/)
  assert.match(workOrderMigration, /packing_claimed_at DATETIME2\(0\) NULL/)
  assert.match(workOrderMigration, /FK_cpc_packing_batches_packing_owner/)
  assert.match(workOrderMigration, /IX_cpc_packing_batches_owner/)
  assert.match(workOrderMigration, /exclusive claim packing CPC per Work Order/i)
  assert.match(workOrderMigration, /COUNT\(DISTINCT asset\.assigned_to\)/)

  assert.match(database, /packing_owner\.full_name AS packing_owner_name/)
  assert.match(database, /claimCpcPackingWorkOrder/)
  assert.match(database, /transferCpcPackingWorkOrder/)
  assert.match(database, /releaseCpcPackingWorkOrder/)
  assert.match(database, /WITH \(UPDLOCK, HOLDLOCK\)/)
  assert.match(database, /packing_owner_user_id = @userId/)
  assert.match(database, /WHERE asset\.batch_id = @batchId/)

  assert.match(assignmentRoute, /CPC_PACKING_ASSIGNMENT_ACTIONS\.CLAIM/)
  assert.match(assignmentRoute, /CPC_PACKING_ASSIGNMENT_ACTIONS\.RELEASE/)
  assert.match(assignmentRoute, /CPC_PACKING_ASSIGNMENT_ACTIONS\.ASSIGN/)
  assert.match(assignmentRoute, /Pilih Work Order lain/)
  assert.match(assignmentRoute, /CPC_CLAIM_PACKING_WORK_ORDER/)
  assert.match(assignmentRoute, /CPC_ASSIGN_PACKING_WORK_ORDER/)
  assert.match(assignmentRoute, /CPC_RELEASE_PACKING_WORK_ORDER/)
  assert.match(assignmentRoute, /assignment_scope: "WORK_ORDER"/)
})

test("CPC packing save authorizes at exclusive Work Order owner level and tolerates stale per-TID assignment snapshots", async () => {
  const route = await read("app/api/transactions/cpc/[id]/packing/route.js")
  const page = await read("app/transaksi_cpc/page.jsx")

  assert.match(route, /claimCpcPackingWorkOrder/)
  assert.match(route, /if \(!claim\?\.isOwner\)/)
  assert.match(route, /Otorisasi edit berada di level owner Work Order/)
  assert.doesNotMatch(route, /expected\.assigned_to/)
  assert.doesNotMatch(route, /AND asset\.assigned_to = @userId/)
  assert.match(route, /selectedPointIds/)
  assert.match(route, /validateProspectiveCodes/)
  assert.match(route, /assignment_status = CASE/)
  assert.match(route, /THEN 'PACKING_COMPLETE'/)
  assert.match(route, /ELSE 'IN_PROGRESS'/)
  assert.match(route, /completed_by = CASE/)
  assert.match(route, /work_order_point_ids:/)

  assert.match(page, /legacyMyPackingGroups/)
  assert.match(page, /packingOwnerIsMe \? packingGroups : legacyMyPackingGroups/)
  assert.match(page, /validDirtyPointSet/)
  assert.match(page, /fallback aman adalah/)
  assert.doesNotMatch(page, /Tidak ada perubahan pada TID yang menjadi assignment Anda/)
})

test("CPC UI exposes exclusive Work Order claim, owner lock, and supervisor reassignment", async () => {
  const page = await read("app/transaksi_cpc/page.jsx")
  const detailRoute = await read("app/api/transactions/cpc/[id]/route.js")

  assert.match(page, /Packing Saya/)
  assert.match(page, /Belum Diambil/)
  assert.match(page, /Ambil Job/)
  assert.match(page, /Kembalikan Job/)
  assert.match(page, /Alihkan Job/)
  assert.match(page, /job packing .* sedang dikerjakan/i)
  assert.match(page, /pilih Work Order lain untuk melakukan scan packing/i)
  assert.match(page, /assignedToMe/)
  assert.match(page, /editable = [\s\S]*detailCapabilities\.can_edit_packing[\s\S]*assignedToMe/)
  assert.match(page, /\/packing\/assignment/)
  assert.match(page, /Simpan Packing Saya/)
  assert.match(detailRoute, /can_manage_packing_assignments/)
  assert.match(detailRoute, /can_claim_packing_work_order/)
  assert.match(detailRoute, /can_edit_packing/)
  assert.match(detailRoute, /packing_owner_is_me/)
  assert.match(detailRoute, /packing_operators/)
  assert.match(detailRoute, /packing_complete_tids !== packing\.summary\.expected_tids/)
})

test("CPC operator can hold only one active Work Order until packing is submitted", async () => {
  const database = await read("modules/cpc/database.js")
  const route = await read("app/api/transactions/cpc/[id]/route.js")
  const listRoute = await read("app/api/transactions/cpc/route.js")
  const assignmentRoute = await read("app/api/transactions/cpc/[id]/packing/assignment/route.js")
  const packingRoute = await read("app/api/transactions/cpc/[id]/packing/route.js")
  const page = await read("app/transaksi_cpc/page.jsx")

  assert.match(database, /acquireCpcPackingOperatorLock/)
  assert.match(database, /getActiveCpcPackingWorkOrderForUser/)
  assert.match(database, /cpc-packing-user:/)
  assert.match(database, /sys\.sp_getapplock/)
  assert.match(database, /other_wo\.status = 'KASET_DALAM_PERSIAPAN'/)
  assert.match(database, /Anda masih mengerjakan .*Selesaikan dan ajukan job tersebut sebelum mengambil Work Order lain/s)
  assert.match(database, /Petugas tujuan masih mengerjakan .*sebelum menerima pengalihan Work Order lain/s)

  assert.match(route, /acquireCpcPackingOperatorLock\(transaction, authorization\.user\.id\)/)
  assert.match(route, /packing_owner_user_id = NULL/)
  assert.match(route, /packing_claimed_at = NULL/)
  assert.match(route, /active_packing_work_order_id/)
  assert.match(route, /active_packing_work_order_no/)
  assert.match(route, /54314, 54315, 54316/)

  assert.match(listRoute, /active_packing_job/)
  assert.match(listRoute, /getActiveCpcPackingWorkOrderForUser/)
  assert.match(assignmentRoute, /acquireCpcPackingOperatorLock\(transaction, lockUserId\)/)
  assert.match(assignmentRoute, /active_packing_work_order_no/)
  assert.match(packingRoute, /acquireCpcPackingOperatorLock\(transaction, authorization\.user\.id\)/)
  assert.match(packingRoute, /active_packing_work_order_no/)

  assert.match(page, /activePackingJob/)
  assert.match(page, /blockedByMyActivePackingJob/)
  assert.match(page, /Selesaikan packing dan ajukan ke Asisten Manager CPC sebelum mengambil Work Order lain/)
  assert.match(page, /disabled=\{busy \|\| blockedByMyActivePackingJob\}/)
})

test("CPC operator adds prepared spare cassettes by denomination and scans the remaining TID assets", async () => {
  const page = await read("app/transaksi_cpc/page.jsx")
  const packingRoute = await read("app/api/transactions/cpc/[id]/packing/route.js")

  assert.match(page, /FORM SCAN PACKING CPC/)
  assert.ok(
    page.indexOf("FORM SCAN PACKING CPC") < page.indexOf("Detail Kaset &amp; Lembar Uang per ATM/CRM"),
    "form scan harus tampil sebelum tabel detail kaset agar langsung terlihat operator",
  )
  assert.match(page, /Scan Spare Kaset Sesuai Denom/)
  assert.match(page, /SCAN \/ KETIK LABEL ATAU SEGEL/)
  assert.match(page, /handlePackingSpareScanChange/)
  assert.match(page, /handlePackingSpareScanEnter/)
  assert.match(page, /data-spare-scan-item-id/)
  assert.match(page, /spare\?\.rubber_seal_no/)
  assert.match(page, /Denom .* tidak sesuai kebutuhan/)
  assert.match(page, /autocompleteSpareCassettesForPackingItem/)
  assert.match(page, /selectPackingSpareFromAutocomplete/)
  assert.match(page, /role="combobox"/)
  assert.match(page, /aria-autocomplete="list"/)
  assert.match(page, /role="listbox"/)
  assert.match(page, /role="option"/)
  assert.match(page, /Pilihan Spare Kaset/)
  assert.match(page, /Ketik label, segel, atau nama petugas/)
  assert.match(page, /autocompleteSpares\.map/)
  assert.match(page, /Segel \{spare\.rubber_seal_no\}/)
  assert.match(page, /spare\.prepared_by_name/)
  assert.doesNotMatch(page, /cpc-spare-availability|Spare Kaset yang Dapat Discan/)
  assert.doesNotMatch(page, /cpc-spare-select|updatePackingSpareSelection/)
  assert.match(page, /SCAN KASET REJECT/)
  assert.match(page, /SCAN SEGEL BAG BERANGKAT/)
  assert.match(page, /SCAN SEGEL BAG KEMBALI/)
  assert.match(page, /data-cpc-quick-scan="true"/)
  assert.match(page, /focusNextPackingScan/)
  assert.match(page, /schedulePackingScanAdvance/)
  assert.match(page, /handlePackingAssetScanChange/)
  assert.match(page, /Tidak perlu menekan Enter/)
  assert.match(page, /}, 220\)/)
  assert.match(page, /Simpan Hasil Scan/)
  assert.match(page, /Selesaikan Packing & Ajukan/)
  assert.match(page, /finishPackingAndSubmit/)
  assert.match(page, /savePacking\(\{ quiet: true \}\)/)
  assert.match(page, /operatorPackingGroups/)
  assert.match(page, /packingOwnerIsMe \? packingGroups : legacyMyPackingGroups/)
  assert.match(page, /Mulai Add Spare Kaset/)
  assert.match(page, /can_claim_packing_work_order/)
  assert.match(page, /CPC_ACTIONS\.SUBMIT_APPROVAL/)

  assert.match(packingRoute, /cassette_serial/)
  assert.match(packingRoute, /seal_no/)
  assert.match(packingRoute, /reject_cassette_serial/)
  assert.match(packingRoute, /departure_bag_seal_no/)
  assert.match(packingRoute, /return_bag_seal_no/)
  assert.match(packingRoute, /Nomor segel .*sudah digunakan pada packing CPC lain/)
})

test("CPC quick scan dropdown hides TID after packing is confirmed complete by the server", async () => {
  const page = await read("app/transaksi_cpc/page.jsx")

  assert.match(page, /const pendingPackingScanGroups = operatorPackingGroups\.filter/)
  assert.match(page, /assignment_status[\s\S]*PACKING_COMPLETE/)
  assert.match(page, /pendingPackingScanGroups\.map/)
  assert.match(page, /applyDetailResult\(result\)\s+setPackingScanPointId\(""\)/)
  assert.match(page, /Semua TID sudah lengkap dan tersimpan/)
})

test("CPC packing save rejects duplicate codes across every cassette and seal field", async () => {
  const page = await read("app/transaksi_cpc/page.jsx")
  const packingRoute = await read("app/api/transactions/cpc/[id]/packing/route.js")

  assert.match(page, /const duplicatePackingCodes = useMemo/)
  assert.match(page, /register\(item\.cassette_serial\)[\s\S]*register\(item\.seal_no\)/)
  assert.match(page, /register\(asset\.reject_cassette_serial\)/)
  assert.match(page, /register\(asset\.reject_cassette_seal_no\)/)
  assert.match(page, /register\(asset\.departure_bag_seal_no\)/)
  assert.match(page, /register\(asset\.return_bag_seal_no\)/)
  assert.match(page, /Kode packing tidak boleh sama/)
  assert.match(page, /duplicatePackingCodes\.size > 0/)

  assert.match(packingRoute, /const seenCodes = new Map\(\)/)
  assert.match(packingRoute, /registerUniqueCode\(seenCodes, serial, `Kaset Uang/)
  assert.match(packingRoute, /registerUniqueCode\(seenCodes, seal, `Segel Kaset Uang/)
  assert.match(packingRoute, /registerUniqueCode\(seenCodes, rejectSerial, `Kaset Reject/)
  assert.match(packingRoute, /registerUniqueCode\(seenCodes, rejectSeal, `Segel Kaset Reject/)
  assert.match(packingRoute, /registerUniqueCode\(seenCodes, departureSeal, `Segel BAG Berangkat/)
  assert.match(packingRoute, /registerUniqueCode\(seenCodes, returnSeal, `Segel BAG Kembali/)
  assert.match(packingRoute, /tidak boleh sama antara/)
  assert.doesNotMatch(packingRoute, /seenSerials|seenSeals/)
})


test("CPC quick scan enforces sequential cassette pairs and records a seal for the reject cassette", async () => {
  const migration = await read("scripts/migrations/044-cpc-reject-cassette-seal.sql")
  const database = await read("modules/cpc/database.js")
  const packingRoute = await read("app/api/transactions/cpc/[id]/packing/route.js")
  const page = await read("app/transaksi_cpc/page.jsx")
  const pdf = await read("modules/cpc/blotter-pdf.js")

  assert.match(migration, /reject_cassette_seal_no VARCHAR\(100\)/)
  assert.match(migration, /UX_cpc_packing_tid_assets_reject_seal/)
  assert.match(database, /asset\.reject_cassette_seal_no/)
  assert.match(database, /expected_reject_cassette_seals: tidAssets\.length/)
  assert.match(database, /completed_reject_cassette_seals: completedRejectSeals/)
  assert.match(packingRoute, /rejectCassetteSealNo/)
  assert.match(packingRoute, /Serial kaset reject wajib discan sebelum segel kaset reject/)
  assert.match(packingRoute, /Selesaikan scan kaset dan segel kaset sebelumnya/)
  assert.match(packingRoute, /Selesaikan seluruh scan kaset uang dan segel kaset pada TID sebelum memproses Kaset Reject/)
  assert.match(page, /Scan Segel Kaset Reject/)
  assert.match(page, /reject_cassette_seal_no/)
  assert.match(page, /disabled=\{packingSaving \|\| actionLoading \|\| !previousComplete\}/)
  assert.match(page, /SCAN \/ KETIK LABEL ATAU SEGEL/)
  assert.match(page, /disabled=\{packingSaving \|\| actionLoading \|\| !cashSequenceComplete\}/)
  assert.match(page, /disabled=\{packingSaving \|\| actionLoading \|\| !rejectSerial\}/)
  assert.match(page, /disabled=\{packingSaving \|\| actionLoading \|\| !rejectSerial \|\| !rejectSeal\}/)
  assert.match(page, /disabled=\{packingSaving \|\| actionLoading \|\| !departureSeal\}/)
  assert.match(pdf, /seal: tidAsset\?\.reject_cassette_seal_no/)
})
