import Script from "next/script";
import HtmlTemplate from "../../components/shared/HtmlTemplate";

export const metadata = {
  title: "Central de atalhos",
  description: "Acesso rápido às páginas do SenhaHub pelo painel do gestor."
};

export default function AdminShortcutsPage() {
  return (
    <div className="manager-page">
      <HtmlTemplate fileName="admin-atalhos.html" />
      <Script src="/admin.js?v=20261016.ticket-tracking-view" strategy="afterInteractive" />
    </div>
  );
}
