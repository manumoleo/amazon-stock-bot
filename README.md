# Bot de avisos de Amazon y noticias

El Cloudflare Worker comprueba cada minuto la disponibilidad de este producto
de Amazon España:

- `B0F2T6WM33`

Solo envía un resumen al grupo de Telegram cuando el producto está disponible.
El resumen muestra el estado del mando.

Cada mañana a las 08:00, hora peninsular, también consulta titulares de las
últimas 24 horas relacionados con el Gobierno de España y la Administración
General del Estado. Workers AI selecciona hasta 12 noticias adversas concretas,
las clasifica y descarta resultados autonómicos, locales, extranjeros o de
opinión sin un hecho concreto. No se guarda un historial de noticias.

## Configuración

El servicio activo es `worker/src/index.js`, desplegado en Cloudflare Workers.
La programación está en `wrangler.jsonc` y el webhook se configura mediante
`.github/workflows/configure-telegram-webhook.yml`.

## Comprobación desde Telegram

El Cloudflare Worker de `worker/src/index.js` recibe el comando `/comprobar`
desde el grupo autorizado y consulta Amazon inmediatamente. Ignora los mensajes
de otros chats y valida la firma secreta del webhook de Telegram. El comando
siempre responde con el estado del mando, aunque no esté disponible.

El comando `/noticias` genera el resumen de noticias inmediatamente. La
selección se basa en los titulares de Bing News y no sustituye la lectura de
la fuente enlazada.

El Worker necesita estos secretos de Cloudflare:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_WEBHOOK_SECRET`

La tarea de GitHub Actions queda disponible para diagnósticos manuales, pero no
se ejecuta de forma programada porque Amazon bloquea las direcciones de GitHub.

Los secretos no deben escribirse en ningún archivo ni publicarse en mensajes.

## Obtener el identificador del grupo

Añade el bot al grupo y envía `/start` dentro del grupo. Después, desde esta
carpeta, ejecuta:

```zsh
read -s "TELEGRAM_BOT_TOKEN?Token nuevo: "
export TELEGRAM_BOT_TOKEN
python3 telegram_chat_id.py
unset TELEGRAM_BOT_TOKEN
```

El identificador de un grupo suele ser un número negativo. Guárdalo en GitHub
como `TELEGRAM_CHAT_ID` y en Cloudflare como secreto del mismo nombre.

## Pruebas

```zsh
python3 -m unittest -v
node --check worker/src/index.js
node --test worker/test/news.test.mjs
npx --yes wrangler@latest deploy --dry-run
```

Amazon puede cambiar su página o bloquear temporalmente las consultas
automáticas. En esos casos el mensaje indica que el producto no se pudo
comprobar. GitHub Actions queda solo como diagnóstico porque sus direcciones
recibían comprobaciones anti-bot de Amazon.
