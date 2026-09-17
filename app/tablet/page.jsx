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
      <Script src="/tablet.js?v=20260916.2" strategy="afterInteractive" />
    </>
  );
}
