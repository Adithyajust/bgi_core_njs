console.warn("scripts/init-db.mjs telah diganti. Menjalankan migration runner tanpa membuat akun default.")
await import("./migrate.mjs")
