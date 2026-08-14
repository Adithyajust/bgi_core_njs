import { randomUUID } from "node:crypto"

import { createQrSvg } from "../replenish/qr-code.js"

export function createToken() {
  return randomUUID()
}

export async function createQR(url) {
  const svg = createQrSvg(url, {
    quietZone: 4,
    ariaLabel: "QR verifikasi Surat Tugas",
  })

  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`
}
