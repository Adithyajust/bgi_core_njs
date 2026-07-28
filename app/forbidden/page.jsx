import Link from "next/link"

export default function ForbiddenPage() {
  return (
    <section className="forbidden-page">
      <div className="forbidden-card">
        <div className="forbidden-code">
          403
        </div>

        <p className="eyebrow">
          Access denied
        </p>

        <h2>
          Anda tidak memiliki hak akses
        </h2>

        <p>
          Role akun Anda tidak memiliki
          izin untuk membuka halaman
          tersebut.
        </p>

        <div className="forbidden-actions">
          <Link
            href="/dashboard"
            className="primary-button"
          >
            Kembali ke Dashboard
          </Link>
        </div>
      </div>
    </section>
  )
}