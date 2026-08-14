const ERROR_CORRECTION_LEVEL_M = 0
const PAD0 = 0xec
const PAD1 = 0x11

const RS_BLOCKS_M = Object.freeze({
  1: [[1, 26, 16]],
  2: [[1, 44, 28]],
  3: [[1, 70, 44]],
  4: [[2, 50, 32]],
  5: [[2, 67, 43]],
  6: [[4, 43, 27]],
  7: [[4, 49, 31]],
  8: [[2, 60, 38], [2, 61, 39]],
  9: [[3, 58, 36], [2, 59, 37]],
  10: [[4, 69, 43], [1, 70, 44]],
})

const PATTERN_POSITIONS = Object.freeze({
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
})

const EXP_TABLE = new Array(256)
const LOG_TABLE = new Array(256)
for (let index = 0; index < 8; index += 1) EXP_TABLE[index] = 1 << index
for (let index = 8; index < 256; index += 1) {
  EXP_TABLE[index] = EXP_TABLE[index - 4] ^ EXP_TABLE[index - 5] ^ EXP_TABLE[index - 6] ^ EXP_TABLE[index - 8]
}
for (let index = 0; index < 255; index += 1) LOG_TABLE[EXP_TABLE[index]] = index

function glog(value) {
  if (value < 1) throw new Error("QR logarithm input tidak valid.")
  return LOG_TABLE[value]
}

function gexp(value) {
  let normalized = value
  while (normalized < 0) normalized += 255
  while (normalized >= 256) normalized -= 255
  return EXP_TABLE[normalized]
}

class Polynomial {
  constructor(numbers, shift = 0) {
    let offset = 0
    while (offset < numbers.length && numbers[offset] === 0) offset += 1
    this.numbers = new Array(numbers.length - offset + shift).fill(0)
    for (let index = 0; index < numbers.length - offset; index += 1) {
      this.numbers[index] = numbers[index + offset]
    }
  }

  get length() {
    return this.numbers.length
  }

  get(index) {
    return this.numbers[index]
  }

  multiply(other) {
    const result = new Array(this.length + other.length - 1).fill(0)
    for (let left = 0; left < this.length; left += 1) {
      for (let right = 0; right < other.length; right += 1) {
        result[left + right] ^= gexp(glog(this.get(left)) + glog(other.get(right)))
      }
    }
    return new Polynomial(result)
  }

  mod(other) {
    if (this.length - other.length < 0) return this
    const ratio = glog(this.get(0)) - glog(other.get(0))
    const result = this.numbers.slice()
    for (let index = 0; index < other.length; index += 1) {
      result[index] ^= gexp(glog(other.get(index)) + ratio)
    }
    return new Polynomial(result).mod(other)
  }
}

class BitBuffer {
  constructor() {
    this.buffer = []
    this.length = 0
  }

  get(index) {
    const bufferIndex = Math.floor(index / 8)
    return ((this.buffer[bufferIndex] >>> (7 - (index % 8))) & 1) === 1
  }

  put(number, length) {
    for (let index = 0; index < length; index += 1) {
      this.putBit(((number >>> (length - index - 1)) & 1) === 1)
    }
  }

  putBit(bit) {
    const bufferIndex = Math.floor(this.length / 8)
    if (this.buffer.length <= bufferIndex) this.buffer.push(0)
    if (bit) this.buffer[bufferIndex] |= 0x80 >>> (this.length % 8)
    this.length += 1
  }
}

function getRsBlocks(version) {
  const definitions = RS_BLOCKS_M[version]
  if (!definitions) throw new Error("Panjang URL verifikasi melebihi kapasitas QR lokal.")
  const blocks = []
  for (const [count, totalCount, dataCount] of definitions) {
    for (let index = 0; index < count; index += 1) blocks.push({ totalCount, dataCount })
  }
  return blocks
}

function getErrorCorrectPolynomial(length) {
  let polynomial = new Polynomial([1])
  for (let index = 0; index < length; index += 1) {
    polynomial = polynomial.multiply(new Polynomial([1, gexp(index)]))
  }
  return polynomial
}

