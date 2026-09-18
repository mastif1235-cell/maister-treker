/* AI: write-наміри над заявками — ТІЛЬКИ заготовки, усі вимкнені.
   Коли backend отримає WRITE tools, кожна дія тут отримає:
   1) окремий backend permission/tool, 2) явний confirm-текст,
   3) виконання через execute() з подвійним гардованням. */
(function(){
'use strict';
const MTAI = (typeof globalThis !== 'undefined' ? globalThis : window).MTAI;
MTAI.actions.register({ id:'ticket.create', kind:'write', label:'Створити заявку', confirmText:'Створити нову заявку?' });
MTAI.actions.register({ id:'ticket.update', kind:'write', label:'Змінити заявку', confirmText:'Застосувати зміни до заявки?' });
MTAI.actions.register({ id:'ticket.delete', kind:'write', label:'Видалити заявку', confirmText:'Видалити заявку? Дію не можна скасувати.' });
MTAI.actions.register({ id:'ticket.open', kind:'read', enabled:true, label:'Відкрити профіль',
  run: function(args){ return { ok: MTAI.actions.openTicket(args && args.id) }; } });
MTAI.actions.register({ id:'ticket.map', kind:'read', enabled:true, label:'Показати на карті',
  run: function(args){ return { ok: MTAI.actions.showOnMap(args && args.id) }; } });
})();
