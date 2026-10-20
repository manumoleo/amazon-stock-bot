const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const STOCK_CRON = "* * * * *";
const NEWS_CRON = "0 6,7 * * *";
const MAX_NEWS_CANDIDATES = 80;
const MAX_NEWS_ARTICLES = 12;
const MAX_TELEGRAM_MESSAGE_LENGTH = 3900;
const NEWS_MAX_AGE_MS = 30 * 60 * 60 * 1000;
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
];
const NEWS_QUERIES = [
  "\"Gobierno de España\" investigación",
  "Gobierno España polémica",
  "Gobierno España irregularidades",
  "ministro España querella",
  "ministro España investigado",
  "ministerio España denuncia",
  "\"Administración General del Estado\" sanción",
  "\"empresa pública\" España fraude",
  "SEPI polémica",
  "ADIF investigación",
  "Renfe polémica",
  "Correos denuncia",
];
const NEWS_CATEGORY_LABELS = {
  JUDICIAL: "JUSTICIA E INVESTIGACIONES",
  CORRUPCION: "CORRUPCIÓN E IRREGULARIDADES",
  POLEMICA: "POLÉMICA",
  DIMISION: "DIMISIONES Y CESES",
  GESTION: "PROBLEMAS DE GESTIÓN",
  CONTROL: "FISCALIZACIÓN Y REPROBACIONES",
};

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

    if (message?.from?.is_bot !== true && receivedChatId === expectedChatId) {
      if (/^\/comprobar(?:@\w+)?(?:\s|$)/i.test(command)) {
        context.waitUntil(checkAndNotify(env, true));
      } else if (/^\/noticias(?:@\w+)?(?:\s|$)/i.test(command)) {
        context.waitUntil(collectAndNotifyNews(env, true));
      }
    }

    return jsonResponse({ ok: true });
  },
  async scheduled(controller, env, context) {
    if (controller.cron === STOCK_CRON) {
      context.waitUntil(checkAndNotify(env, false));
    } else if (
      controller.cron === NEWS_CRON &&
      isMadridMorning(controller.scheduledTime)
    ) {
      context.waitUntil(collectAndNotifyNews(env, false));
    }
  },
};