function createBytes(buffer, rsBlocks) {
  let offset = 0
  let maximumDataCount = 0
  let maximumErrorCount = 0
  const dataCodewords = []
  const errorCodewords = []

  for (let blockIndex = 0; blockIndex < rsBlocks.length; blockIndex += 1) {
    const dataCount = rsBlocks[blockIndex].dataCount
    const errorCount = rsBlocks[blockIndex].totalCount - dataCount
    maximumDataCount = Math.max(maximumDataCount, dataCount)
    maximumErrorCount = Math.max(maximumErrorCount, errorCount)

    const data = new Array(dataCount)
    for (let index = 0; index < dataCount; index += 1) {
      data[index] = 0xff & buffer.buffer[index + offset]
    }
    offset += dataCount
    dataCodewords.push(data)

    const rsPolynomial = getErrorCorrectPolynomial(errorCount)
    const rawPolynomial = new Polynomial(data, rsPolynomial.length - 1)
    const modPolynomial = rawPolynomial.mod(rsPolynomial)
    const error = new Array(rsPolynomial.length - 1).fill(0)
    const modOffset = error.length - modPolynomial.length
    for (let index = 0; index < modPolynomial.length; index += 1) {
      error[index + modOffset] = modPolynomial.get(index)
    }
    errorCodewords.push(error)
  }

  const totalCodewords = rsBlocks.reduce((sum, block) => sum + block.totalCount, 0)
  const output = []
  for (let index = 0; index < maximumDataCount; index += 1) {
    for (let blockIndex = 0; blockIndex < rsBlocks.length; blockIndex += 1) {
      if (index < dataCodewords[blockIndex].length) output.push(dataCodewords[blockIndex][index])
    }
  }
  for (let index = 0; index < maximumErrorCount; index += 1) {
    for (let blockIndex = 0; blockIndex < rsBlocks.length; blockIndex += 1) {
      if (index < errorCodewords[blockIndex].length) output.push(errorCodewords[blockIndex][index])
    }
  }

  if (output.length !== totalCodewords) throw new Error("Pembentukan codeword QR tidak konsisten.")
  return output
}

function createData(version, bytes) {
  const rsBlocks = getRsBlocks(version)
  const buffer = new BitBuffer()
  buffer.put(4, 4)
  buffer.put(bytes.length, version < 10 ? 8 : 16)
  for (const byte of bytes) buffer.put(byte, 8)

  const totalDataCount = rsBlocks.reduce((sum, block) => sum + block.dataCount, 0)
  const capacity = totalDataCount * 8
  if (buffer.length > capacity) return null

  if (buffer.length + 4 <= capacity) buffer.put(0, 4)
  while (buffer.length % 8 !== 0) buffer.putBit(false)
  let useFirstPad = true
  while (buffer.length < capacity) {
    buffer.put(useFirstPad ? PAD0 : PAD1, 8)
    useFirstPad = !useFirstPad
  }

  return createBytes(buffer, rsBlocks)
}

function getBchTypeInfo(data) {
  let value = data << 10
  const generator = 0x537
  while (getBchDigit(value) - getBchDigit(generator) >= 0) {
    value ^= generator << (getBchDigit(value) - getBchDigit(generator))
  }
  return ((data << 10) | value) ^ 0x5412
}

function getBchTypeNumber(data) {
  let value = data << 12
  const generator = 0x1f25
  while (getBchDigit(value) - getBchDigit(generator) >= 0) {
    value ^= generator << (getBchDigit(value) - getBchDigit(generator))
  }
  return (data << 12) | value
}

function getBchDigit(data) {
  let digit = 0
  let value = data
  while (value !== 0) {
    digit += 1
    value >>>= 1
  }
  return digit
}

function maskBit(maskPattern, row, column) {
  switch (maskPattern) {
    case 0: return (row + column) % 2 === 0
    case 1: return row % 2 === 0
    case 2: return column % 3 === 0
    case 3: return (row + column) % 3 === 0
    case 4: return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0
    case 5: return (row * column) % 2 + (row * column) % 3 === 0
    case 6: return ((row * column) % 2 + (row * column) % 3) % 2 === 0
    case 7: return ((row * column) % 3 + (row + column) % 2) % 2 === 0
    default: throw new Error("Mask QR tidak valid.")
  }
}

