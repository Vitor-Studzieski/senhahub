import Script from "next/script";
import { headers } from "next/headers";
import HtmlTemplate from "../components/shared/HtmlTemplate";

export const metadata = {
  title: "Totem de senhas",
  description: "Emissao de senhas fisicas do SenhaHub."
};

const TOTEM_ASSET_VERSION = "2026.09.23.3";

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
