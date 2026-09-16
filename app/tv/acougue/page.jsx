import Script from "next/script";
import HtmlTemplate from "../../components/shared/HtmlTemplate";

export const metadata = {
  title: "TV de atendimento",
  description: "Chamadas de senha e conteúdos da loja do Supermercado Pompeia."
};

export default function ButcherDisplayPage() {
  return (
    <>
      <HtmlTemplate fileName="tv-acougue.html" />
      <Script src="/tv-acougue.js?v=20260916.1" strategy="afterInteractive" />
    </>
  );
}