function setupPositionProbePattern(modules, row, column) {
  const count = modules.length
  for (let rowOffset = -1; rowOffset <= 7; rowOffset += 1) {
    if (row + rowOffset < 0 || row + rowOffset >= count) continue
    for (let columnOffset = -1; columnOffset <= 7; columnOffset += 1) {
      if (column + columnOffset < 0 || column + columnOffset >= count) continue
      modules[row + rowOffset][column + columnOffset] =
        (rowOffset >= 0 && rowOffset <= 6 && (columnOffset === 0 || columnOffset === 6)) ||
        (columnOffset >= 0 && columnOffset <= 6 && (rowOffset === 0 || rowOffset === 6)) ||
        (rowOffset >= 2 && rowOffset <= 4 && columnOffset >= 2 && columnOffset <= 4)
    }
  }
}

function setupPositionAdjustPattern(modules, version) {
  const positions = PATTERN_POSITIONS[version]
  for (const row of positions) {
    for (const column of positions) {
      if (modules[row][column] !== null) continue
      for (let rowOffset = -2; rowOffset <= 2; rowOffset += 1) {
        for (let columnOffset = -2; columnOffset <= 2; columnOffset += 1) {
          modules[row + rowOffset][column + columnOffset] =
            Math.abs(rowOffset) === 2 || Math.abs(columnOffset) === 2 ||
            (rowOffset === 0 && columnOffset === 0)
        }
      }
    }
  }
}

function setupTimingPattern(modules) {
  const count = modules.length
  for (let row = 8; row < count - 8; row += 1) {
    if (modules[row][6] === null) modules[row][6] = row % 2 === 0
  }
  for (let column = 8; column < count - 8; column += 1) {
    if (modules[6][column] === null) modules[6][column] = column % 2 === 0
  }
}

function setupTypeNumber(modules, version, test) {
  const bits = getBchTypeNumber(version)
  const count = modules.length
  for (let index = 0; index < 18; index += 1) {
    const bit = !test && ((bits >> index) & 1) === 1
    modules[Math.floor(index / 3)][index % 3 + count - 8 - 3] = bit
    modules[index % 3 + count - 8 - 3][Math.floor(index / 3)] = bit
  }
}

function setupTypeInfo(modules, maskPattern, test) {
  const data = (ERROR_CORRECTION_LEVEL_M << 3) | maskPattern
  const bits = getBchTypeInfo(data)
  const count = modules.length

  for (let index = 0; index < 15; index += 1) {
    const bit = !test && ((bits >> index) & 1) === 1
    if (index < 6) modules[index][8] = bit
    else if (index < 8) modules[index + 1][8] = bit
    else modules[count - 15 + index][8] = bit
  }

  for (let index = 0; index < 15; index += 1) {
    const bit = !test && ((bits >> index) & 1) === 1
    if (index < 8) modules[8][count - index - 1] = bit
    else if (index < 9) modules[8][15 - index] = bit
    else modules[8][15 - index - 1] = bit
  }

  modules[count - 8][8] = !test
}

function mapData(modules, data, maskPattern) {
  const count = modules.length
  let row = count - 1
  let direction = -1
  let byteIndex = 0
  let bitIndex = 7

  for (let column = count - 1; column > 0; column -= 2) {
    if (column === 6) column -= 1
    while (true) {
      for (let offset = 0; offset < 2; offset += 1) {
        const targetColumn = column - offset
        if (modules[row][targetColumn] !== null) continue
        let dark = false
        if (byteIndex < data.length) dark = ((data[byteIndex] >>> bitIndex) & 1) === 1
        if (maskBit(maskPattern, row, targetColumn)) dark = !dark
        modules[row][targetColumn] = dark
        bitIndex -= 1
        if (bitIndex === -1) {
          byteIndex += 1
          bitIndex = 7
        }
      }
      row += direction
      if (row < 0 || row >= count) {
        row -= direction
        direction = -direction
        break
      }
    }
  }
}

