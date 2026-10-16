import Script from "next/script";
import { headers } from "next/headers";
import HtmlTemplate from "../components/shared/HtmlTemplate";

export const metadata = {
  title: "Solicitar senha",
  description: "Emissão de senhas digitais pelo tablet do atendimento."
};

export default async function TabletPage() {
  const nonce = (await headers()).get("x-nonce") || undefined;

  return (
    <>
      <HtmlTemplate fileName="tablet.html" />
      <Script src="/vendor/qrcode-generator.js" nonce={nonce} strategy="beforeInteractive" />
      <Script src="/tablet.js?v=20261016.pitchday-account-qr" strategy="afterInteractive" />
    </>
  );
}
