"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"

const FALLBACK_CATEGORIES = [
  "ALFAMART",
  "ALFAMIDI",
  "APARTEMEN",
  "BANDARA",
  "HOTEL",
  "INDOMARET",
  "INSTANSI BUMN/BUMD",
  "INSTANSI MILITER",
  "INSTANSI PEMERINTAHAN",
  "KC",
  "KCP",
  "KEPOLISIAN",
  "KK",
  "MALL",
  "MINI MARKET",
  "PASAR",
  "PERKANTORAN",
  "PERUMAHAN",
  "PLAZA",
  "RUMAH SAKIT",
  "SPBU",
  "STASIUN",
  "SWALAYAN",
  "TEMPAT HIBURAN",
  "TEMPAT OLAHRAGA",
  "TEMPAT PENDIDIKAN",
  "TEMPAT WISATA",
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
  "09:00 - 18:00",
  "09:00 - 21:00",
]

const EMPTY_FORM = {
  tid: "",
  sn: "",
  db: "",
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
    throw error
  }

  return result
}

function getErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback
}

function mapToForm(item) {
  return {
    tid: String(item?.tid || ""),
    sn: String(item?.sn || ""),
    db: String(item?.db || ""),
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

function getPageNumbers(currentPage, totalPages) {
  const safeTotal = Math.max(1, totalPages)
  const start = Math.max(1, Math.min(currentPage - 2, safeTotal - 4))
  const end = Math.min(safeTotal, start + 4)

  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
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
  const typingRef = useRef(false)
  const selectedOption = useMemo(
    () => options.find((option) => String(option.value) === String(value)) || null,
    [options, value]
  )
  const [query, setQuery] = useState(selectedOption?.label || "")
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)

  useEffect(() => {
    if (typingRef.current) {
      return
    }

    setQuery(selectedOption?.label || "")
  }, [selectedOption?.label])

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("id-ID")

    if (!normalizedQuery || query === selectedOption?.label) {
      return options
    }

    return options.filter((option) => {
      const haystack = `${option.label} ${option.searchText || ""}`
        .toLocaleLowerCase("id-ID")
      return haystack.includes(normalizedQuery)
    })
  }, [options, query, selectedOption?.label])

  useEffect(() => {
    function handleOutsideClick(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        typingRef.current = false
        setOpen(false)
        setQuery(selectedOption?.label || "")
      }
    }

    document.addEventListener("mousedown", handleOutsideClick)
    return () => document.removeEventListener("mousedown", handleOutsideClick)
  }, [selectedOption?.label])

  function selectOption(option) {
    typingRef.current = false
    onChange(String(option.value))
    setQuery(option.label)
    setOpen(false)
    setHighlightedIndex(0)
  }

  function handleInputChange(event) {
    const nextQuery = event.target.value
    typingRef.current = true
    setQuery(nextQuery)
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
      typingRef.current = false
      setOpen(false)
      setQuery(selectedOption?.label || "")
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
          value={query}
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
              typingRef.current = false
              onChange("")
              setQuery("")
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

export default function MasterMesinPage() {
  const router = useRouter()
  const toastTimerRef = useRef(null)

  const [currentUser, setCurrentUser] = useState(null)
  const [cabangs, setCabangs] = useState([])
  const [projects, setProjects] = useState([])
  const [tipeMesins, setTipeMesins] = useState([])
  const [constantOptions, setConstantOptions] = useState({
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
    page: 1,
    page_size: 10,
    total: 0,
    total_pages: 1,
  })

  const [searchText, setSearchText] = useState("")
  const [cabangFilter, setCabangFilter] = useState("")
  const [projectFilter, setProjectFilter] = useState("")
  const [tipeMesinFilter, setTipeMesinFilter] = useState("")
  const [kategoriMesinFilter, setKategoriMesinFilter] = useState("")
  const [kategoriLokasiFilter, setKategoriLokasiFilter] = useState("")
  const [siteFilter, setSiteFilter] = useState("")
  const [activeFilter, setActiveFilter] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [refreshKey, setRefreshKey] = useState(0)

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [optionsError, setOptionsError] = useState("")
  const [optionsLoading, setOptionsLoading] = useState(true)
  const [dataNotice, setDataNotice] = useState("")
  const [schemaInfo, setSchemaInfo] = useState({ tid_enabled: true })

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState("")

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState("")

  const [toast, setToast] = useState({
    open: false,
    type: "success",
    message: "",
  })

  const isSuperAdmin = currentUser?.roleCode === "SUPER_ADMIN"
  const canManage = isSuperAdmin || Boolean(currentUser?.codeUker)
  const pageNumbers = useMemo(
    () => getPageNumbers(pagination.page, pagination.total_pages),
    [pagination.page, pagination.total_pages]
  )
  const kategoriMesinOptions = useMemo(
    () =>
      Array.from(
        new Set(
          tipeMesins
            .map((item) => String(item?.jenis_mesin || "").trim().toUpperCase())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b, "id")),
    [tipeMesins]
  )
  const missingOptionSources = useMemo(() => {
    if (optionsLoading || optionsError) {
      return []
    }

    return [
      cabangs.length === 0 ? "Cabang" : "",
      projects.length === 0 ? "Project" : "",
      tipeMesins.length === 0 ? "Tipe Mesin" : "",
    ].filter(Boolean)
  }, [cabangs.length, optionsError, optionsLoading, projects.length, tipeMesins.length])
  const formOptionsReady =
    schemaInfo.tid_enabled &&
    !optionsLoading &&
    !optionsError &&
    missingOptionSources.length === 0

  useEffect(() => {
    const controller = new AbortController()

    async function loadIdentityAndOptions() {
      setOptionsLoading(true)
      setOptionsError("")

      try {
        const userResult = await requestJson("/api/auth/me", {
          method: "GET",
          signal: controller.signal,
        })

        if (!controller.signal.aborted) {
          setCurrentUser(userResult.data)
        }
      } catch (error) {
        if (error?.name === "AbortError") {
          return
        }

        if (error?.status === 401) {
          router.replace(`/login?next=${encodeURIComponent("/masters/mesin")}`)
          return
        }

        setOptionsError(
          getErrorMessage(error, "Gagal membaca pengguna aktif.")
        )
      }

      try {
        const optionsResult = await requestJson(
          "/api/masters/mesin?mode=options",
          {
            method: "GET",
            signal: controller.signal,
          }
        )

        if (!controller.signal.aborted) {
          setCabangs(
            Array.isArray(optionsResult.data?.cabangs)
              ? optionsResult.data.cabangs
              : []
          )
          setProjects(
            Array.isArray(optionsResult.data?.projects)
              ? optionsResult.data.projects
              : []
          )
          setTipeMesins(
            Array.isArray(optionsResult.data?.tipeMesins)
              ? optionsResult.data.tipeMesins
              : []
          )
          setSchemaInfo(
            optionsResult.data?.schema || { tid_enabled: true }
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
            "Gagal mengambil sumber autocomplete Cabang, Project, dan Tipe Mesin."
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
    const timer = window.setTimeout(async () => {
      try {
        setLoadError("")

        if (refreshKey > 0) {
          setRefreshing(true)
        } else {
          setLoading(true)
        }

        const params = new URLSearchParams({
          page: String(page),
          page_size: String(pageSize),
        })

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
          setSummary(
            result.data?.summary || {
              total: 0,
              active: 0,
              onsite: 0,
              offsite: 0,
              in_warranty: 0,
            }
          )
          setPagination(
            result.data?.pagination || {
              page: 1,
              page_size: pageSize,
              total: 0,
              total_pages: 1,
            }
          )
          setSchemaInfo(result.data?.schema || { tid_enabled: true })
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
    kategoriLokasiFilter,
    kategoriMesinFilter,
    page,
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
    if (!modalOpen && !deleteTarget) {
      return undefined
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    function handleEscape(event) {
      if (event.key !== "Escape" || saving || deleting) {
        return
      }

      if (deleteTarget) {
        setDeleteTarget(null)
        setDeleteError("")
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
  }, [deleteTarget, deleting, modalOpen, saving])

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
    setModalError("")
    setModalOpen(true)
  }

  function openEditModal(item) {
    setEditingId(item.id)
    setForm(mapToForm(item))
    setModalError("")
    setModalOpen(true)
  }

  function closeModal() {
    if (saving) {
      return
    }

    setModalOpen(false)
    setModalError("")
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

  function handleTipeMesinChange(value) {
    const selected = tipeMesins.find((item) => String(item.id) === String(value))

    setForm((current) => ({
      ...current,
      tipe_mesin_id: value,
      kategori_mesin: selected
        ? String(selected.jenis_mesin || "").trim().toUpperCase()
        : "",
    }))
  }

  function validateForm() {
    if (!form.tid.trim()) {
      return "TID wajib diisi."
    }

    if (!form.sn.trim()) {
      return "SN wajib diisi."
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
        ...(editingId ? { id: editingId } : {}),
        tid: form.tid.trim().toUpperCase(),
        sn: form.sn.trim().toUpperCase(),
        db: form.db.trim(),
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
      setPage(1)
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
      setPage(1)
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
    setKategoriLokasiFilter("")
    setSiteFilter("")
    setActiveFilter("")
    setPage(1)
  }

  return (
    <div className="simple-page user-role-page machine-page">
      <section className="page-heading-card user-role-heading">
        <div>
          <div className="machine-heading-kicker">
            <p className="eyebrow">Master Data</p>
            <span className="machine-revision-badge">TID + Autocomplete</span>
          </div>
          <h2>Master Mesin</h2>
          <p>
            Kelola TID, identitas mesin, cabang pengelola, project, tipe mesin,
            lokasi fisik, operasional, garansi, dan koordinat penempatan.
          </p>
        </div>

        <div className="user-role-toolbar-actions">
          <Link href="/masters" className="user-role-button secondary">
            Kembali
          </Link>
          {canManage ? (
            <button
              type="button"
              className="user-role-button primary"
              onClick={openCreateModal}
              disabled={!formOptionsReady}
              title={
                !schemaInfo.tid_enabled
                  ? "Jalankan migration 011 terlebih dahulu"
                  : optionsLoading
                    ? "Sumber autocomplete sedang dimuat"
                    : optionsError
                      ? "Sumber autocomplete gagal dimuat"
                      : missingOptionSources.length > 0
                        ? `Lengkapi Master ${missingOptionSources.join(", ")}`
                        : "Tambah data Mesin"
              }
            >
              Tambah Mesin
            </button>
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
                setPage(1)
              }}
              placeholder="Cari TID, SN, DB, lokasi, Cabang, Project, Merk, atau model..."
              aria-label="Cari data Mesin"
            />

            <AutocompleteSelect
              id="filter_cabang"
              name="filter_cabang"
              value={cabangFilter}
              onChange={(value) => {
                setCabangFilter(value)
                setPage(1)
              }}
              placeholder="Cari Cabang"
              className="machine-filter-autocomplete"
              options={[
                { value: "", label: "Semua Cabang" },
                ...cabangs.map((item) => ({
                  value: String(item.id),
                  label: `${item.kode_cabang} · ${item.nama_cabang}`,
                  searchText: `${item.kode_kanwil || ""} ${item.nama_kanwil || ""}`,
                })),
              ]}
            />

            <AutocompleteSelect
              id="filter_project"
              name="filter_project"
              value={projectFilter}
              onChange={(value) => {
                setProjectFilter(value)
                setPage(1)
              }}
              placeholder="Cari Project"
              className="machine-filter-autocomplete"
              options={[
                { value: "", label: "Semua Project" },
                ...projects.map((item) => ({
                  value: String(item.id),
                  label: `${item.kode_project} · ${item.nama_project}`,
                  searchText: item.status_project || "",
                })),
              ]}
            />

            <AutocompleteSelect
              id="filter_tipe_mesin"
              name="filter_tipe_mesin"
              value={tipeMesinFilter}
              onChange={(value) => {
                setTipeMesinFilter(value)
                setPage(1)
              }}
              placeholder="Cari Tipe Mesin"
              className="machine-filter-autocomplete"
              options={[
                { value: "", label: "Semua Tipe Mesin" },
                ...tipeMesins.map((item) => ({
                  value: String(item.id),
                  label: `${item.nama_merk} · ${item.jenis_mesin} · ${item.nama_model}`,
                  searchText: item.kode_merk || "",
                })),
              ]}
            />

            <AutocompleteSelect
              id="filter_kategori_mesin"
              name="filter_kategori_mesin"
              value={kategoriMesinFilter}
              onChange={(value) => {
                setKategoriMesinFilter(value)
                setPage(1)
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

            <AutocompleteSelect
              id="filter_kategori_lokasi"
              name="filter_kategori_lokasi"
              value={kategoriLokasiFilter}
              onChange={(value) => {
                setKategoriLokasiFilter(value)
                setPage(1)
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
                setPage(1)
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
                setPage(1)
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
            <strong>Autocomplete tidak dapat dimuat</strong>
            <span>{optionsError}</span>
          </div>
        ) : null}

        {missingOptionSources.length > 0 ? (
          <div className="user-role-alert warning">
            <strong>Sumber autocomplete masih kosong</strong>
            <span>
              Lengkapi Master {missingOptionSources.join(", ")} terlebih dahulu.
              Project juga mengikuti scope unit kerja pengguna aktif.
            </span>
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

        {dataNotice && schemaInfo.tid_enabled ? (
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
                  <td colSpan={canManage ? 14 : 13}>
                    <div className="user-role-loading">Memuat data Mesin...</div>
                  </td>
                </tr>
              ) : mesins.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 14 : 13}>
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
            Menampilkan {mesins.length} dari {pagination.total} data Mesin.
          </p>

          <div className="project-pagination-controls">
            <label>
              <span>Baris</span>
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value))
                  setPage(1)
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
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={pagination.page <= 1}
                aria-label="Halaman sebelumnya"
              >
                ‹
              </button>

              {pageNumbers.map((pageNumber) => (
                <button
                  type="button"
                  key={pageNumber}
                  className={pageNumber === pagination.page ? "active" : ""}
                  onClick={() => setPage(pageNumber)}
                >
                  {pageNumber}
                </button>
              ))}

              <button
                type="button"
                onClick={() =>
                  setPage((current) =>
                    Math.min(pagination.total_pages, current + 1)
                  )
                }
                disabled={pagination.page >= pagination.total_pages}
                aria-label="Halaman berikutnya"
              >
                ›
              </button>
            </nav>
          </div>
        </div>
      </section>

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
                  <label htmlFor="cabang_id">Cabang Pengelola *</label>
                  <AutocompleteSelect
                    id="cabang_id"
                    name="cabang_id"
                    value={form.cabang_id}
                    onChange={(value) => updateForm("cabang_id", value)}
                    placeholder="Cari dan pilih Cabang"
                    options={cabangs.map((item) => ({
                      value: String(item.id),
                      label: `${item.kode_cabang} · ${item.nama_cabang} · ${item.nama_kanwil}`,
                      searchText: `${item.kode_kanwil || ""} ${item.nama_kanwil || ""}`,
                    }))}
                  />
                  <small>Cabang bertanggung jawab mengelola mesin.</small>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="project_id">Project *</label>
                  <AutocompleteSelect
                    id="project_id"
                    name="project_id"
                    value={form.project_id}
                    onChange={(value) => updateForm("project_id", value)}
                    placeholder="Cari dan pilih Project"
                    options={projects.map((item) => ({
                      value: String(item.id),
                      label: `${item.kode_project} · ${item.nama_project} · ${item.status_project}`,
                    }))}
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
                  <AutocompleteSelect
                    id="tipe_mesin_id"
                    name="tipe_mesin_id"
                    value={form.tipe_mesin_id}
                    onChange={handleTipeMesinChange}
                    placeholder="Cari Merk, jenis, atau model"
                    options={tipeMesins.map((item) => ({
                      value: String(item.id),
                      label: `${item.nama_merk} · ${item.jenis_mesin} · ${item.nama_model}`,
                      searchText: item.kode_merk || "",
                    }))}
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
