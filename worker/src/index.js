const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const AMAZON_HEADERS = {
  "Accept-Language": "es-ES,es;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
};
const PRODUCTS = [
  {
    asin: "B0F2T6WM33",
    name: "Nintendo Switch 2 Pro Controller Zelda 40 Aniversario",
    url: "https://www.amazon.es/dp/B0F2T6WM33",
  },
  {
    asin: "B0F2TN43GH",
    name: "Nintendo Switch 2 - The Legend of Zelda Edition",
    url: "https://www.amazon.es/dp/B0F2TN43GH",
  },
];

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return jsonResponse({ ok: true, service: "amazon-stock-telegram-command" });
    }

    if (request.method !== "POST" || url.pathname !== "/telegram") {
      return jsonResponse({ ok: false, error: "Not found" }, 404);
    }

    if (
      !env.TELEGRAM_WEBHOOK_SECRET ||
      request.headers.get("X-Telegram-Bot-Api-Secret-Token") !==
        env.TELEGRAM_WEBHOOK_SECRET
    ) {
      return jsonResponse({ ok: false, error: "Forbidden" }, 403);
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
    }

    const message = update.message;
    const command = message?.text?.trim() || "";
    const expectedChatId = String(env.TELEGRAM_CHAT_ID || "");
    const receivedChatId = String(message?.chat?.id || "");

    if (
      message?.from?.is_bot !== true &&
      receivedChatId === expectedChatId &&
      /^\/comprobar(?:@\w+)?(?:\s|$)/i.test(command)
    ) {
      context.waitUntil(checkAndNotify(env, true));
    }

    return jsonResponse({ ok: true });
  },
  async scheduled(controller, env, context) {
    context.waitUntil(checkAndNotify(env, false));
  },
};

async function checkAndNotify(env, requestedFromTelegram) {
  if (requestedFromTelegram) {
    await sendTelegramMessage(env, "Comprobación iniciada.");
  }

  const results = await Promise.all(PRODUCTS.map(fetchAmazonProduct));
  const statusLabels = {
    available: "DISPONIBLE",
    unavailable: "NO DISPONIBLE",
    unknown: "NO SE PUDO COMPROBAR",
  };
  const lines = ["Estado actual de los productos de Amazon:", ""];

  for (const result of results) {
    lines.push(
      result.name,
      `Estado: ${statusLabels[result.status]}`,
      result.url,
      "",
    );
    console.log(`${result.asin}: ${result.status} - ${result.detail}`);
  }

  await sendTelegramMessage(env, lines.join("\n").trim());
}

async function fetchAmazonProduct(product) {
  try {
    const response = await fetch(product.url, { headers: AMAZON_HEADERS });
    const page = await response.text();
    const loweredPage = page.toLowerCase();

    if (
      loweredPage.includes("/errors/validatecaptcha") ||
      loweredPage.includes("enter the characters you see below") ||
      loweredPage.includes("api-services-support@amazon.com")
    ) {
      return { ...product, status: "unknown", detail: "Comprobación anti-bot" };
    }

    const outOfStockElement = /id=["']outofstock["']/i.test(page);
    const unavailableAvailability =
      /id=["']availability["'][\s\S]{0,3000}(actualmente no disponible|agotado temporalmente|temporalmente sin stock)/i.test(
        page,
      );
    if (outOfStockElement || unavailableAvailability) {
      return { ...product, status: "unavailable", detail: "Sin stock" };
    }

    if (
      loweredPage.includes('id="add-to-cart-button"') ||
      loweredPage.includes('id="buy-now-button"')
    ) {
      return { ...product, status: "available", detail: "Botón de compra encontrado" };
    }

    return { ...product, status: "unknown", detail: `HTTP ${response.status}` };
  } catch (error) {
    return { ...product, status: "unknown", detail: String(error) };
  }
}

async function sendTelegramMessage(env, text) {
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
    },
  );

  if (!response.ok) {
    throw new Error(`Telegram ${response.status}: ${await response.text()}`);
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
