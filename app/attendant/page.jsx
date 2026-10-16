import Script from "next/script";
import HtmlTemplate from "../components/shared/HtmlTemplate";

export default function AttendantPage() {
  return (
    <div className="attendant-page">
      <HtmlTemplate fileName="attendant.html" />
      <Script src="/attendant.js?v=20261015.queue-content-fit" strategy="afterInteractive" />
    </div>
  );
}
