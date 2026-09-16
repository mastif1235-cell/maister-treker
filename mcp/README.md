# Maister-Tracker MCP (READ-ONLY, stage E0+E1)

Отдельный remote **MCP server** (Cloudflare Worker) для «Майстер-Трекера».
Даёт совместимым MCP-клиентам безопасное чтение заявок/смен/отчётов.
**Stage scope: только READ.** `create_ticket`, `update_ticket`,
`request_delete_ticket`, PWA-bridge и audit-UI — следующие этапы.

## Принципы

- **Отдельный проект.** Основной PWA не изменяется (`app.js`, `index.html`,
  `sw.js` не тронуты); здесь нет общих зависимостей и общего рантайма.
- **Без копии данных.** Worker не хранит заявки. Каждый ответ строится из
  подписанного запроса к **существующему** Google Apps Script sync-контракту
  (`list`, `getTicketById`) — тому же, которым пользуется телефон.
  D1/KV/R2 не используются.
- **Read-only по построению.** Клиент подписывает GET с action из allowlist
  `['list','getTicketById']`; в коде нет ни одного POST и ни одной записи
  (доказано статическим тестом и перехватом транспорта в тестах).
- **Redaction layer.** Отдаётся строгий whitelist полей. Пароли, логины,
  приватные заметки мастера, все `tg*`-служебные поля, `syncHmacSecret`,
  токены и сырые колонки (`backupNote`, `fullDataJson`) гарантированно не
  выходят (тесты прогоняют все инструменты на adversarial-данных).
- **Детерминизм.** Одинаковые данные → байт-в-байт одинаковый ответ
  (без часов и случайности в выводе).

## Endpoint и транспорт

- `POST /mcp` — MCP endpoint: JSON-RPC 2.0 поверх Streamable HTTP,
  stateless-режим (spec **2026-07-28**): без handshake-сессий и
  `Mcp-Session-Id`. Для клиентов старых ревизий поддержан `initialize`
  (эхо поддержанной версии; список: 2026-07-28, 2025-11-25, 2025-06-18,
  2025-03-26) и `notifications/initialized` → `202 Empty`.
- `GET /mcp` → `405` (SSE-стрим для этого сервера не нужен).
- `GET /healthz` → `{ok:true}` (без auth, без данных).
- Ответы всегда `application/json`; `Cache-Control: no-store`.

## Аутентификация

- **Bearer token** (`Authorization: Bearer <token>`): статические scoped
  токены из секрета `MCP_BEARER_TOKENS` (формат `name:token:scope`,
  scope этого этапа — только `read`). Сравнение — константное время по
  SHA-256 дайджестам; сырые токены не логируются и не возвращаются.
  Отзыв доступа = удаление записи из секрета (`wrangler secret put`) —
  вступает в силу после redeploy.
- **Rate limiting**: скользящее окно на токен (по умолчанию 120 req/min,
  `MCP_RATE_LIMIT_PER_MIN`), превышение → `429` + `Retry-After`.
- **OAuth 2.1** (обязателен для custom connectors ChatGPT и нативен для
  Claude web) сознательно НЕ реализован на этом этапе: auth — одна
  подключаемая функция (`authenticate`), поэтому OAuth resource-server
  слой добавляется перед теми же tool-хендлерами без их изменения.
  Это и есть «заложенная возможность».

## Tools (реализовано, все `readOnlyHint:true`)

| Tool | Назначение |
|---|---|
| `list_tickets` | список с фильтрами `date_from`/`date_to`/`tags`, пагинация |
| `get_ticket` | одна заявка по id (`{found:true\|false, ticket}`) |
| `search_tickets` | поиск по тем же полям, что в приложении: content, дата, теги, город, адрес, клиент, сигнал ONU, цифры телефона (+доп. номера) |
| `get_tickets_by_date` | все заявки за дату (сортировка по времени — как в приложении) |
| `get_shifts` | смены за диапазон + `total_hours` |
| `get_reports` | поденные сводки {count, total, cashTotal, cardTotal} — та же арифметика, что отчёт приложения |
| `get_statistics` | периоды day/week/month/all от даты-якоря + разбивки по типу работ и оплате |

## Поля: что видит AI и что скрыто

**Видно (whitelist):** id, date, time, type, city, street, house, apartment,
address, clientName, phone, extraPhones, macAddress, signal, payment, sum,
cashAmount, cardAmount, callFee, tariff, tags, contractNumber, note,
abonentNote, otherNote, geoLink (только https), equipment/cables/presetWorks
(label+цены), additionalWork, cloudImported.

**Гарантированно скрыто (тестами на adversarial-данных):** `password`,
`login`, `masterNote` (приватная заметка мастера), все `tg*`-служебные поля
(tgPhotoFileIds, tgJsonMsgId, tgBackedUp, …), `syncHmacSecret`, любые
`*Token/*Secret` ключи, `scriptUrl`, сырые `backupNote` и `fullDataJson`,
`photo`. Неизвестные ключи в исходных данных отбрасываются whitelist'ом.

## Структура

