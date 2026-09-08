import Script from "next/script";
import HtmlTemplate from "./components/shared/HtmlTemplate";

export default function CustomerPage() {
  return (
    <>
      <HtmlTemplate fileName="index.html" />
      <Script src="/app.js?v=20260908.1" strategy="afterInteractive" />
    </>
  );
}
