import Script from "next/script";
import HtmlTemplate from "../../components/shared/HtmlTemplate";

export default function AdminUsersPage() {
  return (
    <div className="manager-page">
      <HtmlTemplate fileName="admin-usuarios.html" />
      <Script src="/admin.js?v=20260915.5" strategy="afterInteractive" />
    </div>
  );
}
