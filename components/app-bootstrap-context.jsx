"use client"

import { createContext, useContext } from "react"

const AppBootstrapContext = createContext(null)

export function AppBootstrapProvider({ value, children }) {
  return (
    <AppBootstrapContext.Provider value={value}>
      {children}
    </AppBootstrapContext.Provider>
  )
}

export function useAppBootstrap() {
  const context = useContext(AppBootstrapContext)

  if (!context) {
    throw new Error("useAppBootstrap harus digunakan di dalam AppBootstrapProvider.")
  }

  return context
}
