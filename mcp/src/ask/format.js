/* Deterministic presentation fixes for the /ask answer text (v91.45+,
   hardened in v91.46/v91.47).
   The model is instructed to number lists 1, 2, 3… but on real devices it
   repeats the same marker and, with DeepSeek, produces markdown-style
   output where items are separated by BLANK LINES and each item spans
   SEVERAL lines (indented continuations / dash lines):

     1. **15.09.2026, 12:30** — Вул Садова 19
        — ремонт, безкоштовно

     1. **19.08.2026, 14:41** — Вул Генерала Пушкіна 55
        — ремонт, 300 грн

   That is ONE logical list and must become 1, 2, 3. Rules:
   - a run of list items is NOT broken by blank lines;
   - a run is NOT broken by item continuation lines: indented lines and
     lines starting with a dash/bullet/em-dash marker;
   - any OTHER non-blank line (text, headers, bullets-of-another-kind are
     still plain text here) splits runs — two genuinely separate lists stay
     separate;
   - a run is renumbered to 1..N iff its markers do not already form the
     exact 1..N sequence; correct sequences pass through untouched.
   No technical ids are ever introduced — numbering is plain 1..N. Dates,
   sums, house numbers and ordinary numbers never match the item pattern
   because it requires whitespace right after the marker. */

const ITEM_RE = /^(\s*)(\d{1,4})([.)])\s+(.*)$/;
const BLANK_RE = /^\s*$/;
/* Continuation of a multi-line item: an indented line or a line starting
   with a dash/em-dash/bullet marker. Such lines never carry their own
   numbering, so they only keep the current run open. */
const CONTINUATION_RE = /^(?:\s+\S|[\s]*(?:—|–|-|•|·)\s*\S)/;

export function renumberSequentialLists(text){
  const lines = String(text == null ? '' : text).split('\n');
  let run = [];
  const flush = function(){
    if(run.length >= 2){
      const broken = run.some(function(lineIdx, i){
        const m = ITEM_RE.exec(lines[lineIdx]);
        return Number(m[2]) !== i + 1;
      });
      if(broken){
        run.forEach(function(lineIdx, i){
          const m = ITEM_RE.exec(lines[lineIdx]);
          lines[lineIdx] = m[1] + (i + 1) + m[3] + ' ' + m[4];
        });
      }
    }
    run = [];
  };
  for(let i = 0; i < lines.length; i++){
    if(ITEM_RE.test(lines[i])) run.push(i);
    else if(BLANK_RE.test(lines[i])) continue;          /* blank: same logical list */
    else if(run.length && CONTINUATION_RE.test(lines[i])) continue; /* multi-line item */
    else flush();                                       /* real content: separate lists */
  }
  flush();
  return lines.join('\n');
}
