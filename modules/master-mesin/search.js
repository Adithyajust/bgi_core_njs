export function normalizeSearchTerm(value, maximumLength = 100) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : ""
}

export function escapeLikePattern(value) {
  return String(value || "")
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
}

export function createSearchPatterns(value) {
  const normalized = normalizeSearchTerm(value)
  const escaped = escapeLikePattern(normalized)

  return {
    normalized,
    exact: normalized,
    prefix: `${escaped}%`,
    contains: `%${escaped}%`,
  }
}
