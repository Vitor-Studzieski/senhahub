import Script from "next/script";
import HtmlTemplate from "./components/shared/HtmlTemplate";

export default async function CustomerPage({ searchParams }) {
  const query = await searchParams;
  const isPitchday = String(query?.ecosystem || "").toLowerCase() === "pitchday";

  return (
    <>
      <HtmlTemplate fileName="index.html" pitchday={isPitchday} />
      <Script src="/app.js?v=20261016.pitchday-request-card" strategy="afterInteractive" />
    </>
  );
}
