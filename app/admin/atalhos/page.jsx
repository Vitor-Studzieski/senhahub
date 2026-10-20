import Script from "next/script";
import HtmlTemplate from "../../components/shared/HtmlTemplate";

export const metadata = {
  title: "Alertas e atalhos",
  description: "Pontos de atenção do Pitch Day e acesso rápido às páginas do SenhaHub."
};

export default function AdminShortcutsPage() {
  return (
    <div className="manager-page">
      <HtmlTemplate fileName="admin-atalhos.html" />
      <Script src="/manager-dashboards.js?v=20261019.six-views-v4" strategy="afterInteractive" />
      <Script src="/admin.js?v=20261019.six-views-v4" strategy="afterInteractive" />
    </div>
  );
}
