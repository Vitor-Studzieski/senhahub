import fs from "node:fs";
import path from "node:path";

function readBodyTemplate(fileName) {
  const filePath = path.join(process.cwd(), "public", fileName);
  const html = fs.readFileSync(filePath, "utf8");
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  return body.replace(/<script[\s\S]*?<\/script>/gi, "").trim();
}

export default function HtmlTemplate({ fileName, trackingDemo = false }) {
  return (
    <div
      data-tracking-demo={trackingDemo ? "enabled" : undefined}
      dangerouslySetInnerHTML={{ __html: readBodyTemplate(fileName) }}
    />
  );
}
