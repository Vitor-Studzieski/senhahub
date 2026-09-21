import Script from "next/script";
import HtmlTemplate from "../components/shared/HtmlTemplate";

export const metadata = {
  title: "Solicitar senha",
  description: "Emissão de senhas digitais pelo tablet do atendimento."
};

export default function TabletPage() {
  return (
    <>
      <HtmlTemplate fileName="tablet.html" />
      <Script src="/vendor/qrcode-generator.js" strategy="beforeInteractive" />
      <Script src="/tablet.js?v=20260921.2" strategy="afterInteractive" />
    </>
  );
}