function makeMatrix(version, data, maskPattern, test = false) {
  const moduleCount = version * 4 + 17
  const modules = Array.from({ length: moduleCount }, () => new Array(moduleCount).fill(null))
  setupPositionProbePattern(modules, 0, 0)
  setupPositionProbePattern(modules, moduleCount - 7, 0)
  setupPositionProbePattern(modules, 0, moduleCount - 7)
  setupPositionAdjustPattern(modules, version)
  setupTimingPattern(modules)
  setupTypeInfo(modules, maskPattern, test)
  if (version >= 7) setupTypeNumber(modules, version, test)
  mapData(modules, data, maskPattern)
  return modules
}

function lostPoint(modules) {
  const count = modules.length
  let score = 0
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      let sameCount = 0
      const dark = modules[row][column]
      for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
        if (row + rowOffset < 0 || row + rowOffset >= count) continue
        for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
          if (column + columnOffset < 0 || column + columnOffset >= count) continue
          if (rowOffset === 0 && columnOffset === 0) continue
          if (dark === modules[row + rowOffset][column + columnOffset]) sameCount += 1
        }
      }
      if (sameCount > 5) score += 3 + sameCount - 5
    }
  }

  for (let row = 0; row < count - 1; row += 1) {
    for (let column = 0; column < count - 1; column += 1) {
      const darkCount = Number(modules[row][column]) + Number(modules[row + 1][column]) +
        Number(modules[row][column + 1]) + Number(modules[row + 1][column + 1])
      if (darkCount === 0 || darkCount === 4) score += 3
    }
  }

  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count - 6; column += 1) {
      if (
        modules[row][column] && !modules[row][column + 1] && modules[row][column + 2] &&
        modules[row][column + 3] && modules[row][column + 4] &&
        !modules[row][column + 5] && modules[row][column + 6]
      ) score += 40
    }
  }

  for (let column = 0; column < count; column += 1) {
    for (let row = 0; row < count - 6; row += 1) {
      if (
        modules[row][column] && !modules[row + 1][column] && modules[row + 2][column] &&
        modules[row + 3][column] && modules[row + 4][column] &&
        !modules[row + 5][column] && modules[row + 6][column]
      ) score += 40
    }
  }

  const darkCount = modules.flat().filter(Boolean).length
  score += Math.abs(100 * darkCount / count / count - 50) / 5 * 10
  return score
}

export function createQrMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(String(text || "")))
  if (bytes.length === 0) throw new Error("Data QR tidak boleh kosong.")

  let version = null
  let data = null
  for (let candidate = 1; candidate <= 10; candidate += 1) {
    const candidateData = createData(candidate, bytes)
    if (candidateData) {
      version = candidate
      data = candidateData
      break
    }
  }
  if (!version || !data) throw new Error("URL verifikasi terlalu panjang untuk QR lokal.")

  let bestMatrix = null
  let bestScore = Number.POSITIVE_INFINITY
  for (let maskPattern = 0; maskPattern < 8; maskPattern += 1) {
    const matrix = makeMatrix(version, data, maskPattern, true)
    const score = lostPoint(matrix)
    if (score < bestScore) {
      bestScore = score
      bestMatrix = makeMatrix(version, data, maskPattern, false)
    }
  }
  return bestMatrix
}

function escapeSvgAttribute(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

export function createQrSvg(text, options = {}) {
  const matrix = createQrMatrix(text)
  const quietZone = Number.isInteger(options.quietZone) ? Math.max(0, options.quietZone) : 4
  const moduleCount = matrix.length
  const viewSize = moduleCount + quietZone * 2
  const ariaLabel = escapeSvgAttribute(options.ariaLabel || "QR verifikasi Surat Tugas")
  const paths = []
  for (let row = 0; row < moduleCount; row += 1) {
    for (let column = 0; column < moduleCount; column += 1) {
      if (matrix[row][column]) paths.push(`M${column + quietZone},${row + quietZone}h1v1h-1z`)
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" shape-rendering="crispEdges" role="img" aria-label="${ariaLabel}"><rect width="100%" height="100%" fill="#fff"/><path d="${paths.join("")}" fill="#000"/></svg>`
}