async function checkAndNotify(env, requestedFromTelegram) {
  const results = await Promise.all(PRODUCTS.map(fetchAmazonProduct));
  const statusLabels = {
    available: "DISPONIBLE",
    unavailable: "NO DISPONIBLE",
    unknown: "NO SE PUDO COMPROBAR",
  };
  const lines = ["Estado actual del producto de Amazon:", ""];

  for (const result of results) {
    lines.push(
      result.name,
      `Estado: ${statusLabels[result.status]}`,
      result.url,
      "",
    );
    console.log(`${result.asin}: ${result.status} - ${result.detail}`);
  }

  if (
    !requestedFromTelegram &&
    !results.some((result) => result.status === "available")
  ) {
    return;
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

async function collectAndNotifyNews(env, requestedFromTelegram) {
  if (requestedFromTelegram) {
    await sendTelegramMessage(env, "Recopilación de noticias iniciada.");
  }

  try {
    const candidates = await collectNewsCandidates();
    const selection = await selectAdverseNews(env, candidates);
    console.log(
      `Resumen de noticias: ${candidates.length} candidatos, ${selection.length} seleccionados`,
    );
    const messages = buildNewsMessages(selection, new Date());

    for (const message of messages) {
      await sendTelegramMessage(env, message);
    }
    return { candidates: candidates.length, selected: selection.length };
  } catch (error) {
    console.error(`No se pudo generar el resumen de noticias: ${error}`);
    await sendTelegramMessage(
      env,
      "No se pudo generar el resumen diario de noticias. Se volverá a intentar mañana.",
    );
    return { error: String(error) };
  }
}

async function collectNewsCandidates() {
  const feeds = await Promise.allSettled(NEWS_QUERIES.map(fetchBingNewsFeed));
  const articles = [];
  const feedErrors = [];
  let successfulFeeds = 0;

  for (const feed of feeds) {
    if (feed.status === "fulfilled") {
      successfulFeeds += 1;
      articles.push(...feed.value);
    } else {
      console.error(`No se pudo consultar un feed: ${feed.reason}`);
      feedErrors.push(String(feed.reason));
    }
  }

  if (successfulFeeds === 0) {
    throw new Error(
      `Bing News no respondió a ninguna consulta: ${feedErrors.join(" | ")}`,
    );
  }

  const range = {
    start: Date.now() - NEWS_MAX_AGE_MS,
    end: Date.now(),
  };

  const uniqueArticles = new Map();
  for (const article of articles) {
    if (article.publishedAt < range.start || article.publishedAt >= range.end) {
      continue;
    }
    const key = normalizeHeadline(article.title);
    if (!key || uniqueArticles.has(key)) {
      continue;
    }
    uniqueArticles.set(key, article);
  }

  return [...uniqueArticles.values()]
    .sort((left, right) => right.publishedAt - left.publishedAt)
    .slice(0, MAX_NEWS_CANDIDATES)
    .map((article, index) => ({ ...article, id: index + 1 }));
}

async function fetchBingNewsFeed(query) {
  const url = new URL("https://www.bing.com/news/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "rss");
  url.searchParams.set("mkt", "es-ES");

  const response = await fetch(url, {
    headers: { "User-Agent": AMAZON_HEADERS["User-Agent"] },
  });
  if (!response.ok) {
    throw new Error(`Bing News HTTP ${response.status}`);
  }

  return parseNewsFeed(await response.text());
}

function parseNewsFeed(xml) {
  const articles = [];
  const itemPattern = /<item>([\s\S]*?)<\/item>/gi;

  for (const match of xml.matchAll(itemPattern)) {
    const item = match[1];
    const source = decodeXml(
      readXmlTag(item, "News:Source") || readXmlTag(item, "source"),
    );
    let title = decodeXml(readXmlTag(item, "title"));
    const sourceSuffix = ` - ${source}`;
    if (source && title.endsWith(sourceSuffix)) {
      title = title.slice(0, -sourceSuffix.length);
    }

    const link = unwrapBingLink(decodeXml(readXmlTag(item, "link")));
    const publishedAt = Date.parse(decodeXml(readXmlTag(item, "pubDate")));
    if (!title || !link || !Number.isFinite(publishedAt)) {
      continue;
    }

    articles.push({
      title,
      link,
      source: source || "Fuente no indicada",
      publishedAt,
    });
  }

  return articles;
}

function unwrapBingLink(link) {
  try {
    const target = new URL(link).searchParams.get("url");
    return target || link;
  } catch {
    return link;
  }
}

function readXmlTag(xml, tag) {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  return xml.match(pattern)?.[1]?.replace(/^<!\[CDATA\[|\]\]>$/g, "").trim() || "";
}

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, number) =>
      String.fromCodePoint(Number.parseInt(number, 16)),
    )
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function normalizeHeadline(title) {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function selectAdverseNews(env, candidates) {
  if (candidates.length === 0) {
    return [];
  }

  const headlines = candidates.map(({ id, title, source }) => ({ id, title, source }));
  const prompt = `Eres un editor factual de noticias españolas. Selecciona solo titulares que describan un hecho adverso concreto relacionado directamente con el Gobierno actual de España, sus ministros o altos cargos, la Administración General del Estado, un organismo estatal o una empresa pública estatal.

Incluye procedimientos judiciales, investigaciones oficiales, corrupción o irregularidades, dimisiones o ceses controvertidos, reprobaciones, auditorías críticas, sanciones, conflictos de intereses, fallos graves de gestión y polémicas basadas en un suceso concreto.

Excluye opiniones sin hechos concretos, noticias positivas o neutras, oposición política sin relación directa con el Gobierno, partidos por sí solos, administraciones autonómicas o locales, otros países y casos donde una institución estatal solo presenta una denuncia y no es cuestionada. No conviertas una denuncia en investigación ni una investigación en condena. Deduplica sucesos y conserva el titular más claro.

Devuelve exclusivamente un array JSON con un máximo de ${MAX_NEWS_ARTICLES} objetos. Cada objeto debe contener "id" y "category". "id" debe existir en la lista y "category" debe ser JUDICIAL, CORRUPCION, POLEMICA, DIMISION, GESTION o CONTROL. Ordena primero los hechos judiciales o institucionalmente más graves.

Titulares:
${JSON.stringify(headlines)}`;

  const result = await env.AI.run("@cf/meta/llama-3.2-3b-instruct", {
    messages: [{ role: "user", content: prompt }],
    max_tokens: 800,
    temperature: 0,
  });
  const rawSelection = typeof result === "string" ? result : result?.response || "";
  return parseNewsSelection(rawSelection, candidates);
}

function parseNewsSelection(rawSelection, candidates) {
  const start = rawSelection.indexOf("[");
  const end = rawSelection.lastIndexOf("]");
  if (start === -1 || end < start) {
    throw new Error("Workers AI no devolvió una selección JSON válida");
  }

  let parsed;
  try {
    parsed = JSON.parse(rawSelection.slice(start, end + 1));
  } catch (error) {
    throw new Error(`Workers AI devolvió JSON no válido: ${error}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("La selección de Workers AI no es una lista");
  }

  const candidatesById = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  const selectedIds = new Set();
  const selected = [];

  for (const item of parsed) {
    const category = String(item?.category || "").toUpperCase();
    const candidate = candidatesById.get(Number(item?.id));
    if (
      !candidate ||
      !NEWS_CATEGORY_LABELS[category] ||
      selectedIds.has(candidate.id)
    ) {
      continue;
    }

    selectedIds.add(candidate.id);
    selected.push({ ...candidate, category });
    if (selected.length === MAX_NEWS_ARTICLES) {
      break;
    }
  }

  return selected;
}

function buildNewsMessages(articles, now) {
  const date = new Intl.DateTimeFormat("es-ES", {
    dateStyle: "long",
    timeZone: "Europe/Madrid",
  }).format(now);
  const header = [
    `Resumen diario del Gobierno y la Administración - ${date}`,
    "",
    "Selección automática basada en titulares. Abre cada fuente para comprobar el contexto.",
  ].join("\n");

  if (articles.length === 0) {
    return [`${header}\n\nNo se encontraron noticias que cumplieran los criterios.`];
  }

  const entries = articles.map((article, index) =>
    [
      `${index + 1}. ${NEWS_CATEGORY_LABELS[article.category]}`,
      article.title,
      `Fuente: ${article.source}`,
      article.link,
    ].join("\n"),
  );
  const messages = [];
  let current = header;

  for (const entry of entries) {
    const next = `${current}\n\n${entry}`;
    if (next.length > MAX_TELEGRAM_MESSAGE_LENGTH && current !== header) {
      messages.push(current);
      current = `Resumen diario (continuación):\n\n${entry}`;
    } else {
      current = next;
    }
  }
  messages.push(current);
  return messages;
}

function isMadridMorning(timestamp) {
  const hour = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    timeZone: "Europe/Madrid",
  }).format(new Date(timestamp));
  return hour === "08";
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

export { buildNewsMessages, isMadridMorning, parseNewsFeed, parseNewsSelection };
