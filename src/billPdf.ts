import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// HTML -> PDF using a headless Chrome that is already on the machine.
//
// Deliberately no puppeteer/playwright dependency: those ship their own
// ~150MB browser and this needs one command. The trade is that Chrome must
// exist, so a missing browser is reported as a clear, actionable failure
// rather than a crash — the bill itself is unaffected either way, since the
// PDF is a rendering of a record that is already saved.

const CANDIDATE_BROWSERS = [
  process.env["CHROME_PATH"],
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/microsoft-edge",
].filter((p): p is string => typeof p === "string" && p.length > 0);

export class PdfUnavailableError extends Error {
  constructor() {
    super(
      "No Chrome/Chromium found for PDF rendering. Set CHROME_PATH to a browser binary.",
    );
    this.name = "PdfUnavailableError";
  }
}

async function findBrowser(): Promise<string> {
  for (const candidate of CANDIDATE_BROWSERS) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try the next one
    }
  }
  throw new PdfUnavailableError();
}

export async function htmlToPdf(html: string, fileStem: string): Promise<string> {
  const browser = await findBrowser();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "likho-bill-"));
  const htmlPath = path.join(dir, "bill.html");
  // The filename is what the seller sees in Telegram, so keep it readable
  // but strip anything that could escape the directory.
  const safeStem = fileStem.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 60) || "bill";
  const pdfPath = path.join(dir, `${safeStem}.pdf`);

  await fs.writeFile(htmlPath, html, "utf8");

  await run(
    browser,
    [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      // Page size and margins come from the template's own @page rule.
      "--no-pdf-header-footer",
      `--print-to-pdf=${pdfPath}`,
      `file://${htmlPath}`,
    ],
    { timeout: 30_000 },
  );

  await fs.access(pdfPath);
  return pdfPath;
}

// Renders HTML to a PNG. Used for the in-chat template previews: a seller
// choosing how their bill looks should SEE the bill, in the same app, not
// read six descriptions of it.
export async function htmlToPng(
  html: string,
  fileStem: string,
  width: number,
  height: number,
): Promise<string> {
  const browser = await findBrowser();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "likho-preview-"));
  const htmlPath = path.join(dir, "preview.html");
  const safeStem = fileStem.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 60) || "preview";
  const pngPath = path.join(dir, `${safeStem}.png`);

  await fs.writeFile(htmlPath, html, "utf8");
  await run(
    browser,
    [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      `--window-size=${width},${height}`,
      `--screenshot=${pngPath}`,
      `file://${htmlPath}`,
    ],
    { timeout: 30_000 },
  );

  await fs.access(pngPath);
  return pngPath;
}
