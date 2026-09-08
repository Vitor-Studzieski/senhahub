import Script from "next/script";
import HtmlTemplate from "../components/shared/HtmlTemplate";

export default function AttendantPage() {
  return (
    <>
      <HtmlTemplate fileName="attendant.html" />
      <Script src="/attendant.js?v=20260908.3" strategy="afterInteractive" />
    </>
  );
}
