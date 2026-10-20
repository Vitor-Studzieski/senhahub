import Script from "next/script";
import HtmlTemplate from "../components/shared/HtmlTemplate";

export default function AdminPage() {
  return (
    <div className="manager-page">
      <HtmlTemplate fileName="admin.html" />
      <Script src="/manager-dashboards.js?v=20261019.six-views-v4" strategy="afterInteractive" />
      <Script src="/admin.js?v=20261019.six-views-v4" strategy="afterInteractive" />
    </div>
  );
}
