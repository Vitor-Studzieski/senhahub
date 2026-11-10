import Script from "next/script";
import HtmlTemplate from "./components/shared/HtmlTemplate";

export const viewport = {
  themeColor: "#FF7200"
};

export default function CustomerPage() {
  return (
    <>
      <HtmlTemplate fileName="index.html" />
      <Script src="/app.js?v=20261021.customer-queue" strategy="afterInteractive" />
    </>
  );
}
