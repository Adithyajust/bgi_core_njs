export default function manifest() {
  return {
    name: "BGI Replenish Lapangan",
    short_name: "BGI Field",
    description: "Aplikasi lapangan Custody untuk pekerjaan Replenish ATM/CRM.",
    start_url: "/field_replenish",
    scope: "/",
    display: "standalone",
    background_color: "#f4f7fb",
    theme_color: "#075985",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/logos.png",
        sizes: "any",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
  }
}
