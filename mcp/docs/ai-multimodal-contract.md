# AI backend roadmap: provider/model selection, vision, WRITE tools

Статус: ПРЕДЛОЖЕННЫЙ контракт (не реализован на Worker'е). Frontend уже
готов архитектурно: PWA всегда общается ТОЛЬКО с нашим Worker'ом, ключи
провайдеров никогда не покидают сервер.

## 1. Provider/model выбор (этап 1 — без vision)

Сейчас `/ask` использует фиксированный `ASK_MODEL` (env). Минимальное
расширение — опциональные поля запроса c allowlist на Worker:

```json
POST /ask
{
  "question": "Скільки заявок за тиждень?",
  "provider": "groq",                      // optional, default "groq"
  "model": "openai/gpt-oss-120b"           // optional, default ASK_MODEL
}
```

Правила безопасности (обязательные):
- `provider` и `model` проверяются по allowlist НА WORKER'е (константа в
  коде или env-маппинг `provider -> [models]`); неизвестная пара →
  `400 invalid_model`. Никаких произвольных URL.
- API key клиента не принимается никогда; upstream ключи — только
  Workers Secrets (`GROQ_API_KEY`, в будущем `DEEPSEEK_API_KEY`).
- Ответ и лимиты не меняются; rate limit общий на клиента.
- Реализация на Groq: только замена `model` в chat/completions
  (openai-совместимый формат одинаков) — ~10 строк + конфиг.

## 2. Vision (этап 2 — изображения в /ask)

Groq openai-совместимый API принимает в `messages[].content` массив частей
`{type:'image_url', image_url:{url:'data:image/jpeg;base64,…'}}` только для
vision-моделей. Предлагаемый контракт:

```json
POST /ask
{
  "question": "Что на фото муфты?",
  "model": "<vision-model-id>",
  "images": [ { "kind": "coupler", "dataUrl": "data:image/jpeg;base64,…" } ]
}
```

Ограничения на Worker'е: `images` ≤ 4, каждая ≤ ~300 KB base64 (после
клиентского даунскейла до 1024 px это выполняется), только `data:image/`;
allowlist моделей с capability vision; повышение лимита тела (сейчас
32 KiB → ~1 MiB) и отдельный rate limit (vision дороже по TPM).
PWA уже шлёт `dataUrl` уменьшенного JPEG — менять frontend не придётся.

## 3. WRITE tools (этап 3 — отдельное разрешение владельца)

Backend: отдельный набор WRITE tools (ticket.create/update/delete,
photo.attach …) ПОКА НЕ ВКЛЮЧАЕТСЯ. Когда будет разрешено:

- токены: новый scope `write` в `MCP_BEARER_TOKENS` (сейчас парсер
  принимает только `read`) — WRITE доступен только токенам со scope write;
- каждый WRITE tool на Worker'е требует явного `confirm: true` в запросе
  tool-call'а от модели, а модель делает его только после явного
  подтверждения пользователя в PWA (кнопка «Добавить» в диалоге);
- подтверждение в UI: `js/ai/actions/ai-actions.js execute()` уже
  реализует двойной гард (write_disabled сейчас + обязательный confirm
  потом); `ticket-actions.js` / `photo-actions.js` — заготовки с
  enabled:false;
- аудит: лог действий (кто/что/когда) в консоль Worker'а без секретов.

## 4. «Добавить фото в заявку №123» (этап 4)

Требует: (2) vision + (3) photo.attach WRITE + существующий механизм фото
заявки в PWA (IndexedDB photo storage, НЕ меняем). Сценарий: AI отвечает
карточкой найденной заявки → PWA показывает «Добавить это фото?» → после
нажатия photo.attach вызывает ЛОКАЛЬНЫЙ (не AI) путь добавления фото в
заявку. AI никогда не пишет в Sheets напрямую — всё через существующий
sync-контракт приложения.

## 0. GET /ai/config (реализовано)

Публичный (без auth) endpoint возможностей бекенда. Возвращает ТОЛЬКО:
`{ok, mode:'read-only', auth_required:true, ask_configured, version,
providers:[{id,name,enabled,models:[{id,capabilities[]}]}]}`.
Никогда: ключи, токены, upstream URL, HMAC. CORS: `/healthz`, `/ai/config`,
`/ask` (вкл. OPTIONS-preflight) отдают ACAO `*` — PWA в браузере может
звать их с GitHub Pages; `/mcp` остаётся без CORS (нативные MCP-клиенты).

## 5. Выдача персональных токенов (общий backend)

`ASK_BEARER_TOKENS` / `MCP_BEARER_TOKENS` — список записей
`name:token:scope` через `;`. Каждому пользователю — СВОЯ запись:

- выдать: `npx.cmd wrangler secret put ASK_BEARER_TOKENS` (все записи,
  включая новые; value в чат/лог не отправлять);
- отозвать: та же команда без записи пользователя (остальные продолжают
  работать — парсер независим по записям);
- `name` идентифицирует клиента в rate limit (`ask:<name>`) — на одного
  пользователя лимит не влияет на других;
- scope остаётся `read` (WRITE не выдаётся).

Новый пользователь без записи токена доступа не имеет; владелец может
вообще не публиковать URL — даже зная URL, без токена `/ask` → 401.
