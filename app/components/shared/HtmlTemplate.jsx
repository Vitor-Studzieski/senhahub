import fs from "node:fs";
import path from "node:path";

function readBodyTemplate(fileName) {
  const filePath = path.join(process.cwd(), "public", fileName);
  const html = fs.readFileSync(filePath, "utf8");
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  return body.replace(/<script[\s\S]*?<\/script>/gi, "").trim();
}

export default function HtmlTemplate({ fileName, trackingDemo = false, pitchday = false }) {
  let body = readBodyTemplate(fileName);
  if (pitchday && fileName === "index.html") {
    body = body
      .replace(
        '<section class="screen home-screen active" data-screen="home">',
        '<section class="screen home-screen active" data-screen="home" hidden style="display:none">'
      )
      .replace(
        '<section class="screen" data-screen="account">',
        '<section class="screen" data-screen="account" hidden style="display:none">'
      )
      .replace(
        '<button class="icon-button" id="notifyButton"',
        '<button class="icon-button" id="notifyButton" hidden style="display:none"'
      )
      .replace(
        '<nav class="tabbar" aria-label="Navegação principal">',
        '<nav class="tabbar" aria-label="Navegação principal" hidden style="display:none">'
      );
  }

  return (
    <div data-tracking-demo={trackingDemo ? "enabled" : undefined} dangerouslySetInnerHTML={{ __html: body }} />
  );
}
