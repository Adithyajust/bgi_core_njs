export const executiveCards = [
  {
    label: "Dana Kelolaan Corporate",
    value: "Rp 18,42 T",
    delta: "+12.8%",
    tone: "blue",
    helper: "Naik dibanding bulan lalu",
  },
  {
    label: "Transaksi Hari Ini",
    value: "248.719",
    delta: "+8.4%",
    tone: "orange",
    helper: "Sukses, pending, dan review",
  },
  {
    label: "Approval SLA",
    value: "96,7%",
    delta: "+3.1%",
    tone: "green",
    helper: "Rata-rata 18 menit",
  },
  {
    label: "Risk Alert Aktif",
    value: "37",
    delta: "-9.6%",
    tone: "red",
    helper: "Prioritas sedang dan tinggi",
  },
];

export const transactions = [
  { company: "PT Mandala Energi", type: "Payroll Bulk", amount: "Rp 8,7 M", status: "Approved", time: "09:42", risk: "Low" },
  { company: "CV Sentra Niaga", type: "Vendor Payment", amount: "Rp 420 Jt", status: "Review", time: "10:18", risk: "Medium" },
  { company: "PT Agritech Nusantara", type: "Cash Management", amount: "Rp 2,1 M", status: "Approved", time: "10:37", risk: "Low" },
  { company: "PT Lintas Karya", type: "International Transfer", amount: "Rp 980 Jt", status: "Pending", time: "11:02", risk: "High" },
  { company: "PT Prisma Retail", type: "Auto Collection", amount: "Rp 1,3 M", status: "Approved", time: "11:31", risk: "Low" },
];

export const approvals = [
  { title: "Limit kenaikan transaksi", owner: "Relationship Manager", due: "12 menit lagi", priority: "High" },
  { title: "Pembukaan rekening giro", owner: "Corporate Onboarding", due: "28 menit lagi", priority: "Medium" },
  { title: "Validasi dokumen vendor", owner: "Operation Checker", due: "47 menit lagi", priority: "Medium" },
];

export const branchPerformance = [
  { name: "Jakarta Corporate", score: 92, volume: "Rp 5,6 T" },
  { name: "Surabaya Regional", score: 86, volume: "Rp 3,9 T" },
  { name: "Medan Commercial", score: 79, volume: "Rp 2,2 T" },
  { name: "Makassar Business", score: 74, volume: "Rp 1,8 T" },
];

export const customers = [
  { name: "PT Mandala Energi", segment: "Enterprise", pic: "Ayu Pramesti", balance: "Rp 2,8 T", health: "Excellent" },
  { name: "PT Agritech Nusantara", segment: "Commercial", pic: "Rama Dewangga", balance: "Rp 940 M", health: "Good" },
  { name: "PT Prisma Retail", segment: "Mid Corporate", pic: "Nadia Putri", balance: "Rp 575 M", health: "Good" },
  { name: "CV Sentra Niaga", segment: "SME Plus", pic: "Bima Satria", balance: "Rp 82 M", health: "Watchlist" },
];

export const reports = [
  "Daily Corporate Liquidity",
  "Cash Management Settlement",
  "High Value Transaction Review",
  "Branch Performance Summary",
  "Risk & Compliance Snapshot",
];

export const areaBranches = [
  { area: "Jakarta Corporate", offices: 18, portfolio: "Rp 5,6 T", growth: "+14,2%", sla: "97%" },
  { area: "Surabaya Regional", offices: 14, portfolio: "Rp 3,9 T", growth: "+9,8%", sla: "94%" },
  { area: "Medan Commercial", offices: 11, portfolio: "Rp 2,2 T", growth: "+7,5%", sla: "91%" },
  { area: "Makassar Business", offices: 9, portfolio: "Rp 1,8 T", growth: "+6,1%", sla: "89%" },
];

export const analyticsInsights = [
  { title: "Corporate liquidity naik", value: "+12,8%", note: "Kenaikan terbesar dari payroll bulk dan cash management." },
  { title: "Transaksi high value stabil", value: "248K", note: "Volume harian meningkat tanpa lonjakan risk alert signifikan." },
  { title: "Approval bottleneck", value: "18 mnt", note: "Rata-rata approval masih aman, tetapi dokumen vendor perlu perhatian." },
];
