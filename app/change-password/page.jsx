"use client"

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useRouter } from "next/navigation"
import { useAppBootstrap } from "@/components/app-bootstrap-context"
import { getAuthenticatedHomePath } from "@/lib/default-route"

const PASSWORD_MIN_LENGTH = 10
const PASSWORD_MAX_LENGTH = 72

function getPasswordChecks(password, username) {
  const normalizedUsername = String(
    username || ""
  )
    .trim()
    .toLowerCase()

  return {
    length:
      password.length >= PASSWORD_MIN_LENGTH &&
      password.length <= PASSWORD_MAX_LENGTH,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
    noUsername:
      normalizedUsername.length < 4 ||
      !password
        .toLowerCase()
        .includes(normalizedUsername),
  }
}

async function readJsonResponse(response) {
  const contentType =
    response.headers.get("content-type") || ""

  if (!contentType.includes("application/json")) {
    const responseText = await response.text()

    console.error(
      "Change password endpoint returned non-JSON:",
      {
        status: response.status,
        contentType,
        responseText: responseText.slice(0, 300),
      }
    )

    throw new Error(
      `Server mengembalikan respons yang tidak valid (HTTP ${response.status}).`
    )
  }

  return response.json()
}

function PasswordInput({
  id,
  label,
  value,
  onChange,
  autoComplete,
  disabled,
  error,
}) {
  const [isVisible, setIsVisible] =
    useState(false)

  return (
    <div className="change-password-field">
      <label htmlFor={id}>{label}</label>

      <div
        className={`change-password-input-wrap${
          error ? " has-error" : ""
        }`}
      >
        <input
          id={id}
          name={id}
          type={isVisible ? "text" : "password"}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          minLength={
            id === "current-password"
              ? undefined
              : PASSWORD_MIN_LENGTH
          }
          maxLength={PASSWORD_MAX_LENGTH}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={
            error ? `${id}-error` : undefined
          }
          required
        />

        <button
          type="button"
          className="change-password-visibility"
          onClick={() =>
            setIsVisible((current) => !current)
          }
          disabled={disabled}
          aria-label={
            isVisible
              ? `Sembunyikan ${label.toLowerCase()}`
              : `Tampilkan ${label.toLowerCase()}`
          }
        >
          {isVisible ? "Sembunyikan" : "Tampilkan"}
        </button>
      </div>

      {error ? (
        <small
          id={`${id}-error`}
          className="change-password-field-error"
        >
          {error}
        </small>
      ) : null}
    </div>
  )
}

function RequirementItem({ isValid, children }) {
  return (
    <li className={isValid ? "is-valid" : ""}>
      <span aria-hidden="true">
        {isValid ? "✓" : "•"}
      </span>
      {children}
    </li>
  )
}

