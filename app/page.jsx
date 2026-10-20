import Script from "next/script";
import { cookies } from "next/headers";
import HtmlTemplate from "./components/shared/HtmlTemplate";

export const viewport = {
  themeColor: "#FF7200"
};

export default async function CustomerPage({ searchParams }) {
  const query = await searchParams;
  const cookieStore = await cookies();
  const isPitchday = String(query?.ecosystem || "").toLowerCase() === "pitchday"
    || cookieStore.has("senhahub_pitchday_guest");

  return (
    <>
      <HtmlTemplate fileName="index.html" pitchday={isPitchday} />
      <Script src="/app.js?v=20261016.pitchday-url-queue-sync" strategy="afterInteractive" />
    </>
  );
}
