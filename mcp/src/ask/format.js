/* Deterministic presentation fixes for the /ask answer text (v91.45+,
   hardened in v91.46).
   The model is instructed to number lists 1, 2, 3… but on real devices it
   often repeats the same marker («1. … 1. … 1. …») and, with DeepSeek,
   separates list items with BLANK LINES (markdown style):

     1. **A**

     1. **B**

     1. **C**

   That is ONE logical list and must become 1, 2, 3 — so a run of list
   items is NOT broken by blank lines. Only real content between items
   (any non-blank line that is not itself a list item — headers, text,
   bullets) splits runs, which keeps two genuinely separate lists apart.
   A run is renumbered to 1..N iff its markers do not already form the
   exact 1..N sequence; correct sequences pass through untouched. No
   technical ids are ever introduced — numbering is plain 1..N. Dates,
   sums, house numbers and ordinary numbers never match the item pattern
   because it requires whitespace right after the marker. */

const ITEM_RE = /^(\s*)(\d{1,4})([.)])\s+(.*)$/;
const BLANK_RE = /^\s*$/;

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
    else if(BLANK_RE.test(lines[i])) continue; /* blank line: one logical list */
    else flush();                               /* real content: separate lists */
  }
  flush();
  return lines.join('\n');
}
