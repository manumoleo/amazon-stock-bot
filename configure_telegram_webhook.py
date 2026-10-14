#!/usr/bin/env python3

import json
import os
import sys
import urllib.error
import urllib.request


def main():
    if len(sys.argv) != 2:
        raise RuntimeError("Uso: configure_telegram_webhook.py URL_DEL_WORKER")

    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN")
    webhook_secret = os.environ.get("TELEGRAM_WEBHOOK_SECRET")
    if not bot_token or not webhook_secret:
        raise RuntimeError(
            "Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_WEBHOOK_SECRET"
        )

    webhook_url = f"{sys.argv[1].rstrip('/')}/telegram"
    payload = json.dumps(
        {
            "url": webhook_url,
            "secret_token": webhook_secret,
            "allowed_updates": ["message"],
            "drop_pending_updates": True,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{bot_token}/setWebhook",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Telegram ha rechazado el webhook: {details}") from error

    if not result.get("ok"):
        raise RuntimeError(f"Telegram ha rechazado el webhook: {result}")

    print(f"Webhook configurado: {webhook_url}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
