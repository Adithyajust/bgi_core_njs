"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  MACHINE_KEY_TYPES,
  findMachineKeyType,
  resolveMatrixMappingStatus,
} from "@/modules/machine-key/constants"
import {
  DEFAULT_MACHINE_KEY_MATRIX_CONFIG,
  createMachineKeyMatrixConfig,
} from "@/modules/machine-key/matrix-config"
import {
  buildMachineKeyBarcode,
  generateRandomSegment,
  normalizeBarcodeFunctionCode,
  normalizeRandomSegment,
} from "@/modules/machine-key/barcode"
import { createCode128Svg } from "@/modules/machine-key/code128"
import { createQrSvg } from "@/modules/replenish/qr-code"
import {
  buildMatrixSlotId,
  resolveMatrixSlotStatus,
} from "@/modules/machine-key/matrix"

const INITIAL_MATRIX_CONFIG = DEFAULT_MACHINE_KEY_MATRIX_CONFIG
const MACHINE_KEY_LABEL_WIDTH_MM = 25
const MACHINE_KEY_LABEL_HEIGHT_MM = 15

function createInitialSummary(matrixConfig = INITIAL_MATRIX_CONFIG) {
  return {
    total_slots: matrixConfig.totalSlots,
    total_mapped: 0,
    total_unmapped: matrixConfig.totalSlots,
    total_in: 0,
    total_out: 0,
    replenish: 0,
    flm: 0,
    backup: 0,
  }
}

const INITIAL_SUMMARY = createInitialSummary()

const INITIAL_PERMISSIONS = {
  can_create: false,
  can_update: false,
  can_delete: false,
}

const INITIAL_MATRIX_SCOPE = {
  uker_id: null,
  codeuker: null,
  nama_uker: null,
  requires_machine_selection: false,
}

const INITIAL_SYNC_STATUS = {
  available: false,
  active_machines: 0,
  unmapped_machines: 0,
  free_slots: 0,
  will_map: 0,
  reason: null,
}

function createInitialForm(overrides = {}) {
  return {
    machineId: "",
    keyType: "REPLENISH",
    functionCode: "R",
    wall: "A1",
    column: "A",
    row: "01",
    randomSegment: generateRandomSegment(),
    hasTombak: true,
    hasFascia: true,
    notes: "",
    ...overrides,
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...options,
  })
  const contentType = response.headers.get("content-type") || ""

  if (!contentType.includes("application/json")) {
    throw new Error(`Endpoint tidak mengembalikan JSON. Status ${response.status}.`)
  }

  const result = await response.json()

  if (!response.ok || !result.success) {
    throw new Error(result.message || "Permintaan gagal diproses.")
  }

  return result
}

function machineLabel(machine) {
  const identity = [machine?.tid, machine?.sn].filter(Boolean).join(" · ")
  const location = [machine?.lokasi, machine?.nama_cabang]
    .filter(Boolean)
    .join(" · ")
  return [identity, location].filter(Boolean).join(" — ")
}

function mappingMachine(mapping) {
  return {
    id: mapping.machine_id,
    tid: mapping.tid,
    sn: mapping.sn,
    lokasi: mapping.lokasi,
    nama_project: mapping.nama_project,
    nama_cabang: mapping.nama_cabang,
  }
}

