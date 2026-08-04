import { IconCog, IconGrid, IconReport, IconShield, IconTransfer, IconUsers } from "@/components/icons";

/**
 * Icon map dipakai untuk mengubah nama icon dari database
 * menjadi komponen React.
 *
 * Contoh data database:
 * icon = "IconGrid"
 *
 * Di React akan menjadi:
 * IconGrid
 */
export const iconMap = {IconGrid, IconUsers, IconTransfer, IconShield, IconReport, IconCog, };

/**
 * Fallback sidebar routes.
 * Ini tetap dipakai kalau database belum aktif / API gagal.
 * Jadi template Anda tidak rusak.
 */

// export const sidebarRoutes = [
//   { label: "Dashboard", href: "/dashboard", icon: IconGrid, badge: "Live" },
//   { label: "Nasabah Corporate", href: "/customers", icon: IconUsers },
//   { label: "Transaksi", href: "/transactions", icon: IconTransfer },
//   { label: "Approval Center", href: "/approvals", icon: IconShield, badge: "12" },
//   { label: "Cabang & Area", href: "/branches", icon: IconGrid },
//   { label: "Analytics", href: "/analytics", icon: IconReport },
//   { label: "Risk Monitor", href: "/risk", icon: IconShield },
//   { label: "Laporan", href: "/reports", icon: IconReport },
//   { label: "Pengaturan", href: "/settings", icon: IconCog },
// ];

export const navbarRoutes = [
  { label: "Overview", href: "/dashboard", description: "KPI utama" },
  { label: "Corporate", href: "/customers", description: "Nasabah" },
  { label: "Operations", href: "/transactions", description: "Transaksi" },
  { label: "Approvals", href: "/approvals", description: "Persetujuan" },
  { label: "Branches", href: "/branches", description: "Area" },
  { label: "Analytics", href: "/analytics", description: "Insight" },
  { label: "Reports", href: "/reports", description: "Dokumen" },
];

export const routeMap = [
  { path: "/", name: "Home", file: "app/page.jsx", note: "Redirect otomatis ke dashboard" },
  { path: "/dashboard", name: "Dashboard", file: "app/dashboard/page.jsx", note: "Ringkasan KPI dan operasi" },
  { path: "/customers", name: "Nasabah Corporate", file: "app/customers/page.jsx", note: "Daftar portofolio nasabah" },
  { path: "/transactions", name: "Transaksi", file: "app/transactions/page.jsx", note: "Monitoring transaksi" },
  { path: "/transactions/replenish", name: "Replenish ATM/CRM", file: "app/transactions/replenish/page.jsx", note: "Work order, tim, jadwal, dan persetujuan replenish" },
  { path: "/approvals", name: "Approval Center", file: "app/approvals/page.jsx", note: "Queue persetujuan" },
  { path: "/branches", name: "Cabang & Area", file: "app/branches/page.jsx", note: "Performa jaringan kantor" },
  { path: "/analytics", name: "Analytics", file: "app/analytics/page.jsx", note: "Insight bisnis dan tren" },
  { path: "/risk", name: "Risk Monitor", file: "app/risk/page.jsx", note: "Risiko dan compliance" },
  { path: "/reports", name: "Laporan", file: "app/reports/page.jsx", note: "Report center" },
  { path: "/settings", name: "Pengaturan", file: "app/settings/page.jsx", note: "Konfigurasi sistem" },
  { path: "/masters", name: "Master Data", file: "app/masters/page.jsx", note: "Menu pengelolaan data master" },
  { path: "/masters/kendaraan", name: "Master Kendaraan", file: "app/masters/kendaraan/page.jsx", note: "Pengelolaan kendaraan per unit kerja" },
  // { path: "/masters/project", name: "Master Project", file: "app/masters/project/page.jsx", note: "Pengelolaan project" },
];

/**
 * Helper untuk mengubah hasil database menjadi format sidebar template.
 */
export function mapDatabaseSidebarRoutes(databaseRoutes = []) {
  return databaseRoutes.map((item) => ({
    label: item.label,
    href: item.href,
    icon: iconMap[item.icon] || IconGrid,
    badge: item.badge || undefined,
  }));
}