```
mcp/
  src/index.js            Worker: маршруты, auth, rate limit, заголовки
  src/config.js           fail-closed парсинг env
  src/jsonrpc.js          JSON-RPC 2.0 (batching отключён спецификацией)
  src/ratelimit.js        sliding window per token
  src/mcp/server.js       initialize/ping/tools.list/tools.call
  src/tools/definitions.js JSON Schema 2020-12, annotations readOnlyHint
  src/tools/validate.js   мини-валидатор схем (fail closed)
  src/tools/read.js       реализации 7 READ tools + агрегаты отчётов
  src/gas/sync-contract.js порт MT-SYNC-HMAC-V3 (байт-паритет с приложением)
  src/gas/client.js       подписанные GET (allowlist actions), кэш list, таймауты
  src/gas/mappers.js      парсер строк GAS + redaction whitelist
  src/auth/bearer.js      токены: константное сравнение, scope
  wrangler.example.toml   пример конфигурации (секреты — только wrangler secret)
  scripts/check.sh        node --check всех файлов
  test/                   unit + integration + security + parity (node:test)
```

## Тесты

```
cd mcp
npm test    # 62 теста: unit, интеграция, security-negative, паритет
npm run check
```

Паритет с приложением доказывается загрузкой **настоящих** модулей
приложения (`js/report-utils.js`, `js/ticket-form-domain.js`) в vm-песочницу
и сравнением результатов на общих фикстурах; HMAC-каноника сверяется с
общими векторами репозитория `tests/fixtures/sync-contract-v3-vectors.json`.
Мутационные проверки (дырка в whitelist, write-action в allowlist, «принять
любой токен», сырой fullData в ответе, nondeterminism) — каждая ловится.

## Локальное/тестовое подключение MCP-клиента

1. Собрать env (пример для локальной отладки):
   ```bash
   export GAS_SYNC_URL="https://script.google.com/macros/s/<DEPLOYMENT>/exec"
   export GAS_SYNC_HMAC_SECRET="<тот же секрет, что в vault PWA, >=32 символов>"
   export MCP_BEARER_TOKENS="test-cli:mt_test_cli_0123456789abcdef0123456789abcdef:read"
   npx wrangler dev mcp   # или wrangler dev внутри mcp/
   ```
2. Проверить curl'ом:
   ```bash
   curl -s http://localhost:8787/healthz
   curl -s http://localhost:8787/mcp \
     -H "Authorization: Bearer mt_test_cli_0123456789abcdef0123456789abcdef" \
     -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
   ```
3. Подключить клиент:
   - **MCP Inspector**: `npx @modelcontextprotocol/inspector` → Transport
     *Streamable HTTP*, URL `http://localhost:8787/mcp`, header
     `Authorization: Bearer <token>`.
   - **Cursor / VS Code / Cline / Gemini CLI**: remote URL `http://…/mcp`
     с header `Authorization: Bearer <token>` (все поддерживают header-auth).
   - **ChatGPT custom connector** на этом этапе не подключится осознанно:
     ему нужен OAuth 2.1 — следующий этап auth-слоя.
4. Ожидание по датам: везде ДД.ММ.РРРР (формат приложения).

## Важно про секреты

`GAS_SYNC_URL`, `GAS_SYNC_HMAC_SECRET`, `MCP_BEARER_TOKENS` — только
`wrangler secret put` / env. Ничего из этого нет в коде, D1 и ответах.
HMAC-секрет тот же, что использует PWA (контракт GAS один); ротация — через
vault PWA + `wrangler secret put`.

## Stage A + D (экспериментальные, ветка feat/ai-groq-orchestrator): KV snapshot + /ask

- **KV snapshot cache (необязательно):** binding `MT_SNAPSHOT_KV` хранит ТОЛЬКО
  редактированную (whitelist) проекцию данных под версионируемым ключом
  `mt:snapshot:v1`; свежесть ~5 мин (`MCP_SNAPSHOT_TTL_MS`), stale-while-revalidate,
  при сбое GAS отдаётся последняя рабочая копия. Нет binding'а — сервер работает
  как раньше (transparent passthrough). Cron `*/5 * * * *` (опционально) держит
  снапшот тёплым (`scheduled()`).
- **POST /ask:** AI-оркестратор. Groq (`openai/gpt-oss-120b`, ключ — только
  Workers Secret `GROQ_API_KEY`) ТОЛЬКО reasoning и выбирает tool; Worker сам
  выполняет те же READ-хендлеры (без self-HTTP к /mcp) и возвращает финальный
  ответ. Защиты: allowlist 7 READ tools, JSON-Schema валидация аргументов,
  лимиты (tool calls ≤8, rounds ≤12, размер результата/ответа), redaction,
  rate limit. Auth: `ASK_BEARER_TOKENS` (тот же формат токенов) или, при
  отсутствии, обычные MCP-токены.
- Ни один из существующих эндпоинтов/токенов/инструментов не менялся.

## Дорожная карта следующих этапов

- **E2**: `create_ticket`/`update_ticket` (optimistic concurrency через
  серверные revision, `client_request_id` идемпотентность), vendored
  `finance-utils` для расчёта суммы/текста.
- **E3**: `request_delete_ticket` + PWA-bridge + подтверждение в приложении.
- **E4**: «Дії AI / MCP» (audit UI) + D1 audit log + OAuth 2.1 layer
  (PKCE, Protected Resource Metadata) для ChatGPT/Claude web.
