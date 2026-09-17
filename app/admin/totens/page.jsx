import Script from "next/script";
import HtmlTemplate from "../../components/shared/HtmlTemplate";

export default function AdminKiosksPage() {
  return (
    <div className="manager-page">
      <HtmlTemplate fileName="admin-totens.html" />
      <Script src="/admin.js?v=20260917.1" strategy="afterInteractive" />
    </div>
  );
}
