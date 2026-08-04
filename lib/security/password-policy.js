export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 72

export function validatePasswordPolicy(password) {
  if (typeof password !== "string" || password.length === 0) {
    return "Password wajib diisi."
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password minimal ${PASSWORD_MIN_LENGTH} karakter.`
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password maksimal ${PASSWORD_MAX_LENGTH} karakter.`
  }

  if (!/[a-z]/.test(password)) {
    return "Password harus memiliki huruf kecil."
  }

  if (!/[A-Z]/.test(password)) {
    return "Password harus memiliki huruf besar."
  }

  if (!/[0-9]/.test(password)) {
    return "Password harus memiliki angka."
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    return "Password harus memiliki karakter khusus."
  }

  return null
}
