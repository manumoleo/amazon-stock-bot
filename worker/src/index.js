const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

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
      context.waitUntil(triggerCheck(env));
    }

    return jsonResponse({ ok: true });
  },
};

async function triggerCheck(env) {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${env.GITHUB_ACTIONS_TOKEN}`,
          "Content-Type": "application/json",
          "User-Agent": "amazon-stock-telegram-command",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ ref: env.GITHUB_REF }),
      },
    );

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`GitHub ${response.status}: ${details.slice(0, 300)}`);
    }

    await sendTelegramMessage(
      env,
      "Comprobación iniciada. El resultado llegará en unos segundos.",
    );
  } catch (error) {
    console.error("No se pudo iniciar la comprobación", error);
    await sendTelegramMessage(
      env,
      "No se pudo iniciar la comprobación. Inténtalo de nuevo más tarde.",
    );
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
