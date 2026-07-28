"use client"

import Image from "next/image"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

function getRedirectPath() {
  if (typeof window === "undefined") {
    return "/dashboard"
  }

  const parameters =
    new URLSearchParams(
      window.location.search
    )

  const nextPath =
    parameters.get("next")

  if (
    nextPath &&
    nextPath.startsWith("/") &&
    !nextPath.startsWith("//") &&
    nextPath !== "/login"
  ) {
    return nextPath
  }

  return "/dashboard"
}

export default function LoginPage() {
  const router = useRouter()

  const [username, setUsername] =
    useState("")

  const [password, setPassword] =
    useState("")

  const [showPassword, setShowPassword] =
    useState(false)

  const [isSubmitting, setIsSubmitting] =
    useState(false)

  const [isChecking, setIsChecking] =
    useState(true)

  const [message, setMessage] =
    useState("")

  useEffect(() => {
    let isMounted = true

    async function checkExistingSession() {
      try {
        const response = await fetch(
          "/api/auth/me",
          {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          }
        )

        if (response.ok) {
          router.replace(
            getRedirectPath()
          )

          return
        }
      } catch {
        // User belum memiliki session.
      }

      if (isMounted) {
        setIsChecking(false)
      }
    }

    checkExistingSession()

    return () => {
      isMounted = false
    }
  }, [router])

  async function handleSubmit(event) {
    event.preventDefault()

    setMessage("")

    const normalizedUsername =
      username.trim().toLowerCase()

    if (
      !normalizedUsername ||
      !password
    ) {
      setMessage(
        "Username dan password wajib diisi."
      )

      return
    }

    setIsSubmitting(true)

    try {
      const response = await fetch(
        "/api/auth/login",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            username:
              normalizedUsername,
            password,
          }),
        }
      )

      const result =
        await response.json()

      if (
        !response.ok ||
        !result.success
      ) {
        setMessage(
          result.message ||
            "Login gagal."
        )

        return
      }

      router.replace(
        getRedirectPath()
      )

      router.refresh()
    } catch (error) {
      console.error(
        "Login error:",
        error
      )

      setMessage(
        "Tidak dapat terhubung ke server."
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isChecking) {
    return (
      <div className="auth-loading-page">
        <div className="auth-loading-spinner" />

        <strong>
          Memeriksa session...
        </strong>
      </div>
    )
  }

  return (
    <main className="login-page">
      <section className="login-showcase">
        <div className="login-brand">
          <Image
            src="/logos.png"
            alt="BGI Core Application"
            width={180}
            height={70}
            priority
          />

          <div>
            <strong>
              BGI Core Application
            </strong>

            <span>
              Corporate Portal
            </span>
          </div>
        </div>

        <div className="login-showcase-content">
          <p className="login-eyebrow">
            Corporate Cash Management
          </p>

          <h1>
            Operation Control Center
          </h1>

          <p>
            Monitoring operasional,
            transaksi, approval, cabang,
            risiko, dan laporan dalam satu
            sistem terintegrasi.
          </p>

          <div className="login-feature-list">
            <div>
              <span>01</span>

              <p>
                Role-based access control
              </p>
            </div>

            <div>
              <span>02</span>

              <p>
                Secure user session
              </p>
            </div>

            <div>
              <span>03</span>

              <p>
                Operational monitoring
              </p>
            </div>
          </div>
        </div>

        <p className="login-copyright">
          BGI Core Application
        </p>
      </section>

      <section className="login-form-section">
        <div className="login-form-card">
          <div className="login-form-heading">
            <p className="login-eyebrow">
              Secure access
            </p>

            <h2>Masuk ke aplikasi</h2>

            <p>
              Gunakan akun yang telah
              terdaftar pada sistem.
            </p>
          </div>

          {message ? (
            <div
              className="login-alert"
              role="alert"
            >
              {message}
            </div>
          ) : null}

          <form
            className="login-form"
            onSubmit={handleSubmit}
          >
            <label className="login-field">
              <span>Username</span>

              <input
                type="text"
                value={username}
                onChange={(event) =>
                  setUsername(
                    event.target.value
                  )
                }
                placeholder="Masukkan username"
                autoComplete="username"
                maxLength={50}
                disabled={isSubmitting}
                autoFocus
              />
            </label>

            <label className="login-field">
              <span>Password</span>

              <div className="login-password-field">
                <input
                  type={
                    showPassword
                      ? "text"
                      : "password"
                  }
                  value={password}
                  onChange={(event) =>
                    setPassword(
                      event.target.value
                    )
                  }
                  placeholder="Masukkan password"
                  autoComplete="current-password"
                  maxLength={72}
                  disabled={isSubmitting}
                />

                <button
                  type="button"
                  onClick={() =>
                    setShowPassword(
                      (currentValue) =>
                        !currentValue
                    )
                  }
                  disabled={isSubmitting}
                >
                  {showPassword
                    ? "Sembunyikan"
                    : "Lihat"}
                </button>
              </div>
            </label>

            <button
              className="login-submit-button"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? "Memproses..."
                : "Masuk ke aplikasi"}
            </button>
          </form>

          <div className="login-security-info">
            <span>●</span>

            <p>
              Session login dilindungi
              menggunakan HTTP-only cookie.
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}