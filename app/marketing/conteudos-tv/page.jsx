import Script from "next/script";
import HtmlTemplate from "../../components/shared/HtmlTemplate";

export const metadata = {
  title: "Conteúdos da TV",
  description: "Gerenciamento dos vídeos e imagens exibidos nas TVs do SenhaHub."
};

export default function MarketingTvContentPage() {
  return (
    <div className="manager-page">
      <HtmlTemplate fileName="marketing-tv.html" />
      <Script src="/marketing-tv.js?v=20260922.1" strategy="afterInteractive" />
    </div>
  );
}
