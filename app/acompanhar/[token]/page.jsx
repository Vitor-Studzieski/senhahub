import Script from "next/script";
import HtmlTemplate from "../../components/shared/HtmlTemplate";

const TRACKING_ASSET_VERSION = "2026.09.11.4";

export const metadata = {
  title: "Acompanhar senha",
  description: "Acompanhe a posição da sua senha no SenhaHub."
};

export default function TrackTicketPage() {
  return (
    <>
      <HtmlTemplate fileName="acompanhar.html" />
      <Script src={`/vibration.js?v=${TRACKING_ASSET_VERSION}`} strategy="afterInteractive" />
      <Script src={`/acompanhar.js?v=${TRACKING_ASSET_VERSION}`} strategy="afterInteractive" />
    </>
  );
}
