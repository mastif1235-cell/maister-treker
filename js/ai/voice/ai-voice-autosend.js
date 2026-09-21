/* AI voice (v91.60): auto-send after dictation — OPTIONAL, OFF by default.

   Default behaviour is untouched: 🎤 → text lands in the textarea → the
   master taps Send. With «Автовідправка після голосового вводу» ON, a FINAL
   recognition result starts a short (1.2 s) window during which the text is
   already visible; when the window ends the question goes through the very
   same chat.send() pipeline as a manual tap. The window is cancelled by any
   edit of the textarea, a manual Send, a cleared chat, a recognition error or
   an explicit stop — so a question is never sent twice and never sent from an
   interim/empty/errored result. The indication is a single quiet status line
   (no countdown, no modal).

   The module knows nothing about recognition itself: js/ai/ai-voice.js stays
   as it is; ai-ui.js only forwards its existing onResult/onError callbacks and
   the few UI events listed above. */
(function(){
'use strict';
const MTAI = (typeof globalThis !== 'undefined' ? globalThis : window).MTAI;
if(!MTAI) return;

const DEFAULT_DELAY_MS = 1200;

/* deps: {
     isEnabled(): boolean               — reads the device-local setting,
     getText(): string                  — current textarea value,
     send(text): void                   — the existing manual-send path,
     onStatus(text|null): void          — quiet indication (optional),
     delayMs: number                    — optional (tests),
     setTimeout/clearTimeout            — optional (tests)
   } */
MTAI.createVoiceAutoSend = function(deps){
  deps = deps || {};
  const isEnabled = typeof deps.isEnabled === 'function' ? deps.isEnabled : function(){ return false; };
  const getText = typeof deps.getText === 'function' ? deps.getText : function(){ return ''; };
  const send = typeof deps.send === 'function' ? deps.send : function(){};
  const onStatus = typeof deps.onStatus === 'function' ? deps.onStatus : function(){};
  const delayMs = Number(deps.delayMs) > 0 ? Number(deps.delayMs) : DEFAULT_DELAY_MS;
  const setT = deps.setTimeout || setTimeout;
  const clearT = deps.clearTimeout || clearTimeout;

  let timer = null;
  let armedText = '';

  function cancel(reason){
    if(timer !== null){
      clearT(timer);
      timer = null;
      armedText = '';
      if(reason !== 'sent') onStatus(null);
    }
  }

  /* Called with the FINAL recognised phrase (ai-voice.js emits only finals). */
  function onFinalResult(text){
    if(!isEnabled()) return false;
    const phrase = String(text == null ? '' : text).trim();
    if(!phrase) return false;
    cancel('rearm');
    /* the textarea already shows the text; remember what we are about to send */
    armedText = String(getText() || '').trim() || phrase;
    const snapshot = armedText;
    onStatus('🎤 Надсилаю за мить… (редагування або ➤ скасовує автовідправку)');
    timer = setT(function(){
      timer = null;
      const current = String(getText() || '').trim();
      armedText = '';
      onStatus(null);
      /* the master edited the text in the meantime → the edit wins, no send */
      if(!current || current !== snapshot) return;
      send(current);
    }, delayMs);
    return true;
  }

  return {
    onFinalResult: onFinalResult,
    /* any user edit of the textarea */
    onUserEdit: function(){ cancel('edit'); },
    /* manual Send tap / Enter — the manual path sends, we step aside */
    onManualSend: function(){ cancel('sent'); },
    onError: function(){ cancel('error'); },
    onStop: function(){ cancel('stop'); },
    onCleared: function(){ cancel('cleared'); },
    isPending: function(){ return timer !== null; },
    cancel: function(){ cancel('cancel'); }
  };
};
})();
