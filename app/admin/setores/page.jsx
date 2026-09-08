import Script from "next/script";
import HtmlTemplate from "../../components/shared/HtmlTemplate";

export default function AdminSectorsPage() {
  return (
    <div className="manager-page">
      <HtmlTemplate fileName="admin-setores.html" />
      <Script src="/admin.js?v=20260906.1" strategy="afterInteractive" />
    </div>
  );
}