export default function ChangePasswordPage() {
  const router = useRouter()
  const { user } = useAppBootstrap()
  const redirectTimerRef = useRef(null)
  const [currentPassword, setCurrentPassword] =
    useState("")
  const [newPassword, setNewPassword] =
    useState("")
  const [confirmation, setConfirmation] =
    useState("")
  const [fieldErrors, setFieldErrors] =
    useState({})
  const [message, setMessage] = useState("")
  const [isError, setIsError] = useState(false)
  const [isSubmitting, setIsSubmitting] =
    useState(false)
  const [isSuccess, setIsSuccess] =
    useState(false)

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) {
        window.clearTimeout(redirectTimerRef.current)
      }
    }
  }, [])

  const passwordChecks = useMemo(
    () =>
      getPasswordChecks(
        newPassword,
        user?.username
      ),
    [newPassword, user?.username]
  )

  const requirementsMet = Object.values(
    passwordChecks
  ).every(Boolean)

  const confirmationMatches =
    confirmation.length > 0 &&
    confirmation === newPassword

  const isSameAsCurrent =
    currentPassword.length > 0 &&
    newPassword.length > 0 &&
    currentPassword === newPassword

  const formIsValid =
    currentPassword.length > 0 &&
    newPassword.length > 0 &&
    requirementsMet &&
    confirmationMatches &&
    !isSameAsCurrent

  const displayName =
    user?.pegawai?.nama ||
    user?.fullName ||
    user?.username ||
    "Pengguna"

  const mustChangePassword = Boolean(
    user?.mustChangePassword
  )

  function clearFieldError(fieldName) {
    setFieldErrors((current) => {
      if (!current[fieldName]) {
        return current
      }

      const nextErrors = { ...current }
      delete nextErrors[fieldName]
      return nextErrors
    })
  }

  function validateForm() {
    const errors = {}

    if (!currentPassword) {
      errors.currentPassword =
        "Password saat ini wajib diisi."
    }

    if (!newPassword) {
      errors.newPassword =
        "Password baru wajib diisi."
    } else if (!requirementsMet) {
      errors.newPassword =
        "Password baru belum memenuhi seluruh ketentuan keamanan."
    } else if (isSameAsCurrent) {
      errors.newPassword =
        "Password baru harus berbeda dari password saat ini."
    }

    if (!confirmation) {
      errors.confirmation =
        "Konfirmasi password baru wajib diisi."
    } else if (!confirmationMatches) {
      errors.confirmation =
        "Konfirmasi password baru tidak sama."
    }

    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleSubmit(event) {
    event.preventDefault()

    if (isSubmitting || isSuccess) {
      return
    }

    setMessage("")
    setIsError(false)

    if (!validateForm()) {
      return
    }

    setIsSubmitting(true)

    try {
      const response = await fetch(
        "/api/auth/change-password",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            current_password: currentPassword,
            new_password: newPassword,
            password_confirmation: confirmation,
          }),
        }
      )

      const result =
        await readJsonResponse(response)

      if (response.status === 401) {
        if (
          String(result.message || "")
            .toLowerCase()
            .includes("session")
        ) {
          router.replace(
            "/login?next=%2Fchange-password"
          )
          return
        }

        setFieldErrors((current) => ({
          ...current,
          currentPassword:
            result.message ||
            "Password saat ini tidak benar.",
        }))
        setIsError(true)
        setMessage(
          result.message ||
            "Password saat ini tidak benar."
        )
        return
      }

      if (!response.ok || !result.success) {
        setIsError(true)
        setMessage(
          result.message ||
            "Password gagal diperbarui."
        )
        return
      }

      setCurrentPassword("")
      setNewPassword("")
      setConfirmation("")
      setFieldErrors({})
      setIsError(false)
      setIsSuccess(true)
      setMessage(
        "Password berhasil diperbarui. Sesi lain telah dikeluarkan untuk menjaga keamanan akun."
      )

      redirectTimerRef.current =
        window.setTimeout(() => {
          router.replace(getAuthenticatedHomePath(user))
          router.refresh()
        }, 1400)
    } catch (error) {
      console.error(
        "Ubah password gagal:",
        error
      )
      setIsError(true)
      setMessage(
        error.message ||
          "Tidak dapat terhubung ke server."
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleCancel() {
    if (mustChangePassword) {
      return
    }

    router.back()
  }

  return (
    <main className="password-change-page">
      <section className="password-change-card">
        <div className="password-change-heading">
          <div className="password-change-icon" aria-hidden="true">
            <span>•••</span>
          </div>

          <div>
            <p className="login-eyebrow">
              Keamanan akun
            </p>
            <h1>Ubah password</h1>
            <p>
              {mustChangePassword
                ? "Anda wajib membuat password baru sebelum melanjutkan penggunaan aplikasi."
                : `Perbarui password untuk akun ${displayName}.`}
            </p>
          </div>
        </div>

        {message ? (
          <div
            className={`change-password-alert ${
              isError
                ? "is-error"
                : "is-success"
            }`}
            role="alert"
          >
            <strong>
              {isError
                ? "Perubahan belum berhasil"
                : "Password diperbarui"}
            </strong>
            <span>{message}</span>
          </div>
        ) : null}

        <form
          className="change-password-form"
          onSubmit={handleSubmit}
          noValidate
        >
          <PasswordInput
            id="current-password"
            label="Password saat ini"
            value={currentPassword}
            onChange={(event) => {
              setCurrentPassword(
                event.target.value
              )
              clearFieldError(
                "currentPassword"
              )
              setMessage("")
            }}
            autoComplete="current-password"
            disabled={isSubmitting || isSuccess}
            error={fieldErrors.currentPassword}
          />

          <PasswordInput
            id="new-password"
            label="Password baru"
            value={newPassword}
            onChange={(event) => {
              setNewPassword(event.target.value)
              clearFieldError("newPassword")
              clearFieldError("confirmation")
              setMessage("")
            }}
            autoComplete="new-password"
            disabled={isSubmitting || isSuccess}
            error={fieldErrors.newPassword}
          />

          <div className="password-requirements">
            <strong>Ketentuan password</strong>
            <ul>
              <RequirementItem
                isValid={passwordChecks.length}
              >
                10–72 karakter
              </RequirementItem>
              <RequirementItem
                isValid={passwordChecks.lowercase}
              >
                Memiliki huruf kecil
              </RequirementItem>
              <RequirementItem
                isValid={passwordChecks.uppercase}
              >
                Memiliki huruf besar
              </RequirementItem>
              <RequirementItem
                isValid={passwordChecks.number}
              >
                Memiliki angka
              </RequirementItem>
              <RequirementItem
                isValid={passwordChecks.special}
              >
                Memiliki karakter khusus
              </RequirementItem>
              <RequirementItem
                isValid={passwordChecks.noUsername}
              >
                Tidak mengandung username
              </RequirementItem>
            </ul>
          </div>

          <PasswordInput
            id="password-confirmation"
            label="Konfirmasi password baru"
            value={confirmation}
            onChange={(event) => {
              setConfirmation(event.target.value)
              clearFieldError("confirmation")
              setMessage("")
            }}
            autoComplete="new-password"
            disabled={isSubmitting || isSuccess}
            error={fieldErrors.confirmation}
          />

          {confirmation.length > 0 ? (
            <p
              className={`password-match-status ${
                confirmationMatches
                  ? "is-match"
                  : "is-mismatch"
              }`}
              aria-live="polite"
            >
              {confirmationMatches
                ? "Konfirmasi password sudah sesuai."
                : "Konfirmasi password belum sesuai."}
            </p>
          ) : null}

          <div className="change-password-actions">
            {!mustChangePassword ? (
              <button
                className="change-password-cancel"
                type="button"
                onClick={handleCancel}
                disabled={isSubmitting || isSuccess}
              >
                Batal
              </button>
            ) : null}

            <button
              className="change-password-submit"
              type="submit"
              disabled={
                isSubmitting ||
                isSuccess ||
                !formIsValid
              }
            >
              {isSubmitting
                ? "Menyimpan..."
                : isSuccess
                  ? "Berhasil disimpan"
                  : "Simpan password baru"}
            </button>
          </div>
        </form>

        <div className="change-password-security-note">
          <span aria-hidden="true">i</span>
          <p>
            Setelah password diperbarui, seluruh sesi lain akan otomatis dikeluarkan. Sesi pada perangkat ini tetap aktif.
          </p>
        </div>
      </section>
    </main>
  )
}
