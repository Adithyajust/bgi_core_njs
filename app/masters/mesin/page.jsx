"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useAppBootstrap } from "@/components/app-bootstrap-context"

import {
  validateMachineImportRows,
} from "@/modules/master-mesin/import-validation"
import {
  getRowVersionToken,
  normalizeRowVersionToken,
} from "@/modules/master-mesin/row-version"
import {
  parseMachineSpreadsheet,
} from "@/modules/master-mesin/spreadsheet-parser"

const FALLBACK_CATEGORIES = [
  "ALFAMART",
  "ALFAMIDI",
  "APARTEMEN",
  "APOTEK",
  "BANDARA",
  "BIKE THRU",
  "BRI AGRO",
  "DRIVE THRU",
  "GTI",
  "HOTEL",
  "INDOMARET",
  "INSTANSI BUMN/BUMD",
  "INSTANSI MILITER",
  "INSTANSI PEMERINTAHAN",
  "KANINS",
  "KANTOR PUSAT",
  "KANWIL",
  "KC",
  "KCP",
  "KEPOLISIAN",
  "KK",
  "KLINIK",
  "MALL",
  "MINI MARKET",
  "PABRIK",
  "PANGKALAN MILITER",
  "PASAR",
  "PELABUHAN",
  "PERKANTORAN",
  "PERKEBUNAN",
  "PERTAMBANGAN",
  "PERTOKOAN",
  "PERUMAHAN",
  "PLAZA",
  "RUMAH MAKAN",
  "RUMAH SAKIT",
  "SPBU",
  "STASIUN",
  "SWALAYAN",
  "TEMPAT HIBURAN",
  "TEMPAT IBADAH",
  "TEMPAT OLAHRAGA",
  "TEMPAT PENDIDIKAN",
  "TEMPAT WISATA",
  "TERAS BRI",
  "TERMINAL",
  "UNIT BRI",
]

const FALLBACK_SITES = ["ONSITE", "OFFSITE"]
const FALLBACK_WARRANTIES = ["IN WARRANTY", "OUT WARRANTY"]
const FALLBACK_OPERATION_DAYS = ["WEEKDAYS", "ALL DAYS"]
const FALLBACK_OPERATION_HOURS = ["24 JAM", "NON 24 JAM"]
const FALLBACK_OPERATION_TIMES = [
  "00:00 - 23:59",
  "06:00 - 15:00",
  "06:00 - 18:00",
  "06:00 - 21:00",
  "09:00 - 15:00",
  "09:00 - 18:00",
  "09:00 - 21:00",
]

const EMPTY_FORM = {
  row_version: "",
  updated_at: "",
  tid: "",
  sn: "",
  db: "",
  denom: "",
  cabang_id: "",
  project_id: "",
  lokasi: "",
  site: "OFFSITE",
  tipe_mesin_id: "",
  kategori_mesin: "",
  kategori_lokasi: "",
  garansi: "IN WARRANTY",
  hari_ops: "ALL DAYS",
  jam_ops: "24 JAM",
  waktu_ops: "00:00 - 23:59",
  longitude: "",
  latitude: "",
  is_active: true,
}

function formatDateTime(value) {
  if (!value) {
    return "-"
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function formatCoordinate(value) {
  if (value === null || value === undefined || value === "") {
    return "-"
  }

  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toFixed(6) : "-"
}

async function readJsonResponse(response) {
  const contentType = response.headers.get("content-type") || ""

  if (!contentType.includes("application/json")) {
    throw new Error(
      `Endpoint tidak mengembalikan JSON. Status ${response.status}.`
    )
  }

  return response.json()
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...options,
  })

  const result = await readJsonResponse(response)

  if (!response.ok || !result.success) {
    const error = new Error(result.message || "Permintaan gagal diproses.")
    error.status = response.status
    error.payload = result
    throw error
  }

  return result
}

function getErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback
}

function formatFileSize(size) {
  const bytes = Number(size || 0)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function mapToForm(item) {
  return {
    row_version: getRowVersionToken(item),
    updated_at: String(item?.updated_at || ""),
    tid: String(item?.tid || ""),
    sn: String(item?.sn || ""),
    db: String(item?.db || ""),
    denom: String(item?.denom || ""),
    cabang_id: String(item?.cabang_id || ""),
    project_id: String(item?.project_id || ""),
    lokasi: String(item?.lokasi || ""),
    site: String(item?.site || "OFFSITE"),
    tipe_mesin_id: String(item?.tipe_mesin_id || ""),
    kategori_mesin: String(item?.kategori_mesin || item?.jenis_mesin || ""),
    kategori_lokasi: String(item?.kategori_lokasi || item?.kategori || ""),
    garansi: String(item?.garansi || "IN WARRANTY"),
    hari_ops: String(item?.hari_ops || "ALL DAYS"),
    jam_ops: String(item?.jam_ops || "24 JAM"),
    waktu_ops: String(item?.waktu_ops || "00:00 - 23:59"),
    longitude:
      item?.longitude === null || item?.longitude === undefined
        ? ""
        : String(item.longitude),
    latitude:
      item?.latitude === null || item?.latitude === undefined
        ? ""
        : String(item.latitude),
    is_active: Boolean(item?.is_active),
  }
}



function AutocompleteSelect({
  id,
  name,
  value,
  onChange,
  options,
  placeholder = "Pilih data",
  disabled = false,
  allowClear = true,
  className = "",
}) {
  const rootRef = useRef(null)
  const selectedOption = useMemo(
    () => options.find((option) => String(option.value) === String(value)) || null,
    [options, value]
  )
  const [draftQuery, setDraftQuery] = useState("")
  const [isEditing, setIsEditing] = useState(false)
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)

  const inputValue = isEditing
    ? draftQuery
    : selectedOption?.label || ""

  const filteredOptions = useMemo(() => {
    const normalizedQuery = isEditing
      ? draftQuery.trim().toLocaleLowerCase("id-ID")
      : ""

    if (!normalizedQuery) {
      return options
    }

    return options.filter((option) => {
      const haystack = `${option.label} ${option.searchText || ""}`
        .toLocaleLowerCase("id-ID")
      return haystack.includes(normalizedQuery)
    })
  }, [draftQuery, isEditing, options])

  useEffect(() => {
    function handleOutsideClick(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setIsEditing(false)
        setDraftQuery("")
        setOpen(false)
      }
    }

    document.addEventListener("mousedown", handleOutsideClick)
    return () => document.removeEventListener("mousedown", handleOutsideClick)
  }, [])

  function selectOption(option) {
    onChange(String(option.value))
    setIsEditing(false)
    setDraftQuery("")
    setOpen(false)
    setHighlightedIndex(0)
  }

  function handleInputChange(event) {
    const nextQuery = event.target.value
    setIsEditing(true)
    setDraftQuery(nextQuery)
    setOpen(true)
    setHighlightedIndex(0)

    if (selectedOption && nextQuery !== selectedOption.label) {
      onChange("")
    }
  }

  function handleKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setHighlightedIndex((current) =>
        !open || filteredOptions.length === 0
          ? 0
          : Math.min(current + 1, filteredOptions.length - 1)
      )
      setOpen(true)
      return
    }

    if (event.key === "ArrowUp") {
      event.preventDefault()
      setHighlightedIndex((current) =>
        !open || filteredOptions.length === 0
          ? Math.max(filteredOptions.length - 1, 0)
          : Math.max(current - 1, 0)
      )
      setOpen(true)
      return
    }

    if (event.key === "Enter" && open) {
      event.preventDefault()
      const option = filteredOptions[highlightedIndex]
      if (option) {
        selectOption(option)
      }
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      setIsEditing(false)
      setDraftQuery("")
      setOpen(false)
    }
  }

  const hasClearButton = Boolean(value && !disabled && allowClear)
  const rootClassName = [
    "machine-autocomplete",
    open ? "is-open" : "",
    disabled ? "is-disabled" : "",
    hasClearButton ? "has-clear" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <div className={rootClassName} ref={rootRef}>
      <input type="hidden" name={name} value={value} />

      <div className="machine-autocomplete-control">
        <input
          id={id}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => {
            setOpen(true)
            setHighlightedIndex(0)
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={`${id}-options`}
          aria-activedescendant={
            open && filteredOptions[highlightedIndex]
              ? `${id}-option-${highlightedIndex}`
              : undefined
          }
        />

        {hasClearButton ? (
          <button
            type="button"
            className="machine-autocomplete-clear"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange("")
              setIsEditing(true)
              setDraftQuery("")
              setHighlightedIndex(0)
              setOpen(true)
            }}
            aria-label={`Hapus pilihan ${placeholder}`}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        ) : null}

        <button
          type="button"
          className="machine-autocomplete-toggle"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setOpen((current) => !current)
            setHighlightedIndex(0)
          }}
          disabled={disabled}
          aria-label={`${open ? "Tutup" : "Buka"} pilihan ${placeholder}`}
          aria-expanded={open}
          aria-controls={`${id}-options`}
          tabIndex={-1}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>

      {open && !disabled ? (
        <div
          id={`${id}-options`}
          className="machine-autocomplete-options"
          role="listbox"
        >
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option, index) => (
              <button
                id={`${id}-option-${index}`}
                type="button"
                key={String(option.value)}
                className={index === highlightedIndex ? "highlighted" : ""}
                onMouseEnter={() => setHighlightedIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option)}
                role="option"
                aria-selected={String(option.value) === String(value)}
              >
                {option.label}
              </button>
            ))
          ) : (
            <div className="machine-autocomplete-empty">Data tidak ditemukan.</div>
          )}
        </div>
      ) : null}
    </div>
  )
}

