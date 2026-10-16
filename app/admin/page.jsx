import Script from "next/script";
import HtmlTemplate from "../components/shared/HtmlTemplate";

export default function AdminPage() {
  return (
    <div className="manager-page">
      <HtmlTemplate fileName="admin.html" />
      <Script src="/admin.js?v=20261015.admin-shortcuts-tab" strategy="afterInteractive" />
    </div>
  );
}
