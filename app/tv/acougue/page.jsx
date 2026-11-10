import Script from "next/script";
import HtmlTemplate from "../../components/shared/HtmlTemplate";
import CallKeyboardShortcuts from "./CallKeyboardShortcuts";

export const metadata = {
  title: "TV de atendimento",
  description: "Chamadas de senha e conteúdos da loja do Supermercado Pompeia."
};

export const viewport = {
  themeColor: "#FF7200"
};

export default function ButcherDisplayPage() {
  return (
    <>
      <HtmlTemplate fileName="tv-acougue.html" />
      <CallKeyboardShortcuts />
      <Script src="/tv-acougue.js?v=20261110.ble-shortcut-lifecycle" strategy="afterInteractive" />
    </>
  );
}