function mergeAutocompleteOptions(...groups) {
  const optionMap = new Map()

  for (const group of groups) {
    for (const option of Array.isArray(group) ? group : []) {
      if (!option || option.value === undefined || option.value === null) {
        continue
      }

      optionMap.set(String(option.value), {
        ...option,
        value: String(option.value),
      })
    }
  }

  return Array.from(optionMap.values())
}

function AsyncAutocompleteSelect({
  id,
  name,
  value,
  onChange,
  source,
  placeholder = "Cari data",
  disabled = false,
  allowClear = true,
  className = "",
  emptyOptionLabel = "",
  initialOption = null,
  limit = 20,
}) {
  const rootRef = useRef(null)
  const requestSequenceRef = useRef(0)
  const [selectedOption, setSelectedOption] = useState(null)
  const [draftQuery, setDraftQuery] = useState("")
  const [isEditing, setIsEditing] = useState(false)
  const [options, setOptions] = useState([])
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState("")
  const [nextCursor, setNextCursor] = useState(null)
  const [hasMore, setHasMore] = useState(false)

  const normalizedValue = value ? String(value) : ""
  const normalizedInitialOption = useMemo(() => {
    if (
      !normalizedValue ||
      !initialOption ||
      String(initialOption.value) !== normalizedValue
    ) {
      return null
    }

    return {
      ...initialOption,
      value: normalizedValue,
    }
  }, [initialOption, normalizedValue])
  const normalizedSelectedOption =
    selectedOption && String(selectedOption.value) === normalizedValue
      ? selectedOption
      : null
  const resolvedSelectedOption =
    normalizedSelectedOption || normalizedInitialOption
  const selectedValue = resolvedSelectedOption
    ? String(resolvedSelectedOption.value)
    : ""
  const selectedLabel = resolvedSelectedOption?.label || ""
  const inputValue = isEditing ? draftQuery : selectedLabel
  const searchTerm = isEditing ? draftQuery.trim() : ""

  useEffect(() => {
    function handleOutsideClick(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setIsEditing(false)
        setDraftQuery("")
        setOpen(false)
      }
    }

    document.addEventListener("mousedown", handleOutsideClick)
    return () => document.removeEventListener("mousedown", handleOutsideClick)
  }, [])

  useEffect(() => {
    const needsSelectedLookup = Boolean(
      normalizedValue && selectedValue !== normalizedValue
    )

    if (disabled || (!open && !needsSelectedLookup)) {
      return undefined
    }

    const controller = new AbortController()
    const requestId = requestSequenceRef.current + 1
    requestSequenceRef.current = requestId
    const delay = isEditing ? 300 : 0

    const timer = window.setTimeout(async () => {
      try {
        setLoading(true)
        setError("")

        const params = new URLSearchParams({
          mode: "autocomplete",
          source,
          limit: String(limit),
        })

        if (searchTerm) {
          params.set("q", searchTerm)
        }

        if (normalizedValue) {
          params.set("selected_id", normalizedValue)
        }

        const result = await requestJson(
          `/api/masters/mesin?${params.toString()}`,
          {
            method: "GET",
            signal: controller.signal,
          }
        )

        if (controller.signal.aborted || requestSequenceRef.current !== requestId) {
          return
        }

        const resultItems = Array.isArray(result.data?.items)
          ? result.data.items
          : []
        const resultSelected = result.data?.selected || null
        const emptyOption = emptyOptionLabel
          ? [{ value: "", label: emptyOptionLabel }]
          : []

        setOptions(
          mergeAutocompleteOptions(
            emptyOption,
            resultSelected ? [resultSelected] : [],
            resultItems
          )
        )
        setHasMore(Boolean(result.data?.pagination?.has_more))
        setNextCursor(result.data?.pagination?.next_cursor || null)
        setHighlightedIndex(0)

        if (
          resultSelected &&
          normalizedValue &&
          String(resultSelected.value) === normalizedValue
        ) {
          setSelectedOption({
            ...resultSelected,
            value: normalizedValue,
          })
        }
      } catch (fetchError) {
        if (fetchError?.name === "AbortError") {
          return
        }

        setOptions(
          emptyOptionLabel ? [{ value: "", label: emptyOptionLabel }] : []
        )
        setHasMore(false)
        setNextCursor(null)
        setError(
          getErrorMessage(fetchError, "Data autocomplete gagal dimuat.")
        )
      } finally {
        if (!controller.signal.aborted && requestSequenceRef.current === requestId) {
          setLoading(false)
        }
      }
    }, delay)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [
    disabled,
    emptyOptionLabel,
    isEditing,
    limit,
    normalizedValue,
    open,
    searchTerm,
    selectedValue,
    source,
  ])

  async function loadMoreOptions() {
    if (!nextCursor || loading || loadingMore) {
      return
    }

    try {
      setLoadingMore(true)
      setError("")

      const params = new URLSearchParams({
        mode: "autocomplete",
        source,
        limit: String(limit),
        after_id: String(nextCursor),
      })

      if (searchTerm) {
        params.set("q", searchTerm)
      }

      if (normalizedValue) {
        params.set("selected_id", normalizedValue)
      }

      const result = await requestJson(
        `/api/masters/mesin?${params.toString()}`,
        { method: "GET" }
      )
      const resultItems = Array.isArray(result.data?.items)
        ? result.data.items
        : []

      setOptions((current) => mergeAutocompleteOptions(current, resultItems))
      setHasMore(Boolean(result.data?.pagination?.has_more))
      setNextCursor(result.data?.pagination?.next_cursor || null)
    } catch (fetchError) {
      setError(
        getErrorMessage(fetchError, "Data berikutnya gagal dimuat.")
      )
    } finally {
      setLoadingMore(false)
    }
  }

  function selectOption(option) {
    if (option?.disabled) {
      return
    }

    const nextValue = String(option?.value || "")

    if (!nextValue) {
      setSelectedOption(null)
      onChange("", null)
    } else {
      const normalizedOption = { ...option, value: nextValue }
      setSelectedOption(normalizedOption)
      onChange(nextValue, normalizedOption)
    }

    setIsEditing(false)
    setDraftQuery("")
    setOpen(false)
    setHighlightedIndex(0)
  }

  function handleInputChange(event) {
    const nextQuery = event.target.value
    setIsEditing(true)
    setDraftQuery(nextQuery)
    setOpen(true)
    setHighlightedIndex(0)

    if (normalizedValue) {
      setSelectedOption(null)
      onChange("", null)
    }
  }

  function handleKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setHighlightedIndex((current) =>
        !open || options.length === 0
          ? 0
          : Math.min(current + 1, options.length - 1)
      )
      setOpen(true)
      return
    }

    if (event.key === "ArrowUp") {
      event.preventDefault()
      setHighlightedIndex((current) =>
        !open || options.length === 0
          ? Math.max(options.length - 1, 0)
          : Math.max(current - 1, 0)
      )
      setOpen(true)
      return
    }

    if (event.key === "Enter" && open) {
      event.preventDefault()
      const option = options[highlightedIndex]
      if (option) {
        selectOption(option)
      }
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      setIsEditing(false)
      setDraftQuery("")
      setOpen(false)
    }
  }

  const hasClearButton = Boolean(normalizedValue && !disabled && allowClear)
  const rootClassName = [
    "machine-autocomplete",
    "machine-autocomplete-remote",
    open ? "is-open" : "",
    disabled ? "is-disabled" : "",
    hasClearButton ? "has-clear" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <div className={rootClassName} ref={rootRef}>
      <input type="hidden" name={name} value={normalizedValue} />

      <div className="machine-autocomplete-control">
        <input
          id={id}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => {
            setOpen(true)
            setHighlightedIndex(0)
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={`${id}-options`}
          aria-activedescendant={
            open && options[highlightedIndex]
              ? `${id}-option-${highlightedIndex}`
              : undefined
          }
        />

        {hasClearButton ? (
          <button
            type="button"
            className="machine-autocomplete-clear"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setSelectedOption(null)
              setIsEditing(true)
              setDraftQuery("")
              setHighlightedIndex(0)
              setOpen(true)
              onChange("", null)
            }}
            aria-label={`Hapus pilihan ${placeholder}`}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        ) : null}

        <button
          type="button"
          className="machine-autocomplete-toggle"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setOpen((current) => !current)
            setHighlightedIndex(0)
          }}
          disabled={disabled}
          aria-label={`${open ? "Tutup" : "Buka"} pilihan ${placeholder}`}
          aria-expanded={open}
          aria-controls={`${id}-options`}
          tabIndex={-1}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>

      {open && !disabled ? (
        <div
          id={`${id}-options`}
          className="machine-autocomplete-options"
          role="listbox"
        >
          {loading && options.length === 0 ? (
            <div className="machine-autocomplete-empty">Mencari data...</div>
          ) : options.length > 0 ? (
            <>
              {options.map((option, index) => (
                <button
                  id={`${id}-option-${index}`}
                  type="button"
                  key={String(option.value || `empty-${index}`)}
                  className={index === highlightedIndex ? "highlighted" : ""}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(option)}
                  role="option"
                  aria-selected={String(option.value) === normalizedValue}
                  aria-disabled={Boolean(option.disabled)}
                  disabled={Boolean(option.disabled)}
                >
                  {option.label}
                </button>
              ))}

              {hasMore ? (
                <button
                  type="button"
                  className="machine-autocomplete-load-more"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={loadMoreOptions}
                  disabled={loadingMore}
                >
                  {loadingMore ? "Memuat..." : "Muat lainnya"}
                </button>
              ) : null}
            </>
          ) : (
            <div className="machine-autocomplete-empty">
              {error || "Data tidak ditemukan."}
            </div>
          )}

          {error && options.length > 0 ? (
            <div className="machine-autocomplete-empty error">{error}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default function MasterMesinPage() {
  const router = useRouter()
  const { user: currentUser } = useAppBootstrap()
  const toastTimerRef = useRef(null)
  const importFileInputRef = useRef(null)

  const [constantOptions, setConstantOptions] = useState({
    machine_categories: [],
    categories: FALLBACK_CATEGORIES,
    sites: FALLBACK_SITES,
    warranties: FALLBACK_WARRANTIES,
    operation_days: FALLBACK_OPERATION_DAYS,
    operation_hours: FALLBACK_OPERATION_HOURS,
    operation_times: FALLBACK_OPERATION_TIMES,
  })

  const [mesins, setMesins] = useState([])
  const [summary, setSummary] = useState({
    total: 0,
    active: 0,
    onsite: 0,
    offsite: 0,
    in_warranty: 0,
  })
  const [pagination, setPagination] = useState({
    page_size: 10,
    has_more: false,
    next_cursor: null,
  })

  const [searchText, setSearchText] = useState("")
  const [cabangFilter, setCabangFilter] = useState("")
  const [projectFilter, setProjectFilter] = useState("")
  const [tipeMesinFilter, setTipeMesinFilter] = useState("")
  const [kategoriMesinFilter, setKategoriMesinFilter] = useState("")
  const [denomFilter, setDenomFilter] = useState("")
  const [kategoriLokasiFilter, setKategoriLokasiFilter] = useState("")
  const [siteFilter, setSiteFilter] = useState("")
  const [activeFilter, setActiveFilter] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [afterId, setAfterId] = useState("")
  const [cursorHistory, setCursorHistory] = useState([])
  const [refreshKey, setRefreshKey] = useState(0)

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [optionsError, setOptionsError] = useState("")
  const [optionsLoading, setOptionsLoading] = useState(true)
  const [dataNotice, setDataNotice] = useState("")
  const [schemaInfo, setSchemaInfo] = useState({ tid_enabled: true, denom_enabled: true })
  const [permissionInfo, setPermissionInfo] = useState({
    can_view: true,
    can_create: false,
    can_update: false,
    can_delete: false,
  })

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formInitialOptions, setFormInitialOptions] = useState({
    cabang: null,
    project: null,
    tipe_mesin: null,
  })
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState("")

  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importRows, setImportRows] = useState([])
  const [importErrors, setImportErrors] = useState([])
  const [importError, setImportError] = useState("")
  const [importParsing, setImportParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importDragActive, setImportDragActive] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState("")

  const [toast, setToast] = useState({
    open: false,
    type: "success",
    message: "",
  })

  const isSuperAdmin = currentUser?.roleCode === "SUPER_ADMIN"
  const canCreate = isSuperAdmin || Boolean(permissionInfo.can_create)
  const canUpdate = isSuperAdmin || Boolean(permissionInfo.can_update)
  const canDelete = isSuperAdmin || Boolean(permissionInfo.can_delete)
  const canManage = canUpdate || canDelete
  const kategoriMesinOptions = useMemo(
    () =>
      Array.from(
        new Set(
          (constantOptions.machine_categories || [])
            .map((item) => String(item || "").trim().toUpperCase())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b, "id")),
    [constantOptions.machine_categories]
  )
  const formOptionsReady =
    schemaInfo.tid_enabled &&
    schemaInfo.denom_enabled &&
    !optionsLoading &&
    !optionsError
  const importErrorRows = new Set(
    importErrors
      .map((error) => Number(error.row))
      .filter((row) => Number.isSafeInteger(row) && row > 0)
  )
  const importInvalidCount = importErrorRows.size
  const importValidCount = Math.max(0, importRows.length - importInvalidCount)
  const importErrorsByRow = new Map()

  importErrors.forEach((error) => {
    const rowNumber = Number(error.row)
    if (!Number.isSafeInteger(rowNumber) || rowNumber <= 0) return

    const rowErrors = importErrorsByRow.get(rowNumber) || []
    rowErrors.push(error.message)
    importErrorsByRow.set(rowNumber, rowErrors)
  })

  const importPreviewRows =
    importErrors.length > 0
      ? importRows
          .filter((row) => importErrorRows.has(Number(row._row_number)))
          .slice(0, 10)
      : importRows.slice(0, 10)

  function resetListCursor() {
    setPage(1)
    setAfterId("")
    setCursorHistory([])
  }

  useEffect(() => {
    const controller = new AbortController()

    async function loadIdentityAndOptions() {
      setOptionsLoading(true)
      setOptionsError("")

      try {
        const optionsResult = await requestJson(
          "/api/masters/mesin?mode=bootstrap",
          {
            method: "GET",
            signal: controller.signal,
          }
        )

        if (!controller.signal.aborted) {
          setSchemaInfo(
            optionsResult.data?.schema || { tid_enabled: true, denom_enabled: true }
          )
          setPermissionInfo(
            optionsResult.data?.scope || {
              can_view: true,
              can_create: false,
              can_update: false,
              can_delete: false,
            }
          )
          setConstantOptions((current) => {
            const constants = optionsResult.data?.constants || {}
            return {
              ...current,
              ...constants,
              categories:
                constants.location_categories ||
                constants.categories ||
                current.categories,
            }
          })
        }
      } catch (error) {
        if (error?.name === "AbortError") {
          return
        }

        if (error?.status === 401) {
          router.replace(`/login?next=${encodeURIComponent("/masters/mesin")}`)
          return
        }

        if (error?.status === 403) {
          router.replace("/forbidden")
          return
        }

        setOptionsError(
          getErrorMessage(
            error,
            "Gagal mengambil konfigurasi Master Mesin."
          )
        )
      } finally {
        if (!controller.signal.aborted) {
          setOptionsLoading(false)
        }
      }
    }

    void loadIdentityAndOptions()

    return () => controller.abort()
  }, [refreshKey, router])

  useEffect(() => {
    const controller = new AbortController()

    async function loadSummary() {
      try {
        const result = await requestJson("/api/masters/mesin?mode=summary", {
          method: "GET",
          signal: controller.signal,
        })

        if (!controller.signal.aborted) {
          setSummary(
            result.data?.summary || {
              total: 0,
              active: 0,
              onsite: 0,
              offsite: 0,
              in_warranty: 0,
            }
          )
        }
      } catch (error) {
        if (error?.name !== "AbortError") {
          console.error("Gagal memuat summary Mesin:", error)
        }
      }
    }

    void loadSummary()
    return () => controller.abort()
  }, [refreshKey])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        setLoadError("")

        if (refreshKey > 0) {
          setRefreshing(true)
        } else {
          setLoading(true)
        }

        const params = new URLSearchParams({
          page_size: String(pageSize),
        })

        if (afterId) {
          params.set("after_id", afterId)
        }

        if (searchText.trim()) {
          params.set("search", searchText.trim())
        }

        if (cabangFilter) {
          params.set("cabang_id", cabangFilter)
        }

        if (projectFilter) {
          params.set("project_id", projectFilter)
        }

        if (tipeMesinFilter) {
          params.set("tipe_mesin_id", tipeMesinFilter)
        }

        if (kategoriMesinFilter) {
          params.set("kategori_mesin", kategoriMesinFilter)
        }

        if (denomFilter.trim()) {
          params.set("denom", denomFilter.trim().toUpperCase())
        }

        if (kategoriLokasiFilter) {
          params.set("kategori_lokasi", kategoriLokasiFilter)
        }

        if (siteFilter) {
          params.set("site", siteFilter)
        }

        if (activeFilter) {
          params.set("is_active", activeFilter)
        }

        const result = await requestJson(
          `/api/masters/mesin?${params.toString()}`,
          {
            method: "GET",
            signal: controller.signal,
          }
        )

        if (!controller.signal.aborted) {
          setMesins(
            Array.isArray(result.data?.mesins) ? result.data.mesins : []
          )
          setPagination(
            result.data?.pagination || {
              page_size: pageSize,
              has_more: false,
              next_cursor: null,
            }
          )
          setSchemaInfo(result.data?.schema || { tid_enabled: true, denom_enabled: true })
          setDataNotice(String(result.data?.notice || ""))
        }
      } catch (error) {
        if (error?.name === "AbortError") {
          return
        }

        if (error?.status === 401) {
          router.replace(`/login?next=${encodeURIComponent("/masters/mesin")}`)
          return
        }

        if (error?.status === 403) {
          router.replace("/forbidden")
          return
        }

        setLoadError(getErrorMessage(error, "Gagal mengambil data Mesin."))
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }, searchText ? 300 : 0)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [
    activeFilter,
    cabangFilter,
    denomFilter,
    kategoriLokasiFilter,
    kategoriMesinFilter,
    afterId,
    pageSize,
    projectFilter,
    refreshKey,
    router,
    searchText,
    siteFilter,
    tipeMesinFilter,
  ])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!modalOpen && !importModalOpen && !deleteTarget) {
      return undefined
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    function handleEscape(event) {
      if (
        event.key !== "Escape" ||
        saving ||
        deleting ||
        importing ||
        importParsing
      ) {
        return
      }

      if (deleteTarget) {
        setDeleteTarget(null)
        setDeleteError("")
      } else if (importModalOpen) {
        setImportModalOpen(false)
        resetImportState()
      } else {
        setModalOpen(false)
        setModalError("")
      }
    }

    window.addEventListener("keydown", handleEscape)

    return () => {
      window.removeEventListener("keydown", handleEscape)
      document.body.style.overflow = previousOverflow
    }
  }, [
    deleteTarget,
    deleting,
    importModalOpen,
    importing,
    importParsing,
    modalOpen,
    saving,
  ])

  function showToast(message, type = "success") {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current)
    }

    setToast({ open: true, type, message })
    toastTimerRef.current = window.setTimeout(() => {
      setToast((current) => ({ ...current, open: false }))
    }, 4000)
  }

  function updateForm(name, value) {
    setForm((current) => ({ ...current, [name]: value }))
  }

  function openCreateModal() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormInitialOptions({
      cabang: null,
      project: null,
      tipe_mesin: null,
    })
    setModalError("")
    setModalOpen(true)
  }

  function setEditFormData(item) {
    setEditingId(item.id)
    setForm(mapToForm(item))
    setFormInitialOptions({
      cabang: item?.cabang_id
        ? {
            value: String(item.cabang_id),
            label: `${item.kode_cabang || "-"} · ${item.nama_cabang || "Cabang"} · ${item.nama_kanwil || "Kanwil"}`,
          }
        : null,
      project: item?.project_id
        ? {
            value: String(item.project_id),
            label: `${item.kode_project || "-"} · ${item.nama_project || "Project"}`,
          }
        : null,
      tipe_mesin: item?.tipe_mesin_id
        ? {
            value: String(item.tipe_mesin_id),
            label: `${item.nama_merk || "Merk"} · ${item.jenis_mesin || "Jenis"} · ${item.nama_model || "Model"}`,
            data: {
              jenis_mesin: item.jenis_mesin || item.kategori_mesin || "",
            },
          }
        : null,
    })
  }

  async function openEditModal(item) {
    try {
      setModalError("")
      const result = await requestJson(
        `/api/masters/mesin?mode=detail&id=${encodeURIComponent(item.id)}`,
        { method: "GET" }
      )
      const detailItem = result.data?.mesin
      const currentItem = detailItem
        ? { ...item, ...detailItem }
        : item
      const rowVersion =
        getRowVersionToken(currentItem) ||
        normalizeRowVersionToken(result.data?.version?.row_version) ||
        getRowVersionToken(item)

      if (!currentItem?.id) {
        throw new Error("Data Mesin tidak ditemukan.")
      }

      setEditFormData({
        ...currentItem,
        row_version: rowVersion,
        updated_at: currentItem.updated_at || item.updated_at || "",
      })
      setModalOpen(true)
    } catch (error) {
      const fallbackRowVersion = getRowVersionToken(item)

      if (item?.id && (fallbackRowVersion || item?.updated_at)) {
        setEditFormData({
          ...item,
          row_version: fallbackRowVersion,
        })
        setModalOpen(true)
        return
      }

      showToast(
        getErrorMessage(error, "Gagal mengambil data Mesin terbaru."),
        "error"
      )
    }
  }

  function closeModal() {
    if (saving) {
      return
    }

    setModalOpen(false)
    setModalError("")
  }

  function resetImportState() {
    setImportFile(null)
    setImportRows([])
    setImportErrors([])
    setImportError("")
    setImportParsing(false)
    setImportDragActive(false)

    if (importFileInputRef.current) {
      importFileInputRef.current.value = ""
    }
  }

  function openImportModal() {
    resetImportState()
    setImportModalOpen(true)
  }

  function closeImportModal() {
    if (importing || importParsing) return

    setImportModalOpen(false)
    resetImportState()
  }

  async function processImportFile(file) {
    if (!file) return

    setImportFile(file)
    setImportRows([])
    setImportErrors([])
    setImportError("")
    setImportParsing(true)

    try {
      const parsedRows = await parseMachineSpreadsheet(file)
      const validation = validateMachineImportRows(parsedRows)
      setImportRows(validation.rows)
      setImportErrors(validation.errors)
    } catch (error) {
      setImportError(getErrorMessage(error, "File mesin gagal dibaca."))
    } finally {
      setImportParsing(false)
    }
  }

  function handleImportFileChange(event) {
    const file = event.target.files?.[0] || null
    void processImportFile(file)
  }

  function handleImportDrop(event) {
    event.preventDefault()
    setImportDragActive(false)

    const file = event.dataTransfer.files?.[0] || null
    void processImportFile(file)
  }

  async function handleImportSubmit() {
    if (importRows.length === 0 || importErrors.length > 0) return

    setImporting(true)
    setImportError("")

    try {
      const result = await requestJson("/api/masters/mesin/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: importRows }),
      })

      setImportModalOpen(false)
      resetImportState()
      resetListCursor()
      setRefreshKey((current) => current + 1)
      showToast(result.message || "Data mesin berhasil diupload.")
    } catch (error) {
      if (error?.status === 401) {
        router.replace(`/login?next=${encodeURIComponent("/masters/mesin")}`)
        return
      }

      if (error?.status === 403) {
        router.replace("/forbidden")
        return
      }

      const serverErrors = error?.payload?.data?.errors
      if (Array.isArray(serverErrors)) {
        setImportErrors(serverErrors)
      }

      setImportError(getErrorMessage(error, "Data mesin gagal diupload."))
    } finally {
      setImporting(false)
    }
  }

  function handleJamOpsChange(value) {
    setForm((current) => ({
      ...current,
      jam_ops: value,
      waktu_ops:
        value === "24 JAM"
          ? "00:00 - 23:59"
          : current.waktu_ops === "00:00 - 23:59"
            ? "06:00 - 15:00"
            : current.waktu_ops,
    }))
  }

  function handleTipeMesinChange(value, option) {
    const jenisMesin = String(option?.data?.jenis_mesin || "")
      .trim()
      .toUpperCase()

    setForm((current) => ({
      ...current,
      tipe_mesin_id: value,
      kategori_mesin: value ? jenisMesin : "",
    }))
  }

  function validateForm() {
    if (!form.tid.trim()) {
      return "TID wajib diisi."
    }

    if (!form.sn.trim()) {
      return "SN wajib diisi."
    }

    if (form.tid.trim().toUpperCase() === form.sn.trim().toUpperCase()) {
      return "TID dan SN tidak boleh memiliki nilai yang sama."
    }

    if (!form.denom.trim()) {
      return "Denom wajib diisi."
    }

    if (form.denom.trim().length > 50) {
      return "Denom maksimal 50 karakter."
    }

    if (!form.cabang_id) {
      return "Cabang pengelola wajib dipilih."
    }

    if (!form.project_id) {
      return "Project wajib dipilih."
    }

    if (!form.tipe_mesin_id) {
      return "Tipe Mesin wajib dipilih."
    }

    if (!form.lokasi.trim()) {
      return "Lokasi fisik mesin wajib diisi."
    }

    if (!form.kategori_mesin) {
      return "Kategori Mesin belum tersedia dari Tipe Mesin yang dipilih."
    }

    if (!form.kategori_lokasi) {
      return "Kategori Lokasi wajib dipilih."
    }

    if (form.longitude !== "") {
      const longitude = Number(form.longitude)

      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        return "Longitude harus berupa angka antara -180 sampai 180."
      }
    }

    if (form.latitude !== "") {
      const latitude = Number(form.latitude)

      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
        return "Latitude harus berupa angka antara -90 sampai 90."
      }
    }

    if (form.jam_ops === "24 JAM" && form.waktu_ops !== "00:00 - 23:59") {
      return "Jam Operasional 24 JAM harus memakai waktu 00:00 - 23:59."
    }

    if (form.jam_ops === "NON 24 JAM" && form.waktu_ops === "00:00 - 23:59") {
      return "Jam Operasional NON 24 JAM harus memakai rentang waktu non-24 jam."
    }

    return ""
  }

  async function handleSubmit(event) {
    event.preventDefault()

    const validationError = validateForm()

    if (validationError) {
      setModalError(validationError)
      return
    }

    try {
      setSaving(true)
      setModalError("")

      const payload = {
        ...(editingId
          ? {
              id: editingId,
              row_version: normalizeRowVersionToken(form.row_version),
              updated_at: form.updated_at,
            }
          : {}),
        tid: form.tid.trim().toUpperCase(),
        sn: form.sn.trim().toUpperCase(),
        db: form.db.trim(),
        denom: form.denom.trim().toUpperCase(),
        cabang_id: Number(form.cabang_id),
        project_id: Number(form.project_id),
        lokasi: form.lokasi.trim(),
        site: form.site,
        tipe_mesin_id: Number(form.tipe_mesin_id),
        kategori_mesin: form.kategori_mesin,
        kategori_lokasi: form.kategori_lokasi,
        garansi: form.garansi,
        hari_ops: form.hari_ops,
        jam_ops: form.jam_ops,
        waktu_ops: form.waktu_ops,
        longitude: form.longitude === "" ? null : Number(form.longitude),
        latitude: form.latitude === "" ? null : Number(form.latitude),
        is_active: form.is_active,
      }

      const result = await requestJson("/api/masters/mesin", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      setModalOpen(false)
      setEditingId(null)
      setForm(EMPTY_FORM)
      resetListCursor()
      setRefreshKey((current) => current + 1)
      showToast(result.message || "Data Mesin berhasil disimpan.")
    } catch (error) {
      if (error?.status === 401) {
        router.replace(`/login?next=${encodeURIComponent("/masters/mesin")}`)
        return
      }

      if (error?.status === 403) {
        router.replace("/forbidden")
        return
      }

      setModalError(getErrorMessage(error, "Gagal menyimpan data Mesin."))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) {
      return
    }

    try {
      setDeleting(true)
      setDeleteError("")

      const result = await requestJson("/api/masters/mesin", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id }),
      })

      setDeleteTarget(null)
      resetListCursor()
      setRefreshKey((current) => current + 1)
      showToast(result.message || "Data Mesin berhasil dihapus.")
    } catch (error) {
      if (error?.status === 401) {
        router.replace(`/login?next=${encodeURIComponent("/masters/mesin")}`)
        return
      }

      if (error?.status === 403) {
        router.replace("/forbidden")
        return
      }

      setDeleteError(getErrorMessage(error, "Gagal menghapus data Mesin."))
    } finally {
      setDeleting(false)
    }
  }

  function resetFilters() {
    setSearchText("")
    setCabangFilter("")
    setProjectFilter("")
    setTipeMesinFilter("")
    setKategoriMesinFilter("")
    setDenomFilter("")
    setKategoriLokasiFilter("")
    setSiteFilter("")
    setActiveFilter("")
    resetListCursor()
  }

  return (
    <div className="simple-page user-role-page machine-page">
      <section className="page-heading-card user-role-heading">
        <div>
          <div className="machine-heading-kicker">
            <p className="eyebrow">Master Data</p>
            <span className="machine-revision-badge">Server Autocomplete</span>
          </div>
          <h2>Master Mesin</h2>
          <p>
            Kelola TID, identitas dan denom mesin, cabang pengelola, project,
            tipe mesin, lokasi fisik, operasional, garansi, dan koordinat penempatan.
          </p>
        </div>

        <div className="user-role-toolbar-actions">
          <Link href="/masters" className="user-role-button secondary">
            Kembali
          </Link>
          {canCreate ? (
            <>
              <button
                type="button"
                className="user-role-button secondary"
                onClick={openImportModal}
                disabled={!formOptionsReady}
                title={
                  !schemaInfo.tid_enabled
                    ? "Jalankan migration 011 terlebih dahulu"
                    : !schemaInfo.denom_enabled
                      ? "Jalankan migration 030 terlebih dahulu"
                      : optionsLoading
                      ? "Konfigurasi upload sedang dimuat"
                      : optionsError
                        ? "Konfigurasi upload gagal dimuat"
                        : "Upload data Mesin dari XLSX atau CSV"
                }
              >
                Upload Mesin
              </button>
              <button
                type="button"
                className="user-role-button primary"
                onClick={openCreateModal}
                disabled={!formOptionsReady}
                title={
                  !schemaInfo.tid_enabled
                    ? "Jalankan migration 011 terlebih dahulu"
                    : !schemaInfo.denom_enabled
                      ? "Jalankan migration 030 terlebih dahulu"
                      : optionsLoading
                      ? "Konfigurasi form sedang dimuat"
                      : optionsError
                        ? "Konfigurasi form gagal dimuat"
                        : "Tambah data Mesin"
                }
              >
                Tambah Mesin
              </button>
            </>
          ) : null}
        </div>
      </section>

      <section className="user-role-summary-grid machine-summary-grid">
        <article className="user-role-summary-card">
          <span>Total Mesin</span>
          <strong>{summary.total}</strong>
          <p>Seluruh data mesin terdaftar.</p>
        </article>
        <article className="user-role-summary-card green">
          <span>Mesin Aktif</span>
          <strong>{summary.active}</strong>
          <p>Data aktif yang dapat digunakan.</p>
        </article>
        <article className="user-role-summary-card">
          <span>Onsite</span>
          <strong>{summary.onsite}</strong>
          <p>Mesin pada site internal.</p>
        </article>
        <article className="user-role-summary-card orange">
          <span>Offsite</span>
          <strong>{summary.offsite}</strong>
          <p>{summary.in_warranty} mesin masih dalam garansi.</p>
        </article>
      </section>

      <section className="settings-card user-role-panel">
        <div className="user-role-toolbar machine-toolbar">
          <div className="user-role-filters machine-filters">
            <input
              type="search"
              value={searchText}
              onChange={(event) => {
                setSearchText(event.target.value)
                resetListCursor()
              }}
              placeholder="Cari TID, SN, DB, Denom, lokasi, Cabang, Project, Merk, atau model..."
              aria-label="Cari data Mesin"
            />

            <AsyncAutocompleteSelect
              id="filter_cabang"
              name="filter_cabang"
              source="cabang"
              value={cabangFilter}
              onChange={(value) => {
                setCabangFilter(value)
                resetListCursor()
              }}
              placeholder="Cari Cabang"
              emptyOptionLabel="Semua Cabang"
              className="machine-filter-autocomplete"
            />

            <AsyncAutocompleteSelect
              id="filter_project"
              name="filter_project"
              source="project"
              value={projectFilter}
              onChange={(value) => {
                setProjectFilter(value)
                resetListCursor()
              }}
              placeholder="Cari Project"
              emptyOptionLabel="Semua Project"
              className="machine-filter-autocomplete"
            />

            <AsyncAutocompleteSelect
              id="filter_tipe_mesin"
              name="filter_tipe_mesin"
              source="tipe_mesin"
              value={tipeMesinFilter}
              onChange={(value) => {
                setTipeMesinFilter(value)
                resetListCursor()
              }}
              placeholder="Cari Tipe Mesin"
              emptyOptionLabel="Semua Tipe Mesin"
              className="machine-filter-autocomplete"
            />

            <AutocompleteSelect
              id="filter_kategori_mesin"
              name="filter_kategori_mesin"
              value={kategoriMesinFilter}
              onChange={(value) => {
                setKategoriMesinFilter(value)
                resetListCursor()
              }}
              placeholder="Cari Kategori Mesin"
              className="machine-filter-autocomplete"
              options={[
                { value: "", label: "Semua Kategori Mesin" },
                ...kategoriMesinOptions.map((item) => ({
                  value: item,
                  label: item,
                })),
              ]}
            />

            <input
              type="search"
              value={denomFilter}
              onChange={(event) => {
                setDenomFilter(event.target.value.toUpperCase())
                resetListCursor()
              }}
              placeholder="Filter Denom"
              aria-label="Filter Denom Mesin"
            />

            <AutocompleteSelect
              id="filter_kategori_lokasi"
              name="filter_kategori_lokasi"
              value={kategoriLokasiFilter}
              onChange={(value) => {
                setKategoriLokasiFilter(value)
                resetListCursor()
              }}
              placeholder="Cari Kategori Lokasi"
              className="machine-filter-autocomplete"
              options={[
                { value: "", label: "Semua Kategori Lokasi" },
                ...constantOptions.categories.map((item) => ({
                  value: item,
                  label: item,
                })),
              ]}
            />

            <AutocompleteSelect
              id="filter_site"
              name="filter_site"
              value={siteFilter}
              onChange={(value) => {
                setSiteFilter(value)
                resetListCursor()
              }}
              placeholder="Cari Site"
              className="machine-filter-autocomplete"
              options={[
                { value: "", label: "Semua Site" },
                ...constantOptions.sites.map((item) => ({
                  value: item,
                  label: item,
                })),
              ]}
            />

            <AutocompleteSelect
              id="filter_status"
              name="filter_status"
              value={activeFilter}
              onChange={(value) => {
                setActiveFilter(value)
                resetListCursor()
              }}
              placeholder="Cari Status"
              className="machine-filter-autocomplete"
              options={[
                { value: "", label: "Semua Status" },
                { value: "true", label: "Aktif" },
                { value: "false", label: "Nonaktif" },
              ]}
            />
          </div>

          <div className="user-role-toolbar-actions">
            <button
              type="button"
              className="user-role-button secondary"
              onClick={resetFilters}
            >
              Reset Filter
            </button>
            <button
              type="button"
              className="user-role-button secondary"
              onClick={() => setRefreshKey((current) => current + 1)}
              disabled={refreshing}
            >
              {refreshing ? "Memuat..." : "Refresh"}
            </button>
          </div>
        </div>

        {!isSuperAdmin && currentUser?.codeUker ? (
          <div className="user-role-alert info">
            <strong>Scope Unit Kerja</strong>
            <span>
              Anda hanya dapat melihat dan mengelola Mesin pada Project milik unit
              kerja {currentUser.ukerName || currentUser.codeUker} ({currentUser.codeUker}).
            </span>
          </div>
        ) : null}

        {optionsError ? (
          <div className="user-role-alert error">
            <strong>Konfigurasi form tidak dapat dimuat</strong>
            <span>{optionsError}</span>
          </div>
        ) : null}

        {!schemaInfo.tid_enabled ? (
          <div className="user-role-alert warning">
            <strong>Migration TID belum dijalankan</strong>
            <span>
              Data lama tetap ditampilkan. Jalankan file
              {" "}<code>011-add-master-mesin-tid.sql</code>{" "}
              sebelum menambah atau mengubah data Mesin.
            </span>
          </div>
        ) : null}

        {!schemaInfo.denom_enabled ? (
          <div className="user-role-alert warning">
            <strong>Migration Denom belum dijalankan</strong>
            <span>
              Jalankan file {" "}
              <code>030-add-master-mesin-denom.sql</code>{" "}
              sebelum menambah, mengubah, atau mengupload data Mesin.
            </span>
          </div>
        ) : null}

        {dataNotice && schemaInfo.tid_enabled && schemaInfo.denom_enabled ? (
          <div className="user-role-alert info">
            <strong>Informasi data</strong>
            <span>{dataNotice}</span>
          </div>
        ) : null}

        {loadError ? (
          <div className="user-role-alert error">
            <strong>Data tidak dapat dimuat</strong>
            <span>{loadError}</span>
          </div>
        ) : null}

        <div className="user-role-table-wrapper">
          <table className="user-role-table machine-table">
            <thead>
              <tr>
                <th>TID</th>
                <th>SN / DB</th>
                <th>Denom</th>
                <th>Cabang Pengelola</th>
                <th>Project</th>
                <th>Tipe Mesin</th>
                <th>Lokasi / Site</th>
                <th>Kategori Mesin</th>
                <th>Kategori Lokasi</th>
                <th>Operasional</th>
                <th>Garansi</th>
                <th>Koordinat</th>
                <th>Status</th>
                <th>Diperbarui</th>
                {canManage ? <th>Aksi</th> : null}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={canManage ? 15 : 14}>
                    <div className="user-role-loading">Memuat data Mesin...</div>
                  </td>
                </tr>
              ) : mesins.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 15 : 14}>
                    <div className="user-role-empty">
                      Belum ada data Mesin yang sesuai filter.
                    </div>
                  </td>
                </tr>
              ) : (
                mesins.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong className="machine-tid">{item.tid || "-"}</strong>
                    </td>
                    <td>
                      <strong className="machine-sn">{item.sn}</strong>
                      <span className="project-cell-subtext">
                        DB: {item.db || "-"}
                      </span>
                    </td>
                    <td>
                      <strong>{item.denom || "-"}</strong>
                    </td>
                    <td>
                      <strong>{item.nama_cabang || "Cabang tidak ditemukan"}</strong>
                      <span className="project-cell-subtext">
                        {item.kode_cabang || "-"} · {item.nama_kanwil || "-"}
                      </span>
                    </td>
                    <td>
                      <strong>{item.nama_project || "Project tidak ditemukan"}</strong>
                      <span className="project-cell-subtext">
                        {item.kode_project || "-"}
                      </span>
                    </td>
                    <td>
                      <strong>{item.nama_model || "Tipe tidak ditemukan"}</strong>
                      <span className="project-cell-subtext">
                        {item.nama_merk || "-"} · {item.jenis_mesin || "-"}
                      </span>
                    </td>
                    <td>
                      <strong className="machine-location" title={item.lokasi}>
                        {item.lokasi || "-"}
                      </strong>
                      <span
                        className={`machine-badge ${String(item.site).toLowerCase()}`}
                      >
                        {item.site || "-"}
                      </span>
                    </td>
                    <td>{item.kategori_mesin || item.jenis_mesin || "-"}</td>
                    <td>{item.kategori_lokasi || item.kategori || "-"}</td>
                    <td>
                      <strong>{item.hari_ops}</strong>
                      <span className="project-cell-subtext">
                        {item.jam_ops} · {item.waktu_ops}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`machine-badge ${
                          item.garansi === "IN WARRANTY"
                            ? "warranty"
                            : "out-warranty"
                        }`}
                      >
                        {item.garansi}
                      </span>
                    </td>
                    <td>
                      <span>{formatCoordinate(item.latitude)}</span>
                      <span className="project-cell-subtext">
                        {formatCoordinate(item.longitude)}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`user-role-status ${
                          item.is_active ? "active" : "inactive"
                        }`}
                      >
                        {item.is_active ? "Aktif" : "Nonaktif"}
                      </span>
                    </td>
                    <td>{formatDateTime(item.updated_at)}</td>
                    {canManage ? (
                      <td>
                        <div className="user-role-actions project-actions">
                          {canUpdate ? (
                            <button
                            type="button"
                            className="edit"
                            onClick={() => openEditModal(item)}
                            disabled={!formOptionsReady}
                            title={
                              formOptionsReady
                                ? "Edit data Mesin"
                                : "Sumber autocomplete belum siap"
                            }
                          >
                            Edit
                          </button>
                          ) : null}
                          {canDelete ? (
                            <button
                            type="button"
                            className="delete"
                            onClick={() => {
                              setDeleteTarget(item)
                              setDeleteError("")
                            }}
                          >
                            Hapus
                          </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="project-pagination">
          <p>
            Menampilkan {mesins.length} data pada halaman {page}. Total dalam scope: {summary.total}.
          </p>

          <div className="project-pagination-controls">
            <label>
              <span>Baris</span>
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value))
                  resetListCursor()
                }}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>

            <nav aria-label="Pagination Master Mesin">
              <button
                type="button"
                onClick={() => {
                  const previousCursors = [...cursorHistory]
                  const previousCursor = previousCursors.pop() || ""
                  setCursorHistory(previousCursors)
                  setAfterId(previousCursor)
                  setPage((current) => Math.max(1, current - 1))
                }}
                disabled={cursorHistory.length === 0}
                aria-label="Halaman sebelumnya"
              >
                ‹ Sebelumnya
              </button>

              <span className="project-pagination-current">Halaman {page}</span>

              <button
                type="button"
                onClick={() => {
                  if (!pagination.next_cursor) return
                  setCursorHistory((current) => [...current, afterId])
                  setAfterId(pagination.next_cursor)
                  setPage((current) => current + 1)
                }}
                disabled={!pagination.has_more || !pagination.next_cursor}
                aria-label="Halaman berikutnya"
              >
                Berikutnya ›
              </button>
            </nav>
          </div>
        </div>
      </section>

      {importModalOpen ? (
        <div
          className="user-role-modal-backdrop"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !importing &&
              !importParsing
            ) {
              closeImportModal()
            }
          }}
        >
          <section
            className="user-role-modal machine-import-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="machine-import-title"
          >
            <header className="user-role-modal-header">
              <div>
                <p className="eyebrow">Master Mesin</p>
                <h3 id="machine-import-title">Upload Data Mesin</h3>
                <p>
                  Import maksimal 500 mesin. TID dan SN divalidasi unik terhadap
                  file dan database sebelum data disimpan.
                </p>
              </div>

              <button
                type="button"
                onClick={closeImportModal}
                disabled={importing || importParsing}
                aria-label="Tutup formulir upload"
              >
                ×
              </button>
            </header>

            <form
              className="machine-import-form"
              onSubmit={(event) => {
                event.preventDefault()
                void handleImportSubmit()
              }}
            >
              <div className="user-role-form-grid single machine-import-form-grid">
                <div className="user-role-form-field full">
                  <label>Template Data Mesin</label>
                  <div className="machine-import-template-field">
                    <div>
                      <strong>Gunakan template resmi</strong>
                      <small>
                        Isi kode Cabang, Project, Merk, Jenis Mesin, dan Model
                        sesuai data master. Jangan mengubah nama kolom.
                      </small>
                    </div>
                    <a
                      href="/templates/template-upload-mesin.xlsx"
                      download
                      className="user-role-button secondary machine-import-download"
                    >
                      Unduh Template XLSX
                    </a>
                  </div>
                </div>

                <div className="user-role-form-field full">
                  <label htmlFor="machine-import-file">File Mesin *</label>
                  <div
                    className={`machine-import-dropzone ${
                      importDragActive ? "active" : ""
                    }`}
                    onDragEnter={(event) => {
                      event.preventDefault()
                      setImportDragActive(true)
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={(event) => {
                      event.preventDefault()
                      if (!event.currentTarget.contains(event.relatedTarget)) {
                        setImportDragActive(false)
                      }
                    }}
                    onDrop={handleImportDrop}
                  >
                    <input
                      id="machine-import-file"
                      ref={importFileInputRef}
                      type="file"
                      accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                      onChange={handleImportFileChange}
                      hidden
                    />
                    <span className="machine-import-file-icon">XLSX</span>
                    <div className="machine-import-file-copy">
                      <strong>
                        {importFile
                          ? importFile.name
                          : "Pilih atau tarik file mesin ke area ini"}
                      </strong>
                      <small>
                        {importFile
                          ? `${formatFileSize(importFile.size)} • File sudah dibaca`
                          : "Format XLSX/CSV, maksimal 5 MB dan 500 baris."}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="user-role-button secondary machine-import-file-button"
                      onClick={() => importFileInputRef.current?.click()}
                      disabled={importParsing || importing}
                    >
                      {importFile ? "Ganti File" : "Pilih File"}
                    </button>
                  </div>
                </div>

                <details className="machine-import-format-details">
                  <summary>Lihat ketentuan data upload</summary>
                  <div className="machine-import-rules">
                    <p>
                      <strong>TID dan SN:</strong> wajib, tidak boleh sama dalam
                      satu mesin, tidak boleh duplikat di file, dan tidak boleh
                      sudah terdaftar di database.
                    </p>
                    <p>
                      <strong>Referensi:</strong> kode_cabang, kode_project,
                      kode_merk, jenis_mesin, dan nama_model harus sama dengan
                      data pada menu master terkait.
                    </p>
                    <p>
                      <strong>Nilai baku:</strong> site ONSITE/OFFSITE; status
                      AKTIF/NONAKTIF; garansi IN WARRANTY/OUT WARRANTY.
                    </p>
                    <p>
                      <strong>Kategori Lokasi:</strong>{" "}
                      {(constantOptions.categories || FALLBACK_CATEGORIES).join(", ")}.
                      Spasi tersembunyi dan variasi penulisan umum akan
                      dinormalisasi otomatis.
                    </p>
                    <p>
                      Kolom DB, longitude, dan latitude dapat dikosongkan.
                      Kolom operasional yang kosong akan memakai nilai bawaan
                      pada template.
                    </p>
                  </div>
                </details>

                {importParsing ? (
                  <div className="machine-import-processing">
                    Membaca dan memvalidasi file...
                  </div>
                ) : null}

                {importFile && !importParsing ? (
                  <div className="machine-import-summary">
                    <article>
                      <span>Total Baris</span>
                      <strong>{importRows.length}</strong>
                    </article>
                    <article className="valid">
                      <span>Valid Lokal</span>
                      <strong>{importValidCount}</strong>
                    </article>
                    <article className={importInvalidCount > 0 ? "invalid" : ""}>
                      <span>Perlu Diperbaiki</span>
                      <strong>{importInvalidCount}</strong>
                    </article>
                  </div>
                ) : null}

                {importError ? (
                  <div className="user-role-alert error machine-import-alert">
                    <strong>Upload belum dapat diproses</strong>
                    <span>{importError}</span>
                  </div>
                ) : null}

                {importErrors.length > 0 ? (
                  <div className="machine-import-error-list">
                    <strong>Kesalahan data ({importErrors.length})</strong>
                    <ul>
                      {importErrors.slice(0, 15).map((error, index) => (
                        <li
                          key={`${error.row || "general"}-${
                            error.field || "field"
                          }-${index}`}
                        >
                          {error.row ? `Baris ${error.row}: ` : ""}
                          {error.message}
                        </li>
                      ))}
                    </ul>
                    {importErrors.length > 15 ? (
                      <small>
                        Masih ada {importErrors.length - 15} kesalahan lain.
                      </small>
                    ) : null}
                  </div>
                ) : null}

                {importRows.length > 0 ? (
                  <div className="machine-import-preview">
                    <div className="machine-import-preview-heading">
                      <strong>Pratinjau data</strong>
                      <span>
                        {importErrors.length > 0
                          ? "Menampilkan baris yang perlu diperbaiki"
                          : "Menampilkan maksimal 10 baris pertama"}
                      </span>
                    </div>
                    <div className="machine-import-preview-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Baris</th>
                            <th>TID</th>
                            <th>SN</th>
                            <th>Denom</th>
                            <th>Cabang</th>
                            <th>Project</th>
                            <th>Tipe Mesin</th>
                            <th>Site</th>
                            <th>Kategori Lokasi</th>
                            <th>Status</th>
                            <th>Validasi</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importPreviewRows.map((row) => {
                            const rowErrors =
                              importErrorsByRow.get(row._row_number) || []

                            return (
                              <tr
                                key={row._row_number}
                                className={rowErrors.length > 0 ? "invalid" : ""}
                              >
                                <td>{row._row_number}</td>
                                <td>{row.tid || "-"}</td>
                                <td>{row.sn || "-"}</td>
                                <td>{row.denom || "-"}</td>
                                <td>{row.kode_cabang || "-"}</td>
                                <td>{row.kode_project || "-"}</td>
                                <td>
                                  {[row.kode_merk, row.jenis_mesin, row.nama_model]
                                    .filter(Boolean)
                                    .join(" · ") || "-"}
                                </td>
                                <td>{row.site || "-"}</td>
                                <td>{row.kategori_lokasi || "-"}</td>
                                <td>{row.status || "-"}</td>
                                <td>
                                  <span
                                    className={`machine-import-row-status ${
                                      rowErrors.length > 0 ? "invalid" : "valid"
                                    }`}
                                    title={rowErrors.join(" ")}
                                  >
                                    {rowErrors.length > 0 ? "Periksa" : "Valid"}
                                  </span>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>

              <footer className="user-role-modal-footer">
                <button
                  type="button"
                  className="user-role-button secondary"
                  onClick={closeImportModal}
                  disabled={importing || importParsing}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="user-role-button primary"
                  disabled={
                    importing ||
                    importParsing ||
                    importRows.length === 0 ||
                    importErrors.length > 0
                  }
                >
                  {importing
                    ? "Mengupload..."
                    : `Upload ${importRows.length || ""} Mesin`.trim()}
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}

      {modalOpen ? (
        <div className="user-role-modal-backdrop" role="presentation">
          <div
            className="user-role-modal machine-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="machine-modal-title"
          >
            <div className="user-role-modal-header">
              <div>
                <h3 id="machine-modal-title">
                  {editingId ? "Edit Mesin" : "Tambah Mesin"}
                </h3>
                <p>
                  Cabang menunjukkan pihak pengelola. Lokasi menunjukkan alamat
                  fisik tempat mesin berada.
                </p>
              </div>
              <button type="button" onClick={closeModal} aria-label="Tutup">
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="user-role-form-grid machine-form-grid">
                <div className="user-role-form-field">
                  <label htmlFor="tid">TID *</label>
                  <input
                    id="tid"
                    name="tid"
                    value={form.tid}
                    onChange={(event) =>
                      updateForm("tid", event.target.value.toUpperCase())
                    }
                    maxLength={50}
                    placeholder="Contoh: 12345678"
                    autoFocus
                  />
                  <small>TID harus unik untuk setiap terminal.</small>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="sn">SN *</label>
                  <input
                    id="sn"
                    name="sn"
                    value={form.sn}
                    onChange={(event) =>
                      updateForm("sn", event.target.value.toUpperCase())
                    }
                    maxLength={100}
                    placeholder="Contoh: SN-NCR-000001"
                  />
                  <small>SN harus unik untuk setiap mesin.</small>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="db">DB</label>
                  <input
                    id="db"
                    name="db"
                    value={form.db}
                    onChange={(event) => updateForm("db", event.target.value)}
                    maxLength={100}
                    placeholder="Masukkan nilai DB"
                  />
                  <small>Disimpan sebagai teks sesuai struktur rancangan.</small>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="denom">Denom *</label>
                  <input
                    id="denom"
                    name="denom"
                    value={form.denom}
                    onChange={(event) =>
                      updateForm("denom", event.target.value.toUpperCase())
                    }
                    maxLength={50}
                    placeholder="Contoh: 50.000 / 100.000"
                  />
                  <small>Isi pecahan uang yang didukung mesin.</small>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="cabang_id">Cabang Pengelola *</label>
                  <AsyncAutocompleteSelect
                    id="cabang_id"
                    name="cabang_id"
                    source="cabang"
                    value={form.cabang_id}
                    onChange={(value, option) => {
                      updateForm("cabang_id", value)
                      setFormInitialOptions((current) => ({
                        ...current,
                        cabang: option,
                      }))
                    }}
                    placeholder="Cari dan pilih Cabang"
                    initialOption={formInitialOptions.cabang}
                  />
                  <small>Cabang bertanggung jawab mengelola mesin.</small>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="project_id">Project *</label>
                  <AsyncAutocompleteSelect
                    id="project_id"
                    name="project_id"
                    source="project"
                    value={form.project_id}
                    onChange={(value, option) => {
                      updateForm("project_id", value)
                      setFormInitialOptions((current) => ({
                        ...current,
                        project: option,
                      }))
                    }}
                    placeholder="Cari dan pilih Project"
                    initialOption={formInitialOptions.project}
                  />
                </div>

                <div className="user-role-form-field full">
                  <label htmlFor="lokasi">Lokasi Fisik Mesin *</label>
                  <textarea
                    id="lokasi"
                    name="lokasi"
                    value={form.lokasi}
                    onChange={(event) => updateForm("lokasi", event.target.value)}
                    maxLength={500}
                    rows={3}
                    placeholder="Nama tempat dan alamat lengkap lokasi mesin"
                  />
                  <small>
                    Lokasi ini berdiri sendiri dan tidak mengikuti alamat Cabang.
                  </small>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="site">Site *</label>
                  <AutocompleteSelect
                    id="site"
                    name="site"
                    value={form.site}
                    onChange={(value) => updateForm("site", value)}
                    placeholder="Cari dan pilih Site"
                    options={constantOptions.sites.map((item) => ({
                      value: item,
                      label: item,
                    }))}
                  />
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="tipe_mesin_id">Tipe Mesin *</label>
                  <AsyncAutocompleteSelect
                    id="tipe_mesin_id"
                    name="tipe_mesin_id"
                    source="tipe_mesin"
                    value={form.tipe_mesin_id}
                    onChange={(value, option) => {
                      handleTipeMesinChange(value, option)
                      setFormInitialOptions((current) => ({
                        ...current,
                        tipe_mesin: option,
                      }))
                    }}
                    placeholder="Cari Merk, jenis, atau model"
                    initialOption={formInitialOptions.tipe_mesin}
                  />
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="kategori_mesin">Kategori Mesin *</label>
                  <input
                    id="kategori_mesin"
                    name="kategori_mesin"
                    value={form.kategori_mesin}
                    readOnly
                    placeholder="Otomatis dari Jenis Mesin"
                  />
                  <small>Mengikuti Jenis Mesin pada Master Tipe Mesin.</small>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="kategori_lokasi">Kategori Lokasi *</label>
                  <AutocompleteSelect
                    id="kategori_lokasi"
                    name="kategori_lokasi"
                    value={form.kategori_lokasi}
                    onChange={(value) => updateForm("kategori_lokasi", value)}
                    placeholder="Cari dan pilih Kategori Lokasi"
                    options={constantOptions.categories.map((item) => ({
                      value: item,
                      label: item,
                    }))}
                  />
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="garansi">Garansi *</label>
                  <AutocompleteSelect
                    id="garansi"
                    name="garansi"
                    value={form.garansi}
                    onChange={(value) => updateForm("garansi", value)}
                    placeholder="Cari dan pilih Garansi"
                    options={constantOptions.warranties.map((item) => ({
                      value: item,
                      label: item,
                    }))}
                  />
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="hari_ops">Hari Operasional *</label>
                  <AutocompleteSelect
                    id="hari_ops"
                    name="hari_ops"
                    value={form.hari_ops}
                    onChange={(value) => updateForm("hari_ops", value)}
                    placeholder="Cari dan pilih Hari Operasional"
                    options={constantOptions.operation_days.map((item) => ({
                      value: item,
                      label: item,
                    }))}
                  />
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="jam_ops">Jam Operasional *</label>
                  <AutocompleteSelect
                    id="jam_ops"
                    name="jam_ops"
                    value={form.jam_ops}
                    onChange={handleJamOpsChange}
                    placeholder="Cari dan pilih Jam Operasional"
                    options={constantOptions.operation_hours.map((item) => ({
                      value: item,
                      label: item,
                    }))}
                  />
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="waktu_ops">Waktu Operasional *</label>
                  <AutocompleteSelect
                    id="waktu_ops"
                    name="waktu_ops"
                    value={form.waktu_ops}
                    onChange={(value) => updateForm("waktu_ops", value)}
                    placeholder="Cari dan pilih Waktu Operasional"
                    options={constantOptions.operation_times
                      .filter((item) =>
                        form.jam_ops === "24 JAM"
                          ? item === "00:00 - 23:59"
                          : item !== "00:00 - 23:59"
                      )
                      .map((item) => ({ value: item, label: item }))}
                  />
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="latitude">Latitude</label>
                  <input
                    id="latitude"
                    name="latitude"
                    type="number"
                    step="0.000001"
                    min="-90"
                    max="90"
                    value={form.latitude}
                    onChange={(event) =>
                      updateForm("latitude", event.target.value)
                    }
                    placeholder="Contoh: -6.200000"
                  />
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="longitude">Longitude</label>
                  <input
                    id="longitude"
                    name="longitude"
                    type="number"
                    step="0.000001"
                    min="-180"
                    max="180"
                    value={form.longitude}
                    onChange={(event) =>
                      updateForm("longitude", event.target.value)
                    }
                    placeholder="Contoh: 106.816666"
                  />
                </div>

                <label className="user-role-toggle-field full">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(event) =>
                      updateForm("is_active", event.target.checked)
                    }
                  />
                  <span>
                    <strong>Data Mesin aktif</strong>
                    <small>
                      Mesin aktif dapat dipakai pada proses operasional berikutnya.
                    </small>
                  </span>
                </label>
              </div>

              {modalError ? (
                <div className="user-role-alert error">
                  <strong>Data belum dapat disimpan</strong>
                  <span>{modalError}</span>
                </div>
              ) : null}

              <div className="user-role-modal-footer">
                <button
                  type="button"
                  className="user-role-button secondary"
                  onClick={closeModal}
                  disabled={saving}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="user-role-button primary"
                  disabled={saving}
                >
                  {saving ? "Menyimpan..." : editingId ? "Simpan Perubahan" : "Tambah Mesin"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="user-role-modal-backdrop" role="presentation">
          <div
            className="user-role-modal compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-machine-title"
          >
            <div className="user-role-modal-header">
              <div>
                <h3 id="delete-machine-title">Hapus Mesin?</h3>
                <p>
                  Mesin yang sudah digunakan oleh transaksi tidak dapat dihapus.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!deleting) {
                    setDeleteTarget(null)
                    setDeleteError("")
                  }
                }}
                aria-label="Tutup"
              >
                ×
              </button>
            </div>

            <div className="user-role-delete-content">
              <div className="user-role-delete-target">
                <span>TID / SN</span>
                <strong>{deleteTarget.tid || "-"} / {deleteTarget.sn}</strong>
                <small>
                  {deleteTarget.nama_model || "Tipe tidak ditemukan"} ·{" "}
                  {deleteTarget.nama_cabang || "Cabang tidak ditemukan"}
                </small>
              </div>

              <div className="user-role-delete-warning">
                Penghapusan bersifat permanen. Untuk menjaga histori data,
                pertimbangkan mengubah status menjadi Nonaktif.
              </div>

              {deleteError ? (
                <div className="user-role-alert error">
                  <strong>Data belum dapat dihapus</strong>
                  <span>{deleteError}</span>
                </div>
              ) : null}
            </div>

            <div className="user-role-modal-footer">
              <button
                type="button"
                className="user-role-button secondary"
                onClick={() => {
                  setDeleteTarget(null)
                  setDeleteError("")
                }}
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
                {deleting ? "Menghapus..." : "Hapus Mesin"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast.open ? (
        <div className={`user-role-toast ${toast.type === "error" ? "error" : ""}`}>
          <div>
            <strong>{toast.type === "error" ? "Gagal" : "Berhasil"}</strong>
            <p>{toast.message}</p>
          </div>
          <button
            type="button"
            onClick={() => setToast((current) => ({ ...current, open: false }))}
            aria-label="Tutup notifikasi"
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  )
}
