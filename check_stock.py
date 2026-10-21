#!/usr/bin/env python3

import html
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import date
from html.parser import HTMLParser
from pathlib import Path


PRODUCTS = (
    {
        "asin": "B0HJ89X1VQ",
        "url": "https://www.amazon.es/dp/B0HJ89X1VQ",
    },
)

STATE_FILE = Path(__file__).with_name(".stock-state.json")
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/129.0.0.0 Safari/537.36"
)


class ProductPageParser(HTMLParser):
    CAPTURE_IDS = {"availability", "outOfStock", "productTitle"}
    BUY_BUTTON_IDS = {"add-to-cart-button", "buy-now-button"}
    VOID_TAGS = {
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "param",
        "source",
        "track",
        "wbr",
    }

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.buy_button_found = False
        self.captured = {target: [] for target in self.CAPTURE_IDS}
        self._capture_target = None
        self._capture_depth = 0
        self._suppressed_depth = 0

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        element_id = attributes.get("id")

        if tag in {"script", "style"}:
            self._suppressed_depth += 1

        if element_id in self.BUY_BUTTON_IDS:
            self.buy_button_found = True

        if self._capture_target is not None and tag not in self.VOID_TAGS:
            self._capture_depth += 1
        elif element_id in self.CAPTURE_IDS:
            self._capture_target = element_id
            self._capture_depth = 1

    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self._suppressed_depth -= 1

        if self._capture_target is None:
            return

        self._capture_depth -= 1
        if self._capture_depth == 0:
            self._capture_target = None

    def handle_data(self, data):
        if self._capture_target is not None and self._suppressed_depth == 0:
            self.captured[self._capture_target].append(data)

    def text(self, target):
        return normalize_text(" ".join(self.captured[target]))


def normalize_text(value):
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def inspect_page(page):
    lowered_page = page.lower()
    challenge_markers = (
        "enter the characters you see below",
        "introduce los caracteres que aparecen a continuación",
        "api-services-support@amazon.com",
        "/errors/validatecaptcha",
    )
    if any(marker in lowered_page for marker in challenge_markers):
        return "unknown", "Amazon ha mostrado una comprobación anti-bot", ""

    parser = ProductPageParser()
    parser.feed(page)
    title = parser.text("productTitle")
    availability = parser.text("availability") or parser.text("outOfStock")
    lowered_availability = availability.lower()

    unavailable_markers = (
        ("actualmente no disponible", "Actualmente no disponible"),
        ("agotado temporalmente", "Agotado temporalmente"),
        ("temporalmente sin stock", "Temporalmente sin stock"),
        ("no disponible", "No disponible"),
        ("agotado", "Agotado"),
    )
    for marker, summary in unavailable_markers:
        if marker in lowered_availability:
            return "unavailable", summary, title

    available_markers = (
        ("en stock", "En stock"),
        ("disponible", "Disponible"),
    )
    for marker, summary in available_markers:
        if marker in lowered_availability:
            return "available", summary, title
    if parser.buy_button_found:
        return "available", "Botón de compra encontrado", title

    return "unknown", availability or "No se pudo determinar el estado", title


def fetch_product(product):
    request = urllib.request.Request(
        product["url"],
        headers={
            "Accept-Language": "es-ES,es;q=0.9",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            page = response.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError) as error:
        return "unknown", f"Error de red: {error}", ""

    return inspect_page(page)


def load_state():
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError as error:
        raise RuntimeError(f"El archivo de estado no es válido: {error}") from error


def save_state(state):
    content = json.dumps(state, ensure_ascii=True, indent=2, sort_keys=True) + "\n"
    STATE_FILE.write_text(content, encoding="utf-8")


def send_telegram_text(text):
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        raise RuntimeError(
            "Faltan los secretos TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID"
        )

    payload = json.dumps({"chat_id": chat_id, "text": text}).encode("utf-8")
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Telegram ha rechazado el aviso: {details}") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise RuntimeError(f"No se pudo contactar con Telegram: {error}") from error

    if not result.get("ok"):
        raise RuntimeError(f"Telegram ha rechazado el aviso: {result}")


def send_status_message(products):
    status_labels = {
        "available": "DISPONIBLE",
        "unavailable": "NO DISPONIBLE",
        "unknown": "NO SE PUDO COMPROBAR",
    }
    lines = ["Estado actual del producto de Amazon:", ""]
    for product in products:
        name = product["title"] or product["asin"]
        lines.extend(
            (
                name,
                f"Estado: {status_labels[product['status']]}",
                product["url"],
                "",
            )
        )
    send_telegram_text("\n".join(lines).strip())


def main():
    previous_state = load_state()
    next_state = dict(previous_state)
    checked_products = []

    today = date.today()
    try:
        last_activity = date.fromisoformat(previous_state.get("_last_activity", ""))
    except ValueError:
        last_activity = None
    if last_activity is None or (today - last_activity).days >= 30:
        next_state["_last_activity"] = today.isoformat()

    for product in PRODUCTS:
        status, detail, title = fetch_product(product)
        print(f"{product['asin']}: {status} - {detail}")

        checked_products.append(
            {**product, "status": status, "title": title}
        )

        if status == "unknown":
            continue

        next_state[product["asin"]] = status

    send_status_message(checked_products)
    print(f"Resumen enviado para {len(checked_products)} producto(s)")

    if next_state != previous_state:
        save_state(next_state)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
