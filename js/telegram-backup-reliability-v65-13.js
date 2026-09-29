/* Майстер-Трекер — Telegram backup reliability v65.0-security.13
   Якщо sendPhoto падає саме мережевою помилкою, старий backupTicketToTelegramNow
   раніше виходив з усього блоку ДО відправки ticket-*.json. Тут робимо вузький
   транспортний hotfix: Telegram sendPhoto отримує до 3 спроб, а після повного
   мережевого провалу повертаємо контрольовану Telegram-помилку замість throw.
   Тоді штатний код продовжує цикл, доходить до JSON-бекапу і НЕ видаляє стару
   повну копію, бо photosOk лишається false.
*/


// Non-idempotent sendPhoto/sendMessage/sendDocument are intentionally not
// retried here: a lost response can mean that Telegram accepted the message.
// The canonical backup lifecycle records that state as ambiguous instead of
// blindly creating a duplicate.
