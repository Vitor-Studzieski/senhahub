import Script from "next/script";
import { headers } from "next/headers";
import HtmlTemplate from "../components/shared/HtmlTemplate";

export const metadata = {
  title: "Totem de senhas",
  description: "Emissao de senhas fisicas do SenhaHub."
};

export const viewport = {
  themeColor: "#FF7200"
};

const TOTEM_ASSET_VERSION = "20261016.pitchday-qr-root";

export default async function TotemPage() {
  const nonce = (await headers()).get("x-nonce") || undefined;

  return (
    <>
      <HtmlTemplate fileName="totem.html" />
      <Script src="/vendor/qrcode-generator.js" nonce={nonce} strategy="beforeInteractive" />
      <Script src={`/totem.js?v=${TOTEM_ASSET_VERSION}`} strategy="afterInteractive" />
    </>
  );
}