function mappingTypeLabel(keyType) {
  return findMachineKeyType(keyType)?.label || keyType
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function createMachineKeyLabelDocument(label) {
  const barcode = String(label.barcode || "").trim()
  const barcodeSvg = createCode128Svg(barcode, {
    height: 36,
    showText: false,
    quietZone: 3,
    ariaLabel: `Barcode kunci mesin ${barcode}`,
  })
  const qrSvg = createQrSvg(barcode, {
    quietZone: 2,
    ariaLabel: `QR Code kunci mesin ${barcode}`,
  })
  const tid = escapeHtml(label.tid || "-")
  const serialNumber = escapeHtml(label.sn || "-")
  const position = escapeHtml(label.position || "-")
  const keyType = escapeHtml(label.keyType || "-")
  const project = escapeHtml(label.project || "-")
  const safeBarcode = escapeHtml(barcode)

  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <title>Label Sling ${safeBarcode}</title>
  <style>
    @page { size: ${MACHINE_KEY_LABEL_WIDTH_MM}mm ${MACHINE_KEY_LABEL_HEIGHT_MM}mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body {
      width: ${MACHINE_KEY_LABEL_WIDTH_MM}mm;
      height: ${MACHINE_KEY_LABEL_HEIGHT_MM}mm;
      margin: 0;
      padding: 0;
      background: #fff;
    }
    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #000;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
    .label {
      width: ${MACHINE_KEY_LABEL_WIDTH_MM}mm;
      height: ${MACHINE_KEY_LABEL_HEIGHT_MM}mm;
      display: grid;
      grid-template-rows: 1.8mm 4.1mm 1.35mm minmax(0, 1fr);
      gap: 0.18mm;
      border: 0.2mm solid #000;
      padding: 0.45mm;
      overflow: hidden;
      background: #fff;
    }
    .heading {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 0.5mm;
      min-width: 0;
      font-size: 4.2pt;
      font-weight: 800;
      line-height: 1;
    }
    .heading span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .heading .position { font-size: 3.7pt; }
    .barcode {
      min-width: 0;
      overflow: hidden;
      display: flex;
      align-items: stretch;
      justify-content: center;
    }
    .barcode svg {
      display: block;
      width: 100%;
      height: 4.1mm;
    }
    .code {
      overflow: hidden;
      text-align: center;
      white-space: nowrap;
      font-family: Consolas, "Courier New", monospace;
      font-size: 3.5pt;
      font-weight: 800;
      line-height: 1;
      letter-spacing: 0.08mm;
    }
    .bottom {
      display: grid;
      grid-template-columns: 7mm minmax(0, 1fr);
      align-items: stretch;
      gap: 0.45mm;
      min-width: 0;
      min-height: 0;
    }
    .qr-block {
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      min-width: 0;
      min-height: 0;
      border-right: 0.16mm solid #000;
      padding-right: 0.35mm;
    }
    .qr {
      display: grid;
      place-items: center;
      min-width: 0;
      min-height: 0;
    }
    .qr svg {
      display: block;
      width: 4.8mm;
      height: 4.8mm;
    }
    .qr-code {
      overflow: hidden;
      text-align: center;
      white-space: nowrap;
      font-family: Consolas, "Courier New", monospace;
      font-size: 2.35pt;
      font-weight: 800;
      line-height: 1;
      letter-spacing: 0;
    }
    .meta {
      display: grid;
      align-content: center;
      min-width: 0;
      gap: 0.18mm;
      font-size: 3.25pt;
      line-height: 1.05;
    }
    .meta span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta b { font-weight: 800; }
    @media screen {
      html, body { margin: 12px; }
      body { box-shadow: 0 6px 24px rgba(0,0,0,.18); }
    }
  </style>
</head>
<body>
  <main class="label">
    <div class="heading">
      <span>TID ${tid}</span>
      <span class="position">${position}</span>
    </div>
    <div class="barcode">${barcodeSvg}</div>
    <div class="code">${safeBarcode}</div>
    <div class="bottom">
      <div class="qr-block">
        <div class="qr">${qrSvg}</div>
        <div class="qr-code">${safeBarcode}</div>
      </div>
      <div class="meta">
        <span><b>SN</b> ${serialNumber}</span>
        <span><b>SET</b> ${keyType}</span>
        <span><b>PRJ</b> ${project}</span>
      </div>
    </div>
  </main>
</body>
</html>`
}

function MatrixGrid({
  wall,
  matrixConfig,
  mappings,
  mappingBySlot,
  selectedColumn = "",
  selectedRow = "",
  selectedMachineId = "",
  loading = false,
  onSelect,
}) {
  const mappedOnWall = mappings.filter((item) => item.matrix_wall === wall).length
  const gridStyle = {
    gridTemplateColumns: `46px repeat(${matrixConfig.columns.length}, minmax(58px, 1fr))`,
    minWidth: `${46 + matrixConfig.columns.length * 58}px`,
  }

  return (
    <div className="machine-key-matrix-card">
      <div className="machine-key-matrix-toolbar">
        <div>
          <strong>Matrix Visual {wall}</strong>
          <span>
            {loading
              ? "Memuat mapping dari database..."
              : `${mappedOnWall} slot telah dimapping pada dinding ini.`}
          </span>
        </div>
      </div>

      <div className="machine-key-matrix-scroll">
        <div className="machine-key-matrix-grid" role="grid" aria-label={`Matrix ${wall}`} style={gridStyle}>
          <div className="machine-key-matrix-row machine-key-matrix-header-row" role="row">
            <span className="machine-key-matrix-corner" aria-hidden="true" />
            {matrixConfig.columns.map((column) => (
              <span key={column} className="machine-key-matrix-column" role="columnheader">
                {column}
              </span>
            ))}
          </div>

          {matrixConfig.rows.map((row) => (
            <div className="machine-key-matrix-row" role="row" key={row}>
              <span className="machine-key-matrix-row-label" role="rowheader">
                {row}
              </span>
              {matrixConfig.columns.map((column) => {
                const slotId = buildMatrixSlotId(wall, column, row, matrixConfig)
                const persistedMapping = mappingBySlot.get(slotId) || null
                const selected = selectedColumn === column && selectedRow === row
                const status = resolveMatrixSlotStatus({
                  wall,
                  column,
                  row,
                  selectedWall: wall,
                  selectedColumn,
                  selectedRow,
                  machineId: selectedMachineId,
                  persistedStatus: persistedMapping?.status,
                  matrixConfig,
                })
                const title = persistedMapping
                  ? `${persistedMapping.barcode} · TID ${persistedMapping.tid || "-"} · ${mappingTypeLabel(persistedMapping.key_type)} · ${status.label}`
                  : `${wall}${column}${row} · ${status.label}`

                return (
                  <button
                    key={slotId}
                    type="button"
                    role="gridcell"
                    className={`machine-key-matrix-slot ${status.tone}${selected ? " selected" : ""}${persistedMapping ? " occupied" : ""}`}
                    aria-label={title}
                    aria-selected={selected}
                    title={title}
                    onClick={() => onSelect(column, row)}
                  >
                    <span>
                      {persistedMapping?.function_code || (selected ? `${column}${row}` : "")}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function MachineKeyPage() {
  const searchRequestRef = useRef(null)
  const [matrixConfig, setMatrixConfig] = useState(INITIAL_MATRIX_CONFIG)
  const [form, setForm] = useState(() => createInitialForm())
  const [formOpen, setFormOpen] = useState(false)
  const [activeWall, setActiveWall] = useState("A1")
  const [machineQuery, setMachineQuery] = useState("")
  const [machineOptions, setMachineOptions] = useState([])
  const [selectedMachine, setSelectedMachine] = useState(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState("")
  const [showOptions, setShowOptions] = useState(false)
  const [formError, setFormError] = useState("")
  const [successMessage, setSuccessMessage] = useState("")
  const [mappings, setMappings] = useState([])
  const [summary, setSummary] = useState(INITIAL_SUMMARY)
  const [permissions, setPermissions] = useState(INITIAL_PERMISSIONS)
  const [loadingMappings, setLoadingMappings] = useState(true)
  const [mappingError, setMappingError] = useState("")
  const [matrixMachineId, setMatrixMachineId] = useState("")
  const [matrixScope, setMatrixScope] = useState(INITIAL_MATRIX_SCOPE)
  const [syncStatus, setSyncStatus] = useState(INITIAL_SYNC_STATUS)
  const [syncDialogOpen, setSyncDialogOpen] = useState(false)
  const [synchronizing, setSynchronizing] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editingRowVersion, setEditingRowVersion] = useState("")
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [tableSearch, setTableSearch] = useState("")
  const [tableWall, setTableWall] = useState("")
  const [tableStatus, setTableStatus] = useState("")

  const selectedType = useMemo(
    () => findMachineKeyType(form.keyType),
    [form.keyType]
  )

  const barcodeResult = useMemo(
    () =>
      buildMachineKeyBarcode(
        {
          wall: form.wall,
          column: form.column,
          row: form.row,
          randomSegment: form.randomSegment,
          functionCode: form.functionCode,
        },
        matrixConfig
      ),
    [form.column, form.functionCode, form.randomSegment, form.row, form.wall, matrixConfig]
  )

  const barcodePreviewSvg = useMemo(
    () =>
      barcodeResult.valid
        ? createCode128Svg(barcodeResult.barcode, {
            height: 62,
            showText: false,
            quietZone: 10,
            ariaLabel: `Barcode kunci mesin ${barcodeResult.barcode}`,
          })
        : "",
    [barcodeResult.barcode, barcodeResult.valid]
  )

  const qrPreviewSvg = useMemo(
    () =>
      barcodeResult.valid
        ? createQrSvg(barcodeResult.barcode, {
            quietZone: 4,
            ariaLabel: `QR Code kunci mesin ${barcodeResult.barcode}`,
          })
        : "",
    [barcodeResult.barcode, barcodeResult.valid]
  )

  const mappingBySlot = useMemo(() => {
    const index = new Map()

    for (const mapping of mappings) {
      const slotId = buildMatrixSlotId(
        mapping.matrix_wall,
        mapping.matrix_column,
        mapping.matrix_row,
        matrixConfig
      )
      if (slotId) index.set(slotId, mapping)
    }

    return index
  }, [mappings, matrixConfig])

  const currentMapping = useMemo(
    () => mappings.find((mapping) => mapping.id === editingId) || null,
    [editingId, mappings]
  )

  const selectedSlotMapping = useMemo(
    () =>
      mappingBySlot.get(buildMatrixSlotId(form.wall, form.column, form.row, matrixConfig)) || null,
    [form.column, form.row, form.wall, mappingBySlot, matrixConfig]
  )

  const matrixMappingStatus = useMemo(() => {
    if (selectedSlotMapping) {
      return resolveMatrixSlotStatus({
        wall: form.wall,
        column: form.column,
        row: form.row,
        selectedWall: form.wall,
        selectedColumn: form.column,
        selectedRow: form.row,
        machineId: form.machineId,
        persistedStatus: selectedSlotMapping.status,
        matrixConfig,
      })
    }

    return resolveMatrixMappingStatus(form.machineId)
  }, [form.column, form.machineId, form.row, form.wall, selectedSlotMapping, matrixConfig])

  const filteredMappings = useMemo(() => {
    const query = tableSearch.trim().toLowerCase()

    return mappings.filter((mapping) => {
      if (tableWall && mapping.matrix_wall !== tableWall) return false
      if (tableStatus && mapping.status !== tableStatus) return false
      if (!query) return true

      return [
        mapping.barcode,
        mapping.tid,
        mapping.sn,
        mapping.lokasi,
        mapping.nama_project,
        mapping.nama_uker,
      ].some((value) => String(value || "").toLowerCase().includes(query))
    })
  }, [mappings, tableSearch, tableStatus, tableWall])

  const canSave = editingId ? permissions.can_update : permissions.can_create
  const isLockedOut = currentMapping?.status === "OUT"
  const reviewReady = Boolean(
    selectedMachine &&
      form.machineId &&
      form.hasTombak &&
      form.hasFascia &&
      barcodeResult.valid
  )

  const loadMappings = useCallback(async (machineId = "") => {
    setLoadingMappings(true)
    setMappingError("")

    try {
      const query = machineId
        ? `?machine_id=${encodeURIComponent(machineId)}`
        : ""
      const result = await requestJson(`/api/masters/kunci-mesin${query}`)
      const nextMatrixConfig = createMachineKeyMatrixConfig(
        result.data?.matrix_config || INITIAL_MATRIX_CONFIG
      )
      const defaultWall = nextMatrixConfig.walls[0]
      const defaultColumn = nextMatrixConfig.columns[0]
      const defaultRow = nextMatrixConfig.rows[0]

      setMatrixConfig(nextMatrixConfig)
      setActiveWall((current) =>
        nextMatrixConfig.walls.includes(current) ? current : defaultWall
      )
      setForm((current) => ({
        ...current,
        wall: nextMatrixConfig.walls.includes(current.wall) ? current.wall : defaultWall,
        column: nextMatrixConfig.columns.includes(current.column)
          ? current.column
          : defaultColumn,
        row: nextMatrixConfig.rows.includes(current.row) ? current.row : defaultRow,
      }))
      setMappings(result.data?.mappings || [])
      setSummary(result.data?.summary || createInitialSummary(nextMatrixConfig))
      setPermissions(result.data?.permissions || INITIAL_PERMISSIONS)
      setMatrixScope(result.data?.matrix_scope || INITIAL_MATRIX_SCOPE)
      setSyncStatus(result.data?.sync_status || INITIAL_SYNC_STATUS)
    } catch (error) {
      setMatrixConfig(INITIAL_MATRIX_CONFIG)
      setMappings([])
      setSummary(INITIAL_SUMMARY)
      setPermissions(INITIAL_PERMISSIONS)
      setMatrixScope(INITIAL_MATRIX_SCOPE)
      setSyncStatus(INITIAL_SYNC_STATUS)
      setMappingError(
        error instanceof Error
          ? error.message
          : "Gagal mengambil mapping kunci mesin."
      )
    } finally {
      setLoadingMappings(false)
    }
  }, [])


  const clearFormState = useCallback((overrides = {}) => {
    setForm(createInitialForm(overrides))
    setMachineQuery("")
    setSelectedMachine(null)
    setMachineOptions([])
    setShowOptions(false)
    setSearchError("")
    setFormError("")
    setEditingId(null)
    setEditingRowVersion("")
  }, [])

  const closeForm = useCallback(() => {
    if (saving || deleting) return
    setFormOpen(false)
    clearFormState()
  }, [clearFormState, deleting, saving])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void loadMappings("")
    })
    return () => {
      cancelled = true
    }
  }, [loadMappings])

  useEffect(() => {
    const query = machineQuery.trim()

    if (!formOpen) return undefined

    if (selectedMachine && query === machineLabel(selectedMachine)) {
      const timer = window.setTimeout(() => {
        setMachineOptions([])
        setShowOptions(false)
      }, 0)
      return () => window.clearTimeout(timer)
    }

    if (query.length < 2) {
      const timer = window.setTimeout(() => {
        setMachineOptions([])
        setSearchError("")
        setSearching(false)
      }, 0)
      return () => window.clearTimeout(timer)
    }

    const controller = new AbortController()
    searchRequestRef.current?.abort()
    searchRequestRef.current = controller

    const timer = window.setTimeout(async () => {
      setSearching(true)
      setSearchError("")

      try {
        const params = new URLSearchParams({
          mode: "available-machines",
          search: query,
          limit: "8",
        })

        if (editingId) {
          params.set("current_mapping_id", String(editingId))
        }

        const result = await requestJson(
          `/api/masters/kunci-mesin?${params.toString()}`,
          { signal: controller.signal }
        )
        setMachineOptions(result.data?.machines || [])
        setShowOptions(true)
      } catch (error) {
        if (error?.name !== "AbortError") {
          setMachineOptions([])
          setSearchError(
            error instanceof Error ? error.message : "Gagal mencari Mesin."
          )
          setShowOptions(true)
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false)
      }
    }, 300)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [editingId, formOpen, machineQuery, selectedMachine])

  useEffect(() => {
    if (!formOpen && !deleteTarget && !syncDialogOpen) return undefined

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    function handleEscape(event) {
      if (event.key !== "Escape" || saving || deleting || synchronizing) return
      if (deleteTarget) {
        setDeleteTarget(null)
      } else if (syncDialogOpen) {
        setSyncDialogOpen(false)
      } else {
        closeForm()
      }
    }

    window.addEventListener("keydown", handleEscape)
    return () => {
      window.removeEventListener("keydown", handleEscape)
      document.body.style.overflow = previousOverflow
    }
  }, [closeForm, deleteTarget, deleting, formOpen, saving, syncDialogOpen, synchronizing])

  function clearFeedback() {
    setFormError("")
    setSuccessMessage("")
  }

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }))
    clearFeedback()
  }

  function openCreateMapping({
    wall = activeWall,
    column = matrixConfig.columns[0],
    row = matrixConfig.rows[0],
  } = {}) {
    if (!permissions.can_create) {
      setMappingError("Anda tidak memiliki permission create untuk mapping kunci.")
      return
    }

    clearFormState({ wall, column, row })
    setActiveWall(wall)
    setSuccessMessage("")
    setFormOpen(true)
  }

  function handleMachineQueryChange(event) {
    const value = event.target.value
    setMachineQuery(value)
    setShowOptions(true)
    clearFeedback()

    if (selectedMachine && value !== machineLabel(selectedMachine)) {
      setSelectedMachine(null)
      setForm((current) => ({ ...current, machineId: "" }))
    }
  }

  function selectMachine(machine) {
    const machineId = String(machine.id)
    setSelectedMachine(machine)
    setMachineQuery(machineLabel(machine))
    setMachineOptions([])
    setShowOptions(false)
    setForm((current) => ({ ...current, machineId }))
    setMatrixMachineId(machineId)
    clearFeedback()
    loadMappings(machineId)
  }

  function handleKeyTypeChange(event) {
    const keyType = event.target.value
    const keyDefinition = findMachineKeyType(keyType)

    setForm((current) => ({
      ...current,
      keyType,
      functionCode: keyDefinition?.barcodeCode || "",
    }))
    clearFeedback()
  }

  function regenerateRandomSegment() {
    updateField("randomSegment", generateRandomSegment())
  }

  function startEditMapping(mapping) {
    const machine = mappingMachine(mapping)

    setEditingId(mapping.id)
    setEditingRowVersion(mapping.row_version || "")
    setMatrixMachineId(String(mapping.machine_id))
    setSelectedMachine(machine)
    setMachineQuery(machineLabel(machine))
    setMachineOptions([])
    setShowOptions(false)
    setActiveWall(mapping.matrix_wall)
    setForm({
      machineId: String(mapping.machine_id),
      keyType: mapping.key_type,
      functionCode: mapping.function_code,
      wall: mapping.matrix_wall,
      column: mapping.matrix_column,
      row: mapping.matrix_row,
      randomSegment: mapping.random_segment,
      hasTombak: Boolean(mapping.has_tombak),
      hasFascia: Boolean(mapping.has_fascia),
      notes: mapping.notes || "",
    })
    setFormError("")
    setSuccessMessage("")
    setFormOpen(true)
  }

  function selectMatrixSlot(column, row, wall = formOpen ? form.wall : activeWall) {
    const slotMapping = mappingBySlot.get(buildMatrixSlotId(wall, column, row, matrixConfig))

    if (slotMapping) {
      if (slotMapping.id === editingId) {
        setForm((current) => ({ ...current, wall, column, row }))
        return
      }
      startEditMapping(slotMapping)
      return
    }

    if (!formOpen) {
      openCreateMapping({ wall, column, row })
      return
    }

    setForm((current) => ({ ...current, wall, column, row }))
    clearFeedback()
  }

  function validateForm() {
    if (!selectedMachine || !form.machineId) {
      return "Mesin wajib dipilih berdasarkan TID, SN, atau lokasi."
    }

    if (!form.hasTombak || !form.hasFascia) {
      return "Satu set kunci wajib terdiri dari kunci tombak dan kunci fascia."
    }

    if (!barcodeResult.valid) return barcodeResult.errors[0]

    if (form.notes.trim().length > 500) {
      return "Catatan maksimal 500 karakter."
    }

    if (!canSave) {
      return editingId
        ? "Anda tidak memiliki permission update untuk mapping kunci."
        : "Anda tidak memiliki permission create untuk mapping kunci."
    }

    if (isLockedOut) {
      return "Mapping tidak dapat diubah saat kunci sedang keluar."
    }

    if (selectedSlotMapping && selectedSlotMapping.id !== editingId) {
      return "Slot matrix sudah digunakan oleh set kunci lain."
    }

    return ""
  }

  function printMachineKeyLabel(mapping = null) {
    const barcode = String(mapping?.barcode || barcodeResult.barcode || "").trim()
    const machine = mapping || selectedMachine || {}

    if (!barcode) {
      const message = "Barcode belum lengkap sehingga label belum dapat dicetak."
      if (formOpen) setFormError(message)
      else setMappingError(message)
      return false
    }

    const label = {
      barcode,
      tid: machine.tid,
      sn: machine.sn,
      project: machine.nama_project,
      position: `${mapping?.matrix_wall || form.wall}/${mapping?.matrix_column || form.column}${mapping?.matrix_row || form.row}`,
      keyType: mappingTypeLabel(mapping?.key_type || form.keyType),
    }

    try {
      const iframe = document.createElement("iframe")
      iframe.setAttribute("title", `Cetak label sling ${barcode}`)
      iframe.style.position = "fixed"
      iframe.style.width = "1px"
      iframe.style.height = "1px"
      iframe.style.right = "0"
      iframe.style.bottom = "0"
      iframe.style.border = "0"
      iframe.style.opacity = "0"
      iframe.style.pointerEvents = "none"
      document.body.appendChild(iframe)

      const frameWindow = iframe.contentWindow
      const frameDocument = frameWindow?.document
      if (!frameWindow || !frameDocument) {
        iframe.remove()
        throw new Error("Jendela cetak tidak dapat dibuat.")
      }

      let removed = false
      const cleanup = () => {
        if (removed) return
        removed = true
        window.setTimeout(() => iframe.remove(), 250)
      }

      frameWindow.addEventListener("afterprint", cleanup, { once: true })
      frameDocument.open()
      frameDocument.write(createMachineKeyLabelDocument(label))
      frameDocument.close()

      window.setTimeout(() => {
        frameWindow.focus()
        frameWindow.print()
      }, 180)
      window.setTimeout(cleanup, 120000)
      return true
    } catch (error) {
      const message = error instanceof Error
        ? `Gagal membuka cetak label. ${error.message}`
        : "Gagal membuka cetak label sling."
      if (formOpen) setFormError(message)
      else setMappingError(message)
      return false
    }
  }

  async function handleSave(event) {
    event.preventDefault()
    const printAfterSave = event.nativeEvent?.submitter?.value === "save-and-print"

    const validationError = validateForm()
    if (validationError) {
      setFormError(validationError)
      return
    }

    setSaving(true)
    setFormError("")

    try {
      const payload = {
        machine_id: Number(form.machineId),
        key_type: form.keyType,
        function_code: form.functionCode,
        matrix_wall: form.wall,
        matrix_column: form.column,
        matrix_row: form.row,
        random_segment: form.randomSegment,
        has_tombak: form.hasTombak,
        has_fascia: form.hasFascia,
        notes: form.notes,
      }

      const result = await requestJson("/api/masters/kunci-mesin", {
        method: editingId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          editingId
            ? { ...payload, id: editingId, row_version: editingRowVersion }
            : payload
        ),
      })

      const savedMachineId = String(form.machineId)
      setMatrixMachineId(savedMachineId)
      await loadMappings(savedMachineId)
      if (printAfterSave) printMachineKeyLabel(result.data)
      setFormOpen(false)
      clearFormState()
      setSuccessMessage(
        printAfterSave
          ? `${result.message || "Mapping kunci berhasil disimpan."} Dialog cetak label telah dibuka.`
          : result.message || "Mapping kunci berhasil disimpan."
      )
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Gagal menyimpan mapping kunci."
      )
    } finally {
      setSaving(false)
    }
  }

  function requestDelete() {
    if (!currentMapping || !permissions.can_delete || isLockedOut) return
    setDeleteTarget(currentMapping)
  }

  async function handleDelete() {
    if (!deleteTarget || deleting) return

    setDeleting(true)
    setFormError("")

    try {
      const result = await requestJson("/api/masters/kunci-mesin", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: deleteTarget.id,
          row_version: deleteTarget.row_version,
        }),
      })

      const deletedMachineId = String(deleteTarget.machine_id)
      setMatrixMachineId(deletedMachineId)
      await loadMappings(deletedMachineId)
      setDeleteTarget(null)
      setFormOpen(false)
      clearFormState()
      setSuccessMessage(result.message || "Mapping kunci berhasil dihapus.")
    } catch (error) {
      setDeleteTarget(null)
      setFormError(
        error instanceof Error ? error.message : "Gagal menghapus mapping kunci."
      )
    } finally {
      setDeleting(false)
    }
  }


  function openSynchronizationDialog() {
    if (!permissions.can_create) {
      setMappingError("Permission create diperlukan untuk menjalankan sinkronisasi mapping.")
      return
    }

    if (matrixScope.requires_machine_selection) {
      setMappingError(
        "Pilih satu mesin terlebih dahulu untuk menentukan unit kerja yang akan disinkronkan."
      )
      return
    }

    if (syncStatus.unmapped_machines <= 0) {
      setSuccessMessage("Seluruh mesin aktif pada unit kerja ini sudah memiliki mapping.")
      return
    }

    if (syncStatus.free_slots <= 0) {
      setMappingError("Seluruh slot matrix sudah penuh. Sinkronisasi tidak dapat dijalankan.")
      return
    }

    setMappingError("")
    setSuccessMessage("")
    setSyncDialogOpen(true)
  }

  async function handleSynchronize() {
    if (synchronizing) return

    setSynchronizing(true)
    setMappingError("")

    try {
      const result = await requestJson(
        "/api/masters/kunci-mesin/synchronize",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            scope_machine_id: matrixMachineId
              ? Number(matrixMachineId)
              : null,
          }),
        }
      )

      setSyncDialogOpen(false)
      await loadMappings(matrixMachineId)
      setSuccessMessage(result.message || "Sinkronisasi mapping berhasil dijalankan.")
    } catch (error) {
      setSyncDialogOpen(false)
      setMappingError(
        error instanceof Error
          ? error.message
          : "Gagal menyinkronkan mapping kunci mesin."
      )
    } finally {
      setSynchronizing(false)
    }
  }

  return (
    <div className="simple-page user-role-page machine-key-page">
      <section className="page-heading-card user-role-heading machine-key-heading">
        <div>
          <p className="eyebrow">Tahap 2 · Fitur Kunci Mesin</p>
          <h2>Mapping Set Kunci dan Matrix</h2>
          <p>
            Registrasikan set kunci ke TID dan posisi matrix. Warna matrix berasal
            dari data aktual: kuning belum dimapping, hijau tersedia, dan merah keluar.
          </p>
        </div>
        <div className="user-role-toolbar-actions">
          <Link href="/masters" className="user-role-button secondary">
            Kembali
          </Link>
          <button
            type="button"
            className="user-role-button secondary"
            onClick={() => loadMappings(matrixMachineId)}
            disabled={loadingMappings}
          >
            {loadingMappings ? "Memuat..." : "Muat Ulang"}
          </button>
          {permissions.can_create ? (
            <>
              <button
                type="button"
                className="user-role-button secondary machine-key-sync-button"
                onClick={openSynchronizationDialog}
                disabled={
                  loadingMappings ||
                  synchronizing ||
                  matrixScope.requires_machine_selection ||
                  syncStatus.will_map <= 0
                }
                title={syncStatus.reason || "Mapping otomatis seluruh TID yang belum memiliki slot"}
              >
                {synchronizing ? "Menyinkronkan..." : "Sinkronisasi"}
              </button>
              <button
                type="button"
                className="user-role-button primary"
                onClick={() => openCreateMapping()}
              >
                Tambah Mapping
              </button>
            </>
          ) : null}
        </div>
      </section>

      <section className="user-role-summary-grid machine-key-summary-grid" aria-label="Ringkasan mapping kunci">
        <article className="user-role-summary-card">
          <span>Sudah Dimapping</span>
          <strong>{summary.total_mapped}</strong>
          <p>Dari {summary.total_slots} slot matrix.</p>
        </article>
        <article className="user-role-summary-card orange">
          <span>Belum Dimapping</span>
          <strong>{summary.total_unmapped}</strong>
          <p>Slot berwarna kuning.</p>
        </article>
        <article className="user-role-summary-card green">
          <span>Kunci Tersedia</span>
          <strong>{summary.total_in}</strong>
          <p>Kunci berada di ruang penyimpanan.</p>
        </article>
        <article className="user-role-summary-card red">
          <span>Kunci Keluar</span>
          <strong>{summary.total_out}</strong>
          <p>Terhubung dengan Work Order aktif.</p>
        </article>
      </section>

      {matrixScope.requires_machine_selection ? (
        <div className="user-role-alert info">
          Super Admin perlu memilih mesin melalui form Tambah Mapping agar matrix
          {` ${matrixConfig.walls[0]}–${matrixConfig.walls.at(-1)} `}
          dimuat sesuai unit kerja mesin.
        </div>
      ) : matrixScope.codeuker ? (
        <div className="user-role-alert info">
          Matrix aktif: <strong>{matrixScope.codeuker} · {matrixScope.nama_uker || "Unit kerja"}</strong>
          {` Posisi ${matrixConfig.walls[0]}–${matrixConfig.walls.at(-1)}, kolom ${matrixConfig.columns[0]}–${matrixConfig.columns.at(-1)}, dan baris ${matrixConfig.rows[0]}–${matrixConfig.rows.at(-1)} unik di dalam unit kerja ini.`}
        </div>
      ) : null}

      {mappingError ? <div className="user-role-alert error">{mappingError}</div> : null}

      <section className="settings-card user-role-panel machine-key-panel">
        <div className="machine-key-panel-heading">
          <div>
            <p className="eyebrow">Peta Penyimpanan</p>
            <h3>Matrix Kunci</h3>
            <p>Klik slot kuning untuk membuat mapping. Klik slot hijau atau merah untuk melihat data.</p>
          </div>
          <div className="machine-key-wall-tabs" aria-label="Pilih dinding matrix">
            {matrixConfig.walls.map((wall) => (
              <button
                key={wall}
                type="button"
                className={activeWall === wall ? "active" : ""}
                onClick={() => setActiveWall(wall)}
              >
                {wall}
              </button>
            ))}
          </div>
        </div>

        {matrixScope.requires_machine_selection ? (
          <div className="machine-key-matrix-placeholder">
            <strong>Matrix belum dapat ditampilkan</strong>
            <span>Pilih mesin terlebih dahulu untuk menentukan unit kerja matrix.</span>
            {permissions.can_create ? (
              <button
                type="button"
                className="user-role-button primary"
                onClick={() => openCreateMapping({ wall: activeWall })}
              >
                Pilih Mesin
              </button>
            ) : null}
          </div>
        ) : (
          <MatrixGrid
            wall={activeWall}
            matrixConfig={matrixConfig}
            mappings={mappings}
            mappingBySlot={mappingBySlot}
            loading={loadingMappings}
            onSelect={(column, row) => selectMatrixSlot(column, row, activeWall)}
          />
        )}

        <div className="machine-key-status-legend" aria-label="Keterangan warna matrix">
          <span><i className="unmapped" />Kuning: belum dimapping dengan TID</span>
          <span><i className="available" />Hijau: kunci tersedia atau sudah kembali</span>
          <span><i className="out" />Merah: kunci sudah discan keluar</span>
        </div>
      </section>

      <section className="settings-card user-role-panel machine-key-panel">
        <div className="machine-key-list-heading">
          <div>
            <p className="eyebrow">Data Tersimpan</p>
            <h3>Mapping Tersimpan</h3>
            <p>Daftar set kunci yang telah terhubung dengan mesin dan slot matrix.</p>
          </div>
          <span>R {summary.replenish} · F {summary.flm} · Backup {summary.backup}</span>
        </div>

        <div className="user-role-toolbar machine-key-list-toolbar">
          <div className="user-role-filters">
            <input
              type="search"
              value={tableSearch}
              onChange={(event) => setTableSearch(event.target.value)}
              placeholder="Cari barcode, TID, SN, lokasi, atau project"
              aria-label="Cari mapping kunci"
            />
            <select
              value={tableWall}
              onChange={(event) => setTableWall(event.target.value)}
              aria-label="Filter dinding"
            >
              <option value="">Semua Dinding</option>
              {matrixConfig.walls.map((wall) => <option key={wall} value={wall}>{wall}</option>)}
            </select>
            <select
              value={tableStatus}
              onChange={(event) => setTableStatus(event.target.value)}
              aria-label="Filter status"
            >
              <option value="">Semua Status</option>
              <option value="IN">Tersedia</option>
              <option value="OUT">Keluar</option>
            </select>
          </div>
          <p className="machine-key-list-count">
            {loadingMappings ? "Memuat data..." : `${filteredMappings.length} dari ${mappings.length} mapping`}
          </p>
        </div>

        <div className="user-role-table-wrapper">
          <table className="user-role-table machine-key-table">
            <thead>
              <tr>
                <th>Barcode</th>
                <th>Matrix</th>
                <th>TID / SN</th>
                <th>Jenis</th>
                <th>Status</th>
                <th>Project / Uker</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loadingMappings ? (
                <tr><td colSpan={7} className="user-role-loading">Memuat mapping kunci...</td></tr>
              ) : null}
              {!loadingMappings && filteredMappings.length === 0 ? (
                <tr><td colSpan={7} className="user-role-empty">Data mapping tidak ditemukan.</td></tr>
              ) : null}
              {!loadingMappings
                ? filteredMappings.map((mapping) => (
                    <tr key={mapping.id}>
                      <td><code className="machine-key-code">{mapping.barcode}</code></td>
                      <td><strong>{mapping.matrix_wall}</strong> · {mapping.matrix_column}{mapping.matrix_row}</td>
                      <td>
                        <strong>{mapping.tid || "-"}</strong>
                        <span className="project-cell-subtext">{mapping.sn || "-"}</span>
                      </td>
                      <td>{mappingTypeLabel(mapping.key_type)}</td>
                      <td>
                        <span className={`machine-key-table-status ${mapping.status === "OUT" ? "out" : "available"}`}>
                          {mapping.status === "OUT" ? "Keluar" : "Tersedia"}
                        </span>
                      </td>
                      <td>
                        <strong>{mapping.nama_project || "-"}</strong>
                        <span className="project-cell-subtext">{mapping.codeuker || "-"} · {mapping.nama_uker || "-"}</span>
                      </td>
                      <td>
                        <div className="user-role-actions">
                          <button
                            type="button"
                            className="user-role-button secondary machine-key-table-action"
                            onClick={() => printMachineKeyLabel(mapping)}
                          >
                            Cetak
                          </button>
                          <button
                            type="button"
                            className="user-role-button secondary machine-key-table-action"
                            onClick={() => startEditMapping(mapping)}
                          >
                            {permissions.can_update && mapping.status !== "OUT" ? "Ubah" : "Lihat"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                : null}
            </tbody>
          </table>
        </div>
      </section>

      {formOpen ? (
        <div
          className="user-role-modal-backdrop machine-key-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeForm()
          }}
        >
          <section
            className="user-role-modal machine-key-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="machine-key-modal-title"
          >
            <header className="user-role-modal-header">
              <div>
                <p className="eyebrow">Master Kunci Mesin</p>
                <h3 id="machine-key-modal-title">
                  {editingId ? "Ubah Mapping Kunci" : "Tambah Mapping Kunci"}
                </h3>
                <p>
                  {isLockedOut
                    ? `Kunci sedang keluar melalui Work Order ${currentMapping?.current_work_order_no || "-"}. Data hanya dapat dilihat.`
                    : "Lengkapi data mesin, komposisi set, posisi matrix, dan barcode slink."}
                </p>
              </div>
              <button type="button" onClick={closeForm} aria-label="Tutup form">×</button>
            </header>

            <form onSubmit={handleSave} noValidate>
              <div className="machine-key-modal-body">
                <section className="machine-key-form-section">
                  <div className="machine-key-form-section-heading">
                    <span>1</span>
                    <div>
                      <h4>Data Mesin</h4>
                      <p>Pilih mesin aktif yang belum memiliki mapping kunci.</p>
                    </div>
                  </div>

                  <div className="user-role-form-grid machine-key-form-grid">
                    <div className="user-role-form-field full machine-key-machine-search">
                      <label htmlFor="machine-key-machine">TID / SN / Lokasi Mesin *</label>
                      <input
                        id="machine-key-machine"
                        type="text"
                        value={machineQuery}
                        onChange={handleMachineQueryChange}
                        onFocus={() => setShowOptions(true)}
                        placeholder="Ketik minimal 2 karakter"
                        autoComplete="off"
                        disabled={isLockedOut}
                      />

                      {showOptions && !isLockedOut ? (
                        <div className="machine-key-options" role="listbox">
                          {searching ? <p>Mencari data Mesin...</p> : null}
                          {!searching && searchError ? <p className="error">{searchError}</p> : null}
                          {!searching && !searchError && machineOptions.length === 0 ? (
                            <p>Tidak ada mesin aktif yang belum dimapping.</p>
                          ) : null}
                          {!searching && !searchError
                            ? machineOptions.map((machine) => (
                                <button
                                  key={machine.id}
                                  type="button"
                                  onClick={() => selectMachine(machine)}
                                  role="option"
                                  aria-selected={String(machine.id) === form.machineId}
                                >
                                  <strong>{machine.tid || "Tanpa TID"} · {machine.sn}</strong>
                                  <span>{machine.lokasi || "Lokasi belum diisi"}</span>
                                  <small>{machine.nama_project || "-"} · {machine.nama_cabang || "-"}</small>
                                </button>
                              ))
                            : null}
                        </div>
                      ) : null}
                    </div>

                    {selectedMachine ? (
                      <div className="machine-key-machine-card full">
                        <div><span>TID</span><strong>{selectedMachine.tid || "-"}</strong></div>
                        <div><span>Serial Number</span><strong>{selectedMachine.sn || "-"}</strong></div>
                        <div><span>Lokasi</span><strong>{selectedMachine.lokasi || "-"}</strong></div>
                        <div><span>Project</span><strong>{selectedMachine.nama_project || "-"}</strong></div>
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="machine-key-form-section">
                  <div className="machine-key-form-section-heading">
                    <span>2</span>
                    <div>
                      <h4>Komposisi Set Kunci dan Barcode Slink Kunci</h4>
                      <p>Satu set wajib terdiri dari kunci tombak dan kunci fascia.</p>
                    </div>
                  </div>

                  <div className="user-role-form-grid machine-key-form-grid">
                    <div className="user-role-form-field">
                      <label htmlFor="machine-key-type">Jenis Set Kunci *</label>
                      <select
                        id="machine-key-type"
                        value={form.keyType}
                        onChange={handleKeyTypeChange}
                        disabled={isLockedOut}
                      >
                        {MACHINE_KEY_TYPES.map((item) => (
                          <option key={item.value} value={item.value}>{item.label}</option>
                        ))}
                      </select>
                      {selectedType?.barcodeCodeConfirmed ? (
                        <small>Kode fungsi otomatis: {selectedType.barcodeCode}.</small>
                      ) : (
                        <small>Kode Backup belum ditetapkan dalam BRS dan wajib diisi manual.</small>
                      )}
                    </div>

                    <div className="user-role-form-field">
                      <label htmlFor="machine-key-function-code">Kode Fungsi *</label>
                      <input
                        id="machine-key-function-code"
                        type="text"
                        maxLength={1}
                        value={form.functionCode}
                        onChange={(event) => updateField("functionCode", normalizeBarcodeFunctionCode(event.target.value))}
                        placeholder="R, F, atau kode Backup"
                        readOnly={Boolean(selectedType?.barcodeCodeConfirmed)}
                        aria-readonly={Boolean(selectedType?.barcodeCodeConfirmed)}
                        disabled={isLockedOut}
                      />
                      <small>R = Replenish dan F = First Level Maintenance (FLM).</small>
                    </div>

                    <label className="user-role-toggle-field">
                      <input
                        type="checkbox"
                        checked={form.hasTombak}
                        onChange={(event) => updateField("hasTombak", event.target.checked)}
                        disabled={isLockedOut}
                      />
                      <span><strong>Kunci Tombak</strong><small>Wajib tersedia dalam satu set.</small></span>
                    </label>

                    <label className="user-role-toggle-field">
                      <input
                        type="checkbox"
                        checked={form.hasFascia}
                        onChange={(event) => updateField("hasFascia", event.target.checked)}
                        disabled={isLockedOut}
                      />
                      <span><strong>Kunci Fascia</strong><small>Wajib tersedia dalam satu set.</small></span>
                    </label>

                    <div className="user-role-form-field">
                      <label htmlFor="machine-key-random">4 Karakter Random *</label>
                      <div className="machine-key-inline-control">
                        <input
                          id="machine-key-random"
                          type="text"
                          maxLength={4}
                          value={form.randomSegment}
                          onChange={(event) => updateField("randomSegment", normalizeRandomSegment(event.target.value))}
                          disabled={isLockedOut}
                        />
                        <button type="button" onClick={regenerateRandomSegment} disabled={isLockedOut}>
                          Acak
                        </button>
                      </div>
                    </div>

                    <div className="machine-key-barcode-preview machine-key-label-preview">
                      <div className="machine-key-label-preview-heading">
                        <div>
                          <span>Pratinjau Label Sling</span>
                          <small>
                            Barcode dan QR Code memuat kode yang sama untuk proses pemindaian.
                          </small>
                          <small className="machine-key-label-size-note">
                            Ukuran cetak: {MACHINE_KEY_LABEL_WIDTH_MM} × {MACHINE_KEY_LABEL_HEIGHT_MM} mm.
                          </small>
                        </div>
                        <button
                          type="button"
                          className="user-role-button secondary machine-key-print-button"
                          onClick={() => printMachineKeyLabel()}
                          disabled={!reviewReady || saving || deleting}
                        >
                          Cetak Pratinjau
                        </button>
                      </div>

                      <div className="machine-key-label-visuals" aria-live="polite">
                        <div className="machine-key-label-barcode">
                          {barcodePreviewSvg ? (
                            <>
                              <div
                                className="machine-key-label-svg"
                                dangerouslySetInnerHTML={{ __html: barcodePreviewSvg }}
                              />
                              <strong className="machine-key-label-value">
                                {barcodeResult.barcode}
                              </strong>
                            </>
                          ) : (
                            <p>Lengkapi posisi, kode random, dan kode fungsi.</p>
                          )}
                        </div>
                        <div className="machine-key-label-qr">
                          {qrPreviewSvg ? (
                            <>
                              <div
                                className="machine-key-label-svg"
                                dangerouslySetInnerHTML={{ __html: qrPreviewSvg }}
                              />
                              <strong className="machine-key-label-value">
                                {barcodeResult.barcode}
                              </strong>
                            </>
                          ) : (
                            <p>QR belum tersedia.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="machine-key-form-section">
                  <div className="machine-key-form-section-heading">
                    <span>3</span>
                    <div>
                      <h4>Posisi Matrix Kunci</h4>
                      <p>
                        {`Pilih dinding ${matrixConfig.walls[0]}–${matrixConfig.walls.at(-1)}, kolom ${matrixConfig.columns[0]}–${matrixConfig.columns.at(-1)}, dan baris ${matrixConfig.rows[0]}–${matrixConfig.rows.at(-1)}.`}
                      </p>
                    </div>
                  </div>

                  <div className="user-role-form-grid machine-key-position-fields">
                    <div className="user-role-form-field">
                      <label htmlFor="machine-key-wall">Dinding *</label>
                      <select
                        id="machine-key-wall"
                        value={form.wall}
                        onChange={(event) => updateField("wall", event.target.value)}
                        disabled={isLockedOut}
                      >
                        {matrixConfig.walls.map((value) => <option key={value} value={value}>{value}</option>)}
                      </select>
                    </div>
                    <div className="user-role-form-field">
                      <label htmlFor="machine-key-column">Kolom *</label>
                      <select
                        id="machine-key-column"
                        value={form.column}
                        onChange={(event) => updateField("column", event.target.value)}
                        disabled={isLockedOut}
                      >
                        {matrixConfig.columns.map((value) => <option key={value} value={value}>{value}</option>)}
                      </select>
                    </div>
                    <div className="user-role-form-field">
                      <label htmlFor="machine-key-row">Baris *</label>
                      <select
                        id="machine-key-row"
                        value={form.row}
                        onChange={(event) => updateField("row", event.target.value)}
                        disabled={isLockedOut}
                      >
                        {matrixConfig.rows.map((value) => <option key={value} value={value}>{value}</option>)}
                      </select>
                    </div>
                    <div className="machine-key-position-preview">
                      <span>Slot Terpilih</span>
                      <strong>{form.wall} / {form.column}{form.row}</strong>
                      <small className={matrixMappingStatus.tone}>{matrixMappingStatus.label}</small>
                    </div>
                  </div>

                  <div className="machine-key-modal-wall-tabs machine-key-wall-tabs" aria-label="Pilih dinding matrix pada form">
                    {matrixConfig.walls.map((wall) => (
                      <button
                        key={wall}
                        type="button"
                        className={form.wall === wall ? "active" : ""}
                        onClick={() => updateField("wall", wall)}
                        disabled={isLockedOut}
                      >
                        {wall}
                      </button>
                    ))}
                  </div>

                  <MatrixGrid
                    wall={form.wall}
                    matrixConfig={matrixConfig}
                    mappings={mappings}
                    mappingBySlot={mappingBySlot}
                    selectedColumn={form.column}
                    selectedRow={form.row}
                    selectedMachineId={form.machineId}
                    loading={loadingMappings}
                    onSelect={(column, row) => selectMatrixSlot(column, row, form.wall)}
                  />

                  <p className="machine-key-matrix-note">
                    Klik slot hijau atau merah untuk membuka mapping yang sudah tersimpan;
                    pilih slot kuning untuk mapping baru.
                  </p>
                </section>

                <section className="machine-key-form-section">
                  <div className="machine-key-form-section-heading">
                    <span>4</span>
                    <div>
                      <h4>Catatan dan Review</h4>
                      <p>Tambahkan identifikasi fisik slink bila diperlukan.</p>
                    </div>
                  </div>

                  <div className="user-role-form-grid machine-key-form-grid">
                    <div className="user-role-form-field full">
                      <label htmlFor="machine-key-notes">Catatan Opsional</label>
                      <textarea
                        id="machine-key-notes"
                        rows={3}
                        maxLength={500}
                        value={form.notes}
                        onChange={(event) => updateField("notes", event.target.value)}
                        placeholder="Contoh: slink baja baru, label barcode terpasang dan terbaca."
                        disabled={isLockedOut}
                      />
                    </div>

                    {reviewReady ? (
                      <div className="machine-key-review full">
                        <div><span>Mesin</span><strong>{selectedMachine?.tid || "-"} · {selectedMachine?.sn || "-"}</strong></div>
                        <div><span>Set Kunci</span><strong>{selectedType?.label || form.keyType}</strong></div>
                        <div><span>Posisi</span><strong>{form.wall} / {form.column}{form.row}</strong></div>
                        <div><span>Barcode</span><strong>{barcodeResult.barcode}</strong></div>
                      </div>
                    ) : null}
                  </div>
                </section>
              </div>

              {formError ? <div className="user-role-alert error machine-key-form-alert">{formError}</div> : null}

              <footer className="user-role-modal-footer machine-key-modal-footer">
                {editingId && permissions.can_delete ? (
                  <button
                    type="button"
                    className="user-role-button danger"
                    onClick={requestDelete}
                    disabled={saving || deleting || isLockedOut}
                  >
                    Hapus Mapping
                  </button>
                ) : null}
                <span className="machine-key-footer-spacer" />
                <button
                  type="button"
                  className="user-role-button secondary"
                  onClick={closeForm}
                  disabled={saving || deleting}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  name="saveAction"
                  value="save-and-print"
                  className="user-role-button secondary machine-key-save-print-button"
                  disabled={saving || deleting || !canSave || isLockedOut || Boolean(mappingError)}
                >
                  {saving ? "Menyimpan..." : editingId ? "Perbarui & Cetak" : "Simpan & Cetak Label"}
                </button>
                <button
                  type="submit"
                  name="saveAction"
                  value="save"
                  className="user-role-button primary"
                  disabled={saving || deleting || !canSave || isLockedOut || Boolean(mappingError)}
                >
                  {saving ? "Menyimpan..." : editingId ? "Perbarui Mapping" : "Simpan Mapping"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="user-role-modal-backdrop" role="presentation">
          <section className="user-role-modal compact" role="dialog" aria-modal="true" aria-labelledby="delete-machine-key-title">
            <header className="user-role-modal-header">
              <div>
                <p className="eyebrow">Konfirmasi</p>
                <h3 id="delete-machine-key-title">Hapus Mapping Kunci</h3>
                <p>Slot matrix akan kembali berwarna kuning.</p>
              </div>
              <button type="button" onClick={() => setDeleteTarget(null)} aria-label="Tutup konfirmasi">×</button>
            </header>
            <div className="user-role-delete-content">
              <div className="user-role-delete-target">
                <strong>{deleteTarget.barcode}</strong>
                <span>TID {deleteTarget.tid || "-"} · {deleteTarget.matrix_wall}/{deleteTarget.matrix_column}{deleteTarget.matrix_row}</span>
              </div>
            </div>
            <footer className="user-role-modal-footer">
              <button
                type="button"
                className="user-role-button secondary"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Batal
              </button>
              <button
                type="button"
                className="user-role-button danger"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Menghapus..." : "Hapus Mapping"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}


      {syncDialogOpen ? (
        <div className="user-role-modal-backdrop" role="presentation">
          <section
            className="user-role-modal compact machine-key-sync-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="machine-key-sync-title"
          >
            <header className="user-role-modal-header">
              <div>
                <p className="eyebrow">Mapping Otomatis</p>
                <h3 id="machine-key-sync-title">Sinkronisasi Matrix Kunci</h3>
                <p>
                  Sistem akan mengisi slot kosong secara berurutan tanpa mengubah
                  mapping yang sudah tersimpan.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSyncDialogOpen(false)}
                aria-label="Tutup konfirmasi sinkronisasi"
                disabled={synchronizing}
              >
                ×
              </button>
            </header>

            <div className="machine-key-sync-content">
              <div className="machine-key-sync-scope">
                <span>Unit kerja</span>
                <strong>
                  {matrixScope.codeuker || "-"} · {matrixScope.nama_uker || "Unit kerja"}
                </strong>
              </div>

              <div className="machine-key-sync-stats" aria-label="Ringkasan sinkronisasi">
                <article>
                  <span>TID belum dimapping</span>
                  <strong>{syncStatus.unmapped_machines}</strong>
                </article>
                <article>
                  <span>Slot kosong</span>
                  <strong>{syncStatus.free_slots}</strong>
                </article>
                <article className="highlight">
                  <span>Akan dimapping</span>
                  <strong>{syncStatus.will_map}</strong>
                </article>
              </div>

              <div className="user-role-alert info machine-key-sync-rule">
                <strong>Urutan pengisian:</strong> dinding {matrixConfig.walls[0]} diisi
                terlebih dahulu dari baris {matrixConfig.rows[0]}, kolom {matrixConfig.columns[0]}
                sampai {matrixConfig.columns.at(-1)}. Setelah seluruh baris pada dinding
                tersebut penuh, sistem melanjutkan ke {matrixConfig.walls[1] || matrixConfig.walls[0]}
                hingga {matrixConfig.walls.at(-1)}.
              </div>

              <p className="machine-key-sync-note">
                Mapping otomatis menggunakan jenis <strong>Kunci Replenish</strong>, kode
                fungsi <strong>R</strong>, komposisi kunci tombak dan fascia, serta status
                awal tersedia. Mesin yang sudah dimapping tidak akan diproses kembali.
              </p>

              {syncStatus.unmapped_machines > syncStatus.free_slots ? (
                <div className="user-role-alert error">
                  Kapasitas tidak mencukupi. Sebanyak {syncStatus.unmapped_machines - syncStatus.free_slots}
                  {" "}TID akan tetap belum termapping setelah proses selesai.
                </div>
              ) : null}
            </div>

            <footer className="user-role-modal-footer">
              <button
                type="button"
                className="user-role-button secondary"
                onClick={() => setSyncDialogOpen(false)}
                disabled={synchronizing}
              >
                Batal
              </button>
              <button
                type="button"
                className="user-role-button primary"
                onClick={handleSynchronize}
                disabled={synchronizing || syncStatus.will_map <= 0}
              >
                {synchronizing
                  ? "Menyinkronkan..."
                  : `Mapping Otomatis ${syncStatus.will_map} TID`}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {successMessage ? (
        <div className="user-role-toast" role="status">
          {successMessage}
          <button type="button" onClick={() => setSuccessMessage("")} aria-label="Tutup notifikasi">×</button>
        </div>
      ) : null}
    </div>
  )
}
