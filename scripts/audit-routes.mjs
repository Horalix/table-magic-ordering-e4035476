import { chromium } from "playwright";

const baseUrl = process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:8080";
const chromePath =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const routes = [
  "/",
  "/menu",
  "/menu/drinks",
  "/menu/food",
  "/menu/dessert",
  "/cart",
  "/tab",
  "/table/1",
  "/admin/login",
  "/admin",
  "/admin/menu",
  "/admin/tables",
  "/admin/orders",
  "/admin/analytics",
  "/admin/qr-codes",
  "/admin/sections",
  "/admin/waiters",
  "/admin/performance",
  "/kitchen",
  "/waiter/login",
  "/waiter/monitor",
  "/waiter",
  "/missing-route",
];

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
});

const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

for (const route of routes) {
  const consoleMessages = [];
  const requestFailures = [];

  page.removeAllListeners("console");
  page.removeAllListeners("pageerror");
  page.removeAllListeners("requestfailed");

  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleMessages.push(`${message.type()}: ${message.text()}`);
    }
  });

  page.on("pageerror", (error) => {
    consoleMessages.push(`pageerror: ${error.message}`);
  });

  page.on("requestfailed", (request) => {
    requestFailures.push(
      `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`,
    );
  });

  let status = null;
  try {
    const response = await page.goto(`${baseUrl}${route}`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    status = response?.status() ?? null;
  } catch (error) {
    status = `ERR ${error instanceof Error ? error.message : String(error)}`;
  }

  await page.waitForTimeout(300);

  const report = {
    route,
    status,
    finalUrl: page.url(),
    title: await page.title().catch(() => null),
    heading: await page
      .locator("h1,h2")
      .first()
      .innerText({ timeout: 1_000 })
      .catch(() => null),
    buttons: await page
      .locator("button:visible")
      .evaluateAll((buttons) =>
        buttons.slice(0, 30).map((button) => ({
          text: (button.innerText || button.getAttribute("aria-label") || "").trim(),
          disabled: button.disabled,
          type: button.getAttribute("type"),
        })),
      )
      .catch(() => []),
    links: await page
      .locator("a:visible")
      .evaluateAll((links) =>
        links.slice(0, 30).map((link) => ({
          text: (link.innerText || link.getAttribute("aria-label") || "").trim(),
          href: link.getAttribute("href"),
        })),
      )
      .catch(() => []),
    images: await page
      .locator("img")
      .evaluateAll((images) =>
        images.slice(0, 12).map((image) => ({
          src: image.getAttribute("src"),
          alt: image.getAttribute("alt"),
          complete: image.complete,
          naturalWidth: image.naturalWidth,
        })),
      )
      .catch(() => []),
    console: consoleMessages.slice(0, 12),
    requestFailures: requestFailures.slice(0, 12),
  };

  console.log(JSON.stringify(report));
}

await browser.close();
