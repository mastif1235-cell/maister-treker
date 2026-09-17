/* AI: write-наміри над фото — ТІЛЬКИ заготовки, усі вимкнені. Схему
   наявного photo storage НЕ змінюємо. Майбутні сценарії («додати фото
   муфти до заявки №123») виконуватимуться ТІЛЬКИ після явного
   підтвердження через ai-actions.execute + окремий backend permission. */
(function(){
'use strict';
const MTAI = (typeof globalThis !== 'undefined' ? globalThis : window).MTAI;
MTAI.actions.register({ id:'photo.attach', kind:'write', label:'Додати фото до заявки', confirmText:'Додати це фото до заявки?' });
MTAI.actions.register({ id:'photo.delete', kind:'write', label:'Видалити фото', confirmText:'Видалити фото?' });
MTAI.actions.register({ id:'photo.list', kind:'read', enabled:false, label:'Показати фото заявки' }); // потребує READ tool фото (майбутнє)
})();
