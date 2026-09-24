import HtmlTemplate from "../components/shared/HtmlTemplate";

export default function LoginPage() {
  return (
    <>
      <HtmlTemplate fileName="login.html" />
      <script src="/login.js?v=20260924.security2" />
    </>
  );
}
