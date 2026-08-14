const CODE128_PATTERNS = Object.freeze([
  "212222", "222122", "222221", "121223", "121322", "131222",
  "122213", "122312", "132212", "221213", "221312", "231212",
  "112232", "122132", "122231", "113222", "123122", "123221",
  "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321",
  "112313", "132113", "132311", "211313", "231113", "231311",
  "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131",
  "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124",
  "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111",
  "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141",
  "411131", "211412", "211214", "211232", "2331112",
])

const START_CODE_B = 104
const STOP_CODE = 106
const MIN_ASCII_B = 32
const MAX_ASCII_B = 126

function escapeXml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

export function encodeCode128B(value) {
  const text = String(value || "")

  if (!text) {
    throw new Error("Data barcode tidak boleh kosong.")
  }

  const dataCodes = []
  for (const character of text) {
    const ascii = character.codePointAt(0)
    if (ascii < MIN_ASCII_B || ascii > MAX_ASCII_B) {
      throw new Error("Barcode Code 128-B hanya mendukung karakter ASCII 32 sampai 126.")
    }
    dataCodes.push(ascii - MIN_ASCII_B)
  }

  let checksum = START_CODE_B
  for (let index = 0; index < dataCodes.length; index += 1) {
    checksum += dataCodes[index] * (index + 1)
  }
  checksum %= 103

  return [START_CODE_B, ...dataCodes, checksum, STOP_CODE]
}

export function createCode128Bars(value, options = {}) {
  const quietZone = Number.isFinite(options.quietZone)
    ? Math.max(0, Number(options.quietZone))
    : 10
  const codes = encodeCode128B(value)
  const bars = []
  let cursor = quietZone

  for (const code of codes) {
    const pattern = CODE128_PATTERNS[code]
    if (!pattern) throw new Error("Pola Code 128 tidak ditemukan.")

    for (let index = 0; index < pattern.length; index += 1) {
      const width = Number(pattern[index])
      if (index % 2 === 0) bars.push({ x: cursor, width })
      cursor += width
    }
  }

  return {
    bars,
    moduleCount: cursor + quietZone,
    codes,
  }
}

export function createCode128Svg(value, options = {}) {
  const text = String(value || "")
  const height = Number.isFinite(options.height) ? Math.max(24, Number(options.height)) : 72
  const showText = options.showText !== false
  const textHeight = showText ? 18 : 0
  const ariaLabel = escapeXml(options.ariaLabel || `Barcode ${text}`)
  const encoded = createCode128Bars(text, options)
  const bars = encoded.bars
    .map(({ x, width }) => `<rect x="${x}" y="0" width="${width}" height="${height}"/>`)
    .join("")
  const humanReadable = showText
    ? `<text x="${encoded.moduleCount / 2}" y="${height + 14}" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" font-size="12" font-weight="700" letter-spacing="0.8">${escapeXml(text)}</text>`
    : ""

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${encoded.moduleCount} ${height + textHeight}" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges" role="img" aria-label="${ariaLabel}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${bars}</g>${humanReadable}</svg>`
}
