const { buildTicketReceipt } = require("./escpos-receipt");

function rawbtUrlForPrintJob(printJob) {
  if (!printJob || typeof printJob !== "object") return "";

  const payload = printJob.payload && typeof printJob.payload === "object"
    ? printJob.payload
    : null;
  if (!payload) return "";

  try {
    const bytes = buildTicketReceipt(payload, { transport: "rawbt" });
    return `rawbt:base64,${bytes.toString("base64")}`;
  } catch {
    return "";
  }
}

function withRawbtUrl(printJob) {
  if (!printJob) return null;
  return {
    ...printJob,
    rawbtUrl: rawbtUrlForPrintJob(printJob)
  };
}

module.exports = {
  rawbtUrlForPrintJob,
  withRawbtUrl
};
