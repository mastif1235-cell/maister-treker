/* Deterministic presentation fixes for the /ask answer text (v91.45).
   The model is instructed to number lists 1, 2, 3… but on real devices it
   sometimes repeats the same marker («1. … 1. … 1. …»). We never trust the
   LLM alone: a pure post-processor renumbers any consecutive run of list
   items whose markers are broken (do not form the 1..N sequence). Correct
   sequences, single items and non-list text pass through untouched. No
   technical ids are ever introduced — numbering is plain 1..N. */

const ITEM_RE = /^(\s*)(\d{1,4})([.)])\s+(.*)$/;

export function renumberSequentialLists(text){
  const lines = String(text == null ? '' : text).split('\n');
  let run = [];
  const flush = function(){
    if(run.length >= 2){
      const expected = run.map(function(_, i){ return i + 1; });
      const broken = run.some(function(lineIdx, i){
        const m = ITEM_RE.exec(lines[lineIdx]);
        return Number(m[2]) !== expected[i];
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
    else flush();
  }
  flush();
  return lines.join('\n');
}
