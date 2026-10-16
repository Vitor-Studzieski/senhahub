import Script from "next/script";
import HtmlTemplate from "../../components/shared/HtmlTemplate";

const TRACKING_ASSET_VERSION = "2026.09.25.1";

export const metadata = {
  title: "Acompanhar senha",
  description: "Acompanhe a posição da sua senha no SenhaHub."
};

export default async function TrackTicketPage({ searchParams }) {
  const query = await searchParams;
  const trackingDemo = process.env.NODE_ENV === "development" || query?.demo === "1";

  return (
    <>
      <HtmlTemplate fileName="acompanhar.html" trackingDemo={trackingDemo} />
      <Script src={`/vibration.js?v=${TRACKING_ASSET_VERSION}`} strategy="afterInteractive" />
      <Script src={`/acompanhar.js?v=${TRACKING_ASSET_VERSION}`} strategy="afterInteractive" />
    </>
  );
}
