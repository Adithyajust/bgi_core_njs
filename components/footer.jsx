import Link from "next/link";

export function Footer() {
   const currentYear = new Date().getFullYear();

  return (
    <footer className="app-footer">
      <div>
        <strong>BGi Corporate Portal</strong>
        <strong>© {currentYear} By IT- Managemen</strong>
      </div>
      <div className="footer-links">
        <Link href="/reports">Reports</Link>
        <Link href="/risk">Compliance</Link>
        <Link href="/settings">Settings</Link>
        <span>v1.2.0</span>
      </div>
    </footer>
  );
}
