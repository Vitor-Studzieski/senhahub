import Script from "next/script";
import HtmlTemplate from "../../components/shared/HtmlTemplate";

export const metadata = {
  title: "TV Pitch Day",
  description: "Chamadas de senha e conteúdos do atendimento Pitch Day."
};

export default function PitchdayDisplayPage() {
  return (
    <>
      <HtmlTemplate fileName="tv-acougue.html" />
      <Script src="/tv-acougue.js?v=20261017.pitchday-tv-route" strategy="afterInteractive" />
    </>
  );
}
