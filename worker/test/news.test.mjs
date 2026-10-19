import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNewsMessages,
  isMadridMorning,
  parseNewsFeed,
  parseNewsSelection,
} from "../src/index.js";

test("parseNewsFeed extracts and decodes articles", () => {
  const xml = `
    <rss><channel>
      <item>
        <title>Fiscalía abre diligencias &amp; pide información - Agencia Uno</title>
        <link>https://example.com/noticia?a=1&amp;b=2</link>
        <pubDate>Wed, 14 Oct 2026 07:00:00 GMT</pubDate>
        <News:Source>Agencia Uno</News:Source>
      </item>
    </channel></rss>
  `;

  assert.deepEqual(parseNewsFeed(xml), [
    {
      title: "Fiscalía abre diligencias & pide información",
      link: "https://example.com/noticia?a=1&b=2",
      source: "Agencia Uno",
      publishedAt: Date.parse("Wed, 14 Oct 2026 07:00:00 GMT"),
    },
  ]);
});

test("parseNewsSelection ignores invalid and repeated selections", () => {
  const candidates = [
    {
      id: 1,
      title: "Titular uno",
      source: "Fuente",
      link: "https://example.com/1",
    },
    {
      id: 2,
      title: "Titular dos",
      source: "Fuente",
      link: "https://example.com/2",
    },
  ];
  const raw =
    "Texto previo [{\"id\":1,\"category\":\"JUDICIAL\"},{\"id\":1,\"category\":\"POLEMICA\"},{\"id\":3,\"category\":\"GESTION\"},{\"id\":2,\"category\":\"OTRA\"}] texto posterior";

  assert.deepEqual(parseNewsSelection(raw, candidates), [
    { ...candidates[0], category: "JUDICIAL" },
  ]);
});

test("buildNewsMessages keeps every Telegram message below the limit", () => {
  const articles = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    title: `Titular ${index + 1} ${"información ".repeat(20)}`,
    source: "Fuente de prueba",
    link: `https://example.com/noticia/${index + 1}/${"a".repeat(180)}`,
    category: "GESTION",
  }));

  const messages = buildNewsMessages(articles, new Date("2026-10-15T06:00:00Z"));

  assert.ok(messages.length > 1);
  assert.ok(messages.every((message) => message.length <= 3900));
  assert.match(messages.join("\n"), /Titular 12/);
});

test("isMadridMorning handles winter and summer time", () => {
  assert.equal(isMadridMorning(Date.parse("2026-01-15T07:00:00Z")), true);
  assert.equal(isMadridMorning(Date.parse("2026-07-15T06:00:00Z")), true);
  assert.equal(isMadridMorning(Date.parse("2026-07-15T07:00:00Z")), false);
});
