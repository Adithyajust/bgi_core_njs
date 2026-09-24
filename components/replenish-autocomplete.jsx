"use client"

import { useEffect, useMemo, useRef, useState } from "react"

async function loadOptions({ source, search, ukerId, teamRole, signal, optionsUrl }) {
  if (optionsUrl) {
    const query = new URLSearchParams()
    if (search) query.set("search", search)
    const separator = optionsUrl.includes("?") ? "&" : "?"
    const response = await fetch(`${optionsUrl}${query.size ? `${separator}${query}` : ""}`, {
      credentials: "include", cache: "no-store", signal,
    })
    const result = await response.json()
    if (!response.ok || !result.success) throw new Error(result.message || "Gagal memuat pilihan.")
    return Array.isArray(result.data?.options) ? result.data.options : []
  }
  const query = new URLSearchParams({ source, limit: "20" })
  if (search) query.set("search", search)
  if (ukerId) query.set("uker_id", String(ukerId))
  if (teamRole) query.set("team_role", String(teamRole))

  const response = await fetch(`/api/transactions/replenish/options?${query}`, {
    credentials: "include",
    cache: "no-store",
    signal,
  })
  const result = await response.json()

  if (!response.ok || !result.success) {
    const error = new Error(result.message || "Gagal memuat pilihan.")
    error.status = response.status
    throw error
  }

  return Array.isArray(result.data?.options) ? result.data.options : []
}

export function ReplenishAutocomplete({
  source,
  selected,
  onSelect,
  ukerId = null,
  placeholder = "Cari data...",
  disabled = false,
  excludeValues = [],
  teamRole = null,
  clearOnSelect = false,
  optionsUrl = "",
}) {
  const wrapperRef = useRef(null)
  const [query, setQuery] = useState(selected?.label || "")
  const [options, setOptions] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const excludeKey = excludeValues.map(String).sort().join("|")
  const excludedValues = useMemo(() => new Set(excludeKey ? excludeKey.split("|") : []), [excludeKey])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) setQuery(selected?.label || "")
    })
    return () => {
      cancelled = true
    }
  }, [selected])

  useEffect(() => {
    function closeOutside(event) {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false)
    }

    document.addEventListener("mousedown", closeOutside)
    return () => document.removeEventListener("mousedown", closeOutside)
  }, [])

  useEffect(() => {
    if (!open || disabled) return undefined
    if (source !== "uker" && !ukerId) {
      const timer = window.setTimeout(() => setOptions([]), 0)
      return () => window.clearTimeout(timer)
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError("")
      loadOptions({
        source,
        search: selected && query === selected.label ? "" : query.trim(),
        ukerId,
        teamRole,
        signal: controller.signal,
        optionsUrl,
      })
        .then((items) => {
          if (controller.signal.aborted) return
          setOptions(items.filter((item) => !excludedValues.has(String(item.value))))
        })
        .catch((loadError) => {
          if (loadError.name === "AbortError") return
          setError(loadError.message)
          setOptions([])
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 250)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [disabled, excludedValues, open, optionsUrl, query, selected, source, teamRole, ukerId])

  function handleChange(event) {
    const next = event.target.value
    setQuery(next)
    setOpen(true)
    if (selected && next !== selected.label) onSelect(null)
  }

  return (
    <div className="replenish-autocomplete" ref={wrapperRef}>
      <div className="replenish-autocomplete-input-wrap">
        <input
          type="text"
          value={query}
          onChange={handleChange}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
        />
        {selected && !disabled ? (
          <button
            type="button"
            className="replenish-autocomplete-clear"
            onClick={() => {
              onSelect(null)
              setQuery("")
              setOpen(true)
            }}
            aria-label="Hapus pilihan"
          >
            ×
          </button>
        ) : null}
      </div>

      {open && !disabled ? (
        <div className="replenish-autocomplete-menu">
          {source !== "uker" && !ukerId ? (
            <p>Pilih unit kerja terlebih dahulu.</p>
          ) : loading ? (
            <p>Memuat data...</p>
          ) : error ? (
            <p className="error">{error}</p>
          ) : options.length === 0 ? (
            <p>Data tidak ditemukan.</p>
          ) : (
            options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onSelect(option)
                  setQuery(clearOnSelect ? "" : option.label)
                  if (clearOnSelect) setOptions([])
                  setOpen(false)
                }}
              >
                <strong>{option.label}</strong>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
