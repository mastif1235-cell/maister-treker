# September-only ONU completion

Production v20 has applied the original eleven overlays. Do not replay them.
This extension adds exactly twenty primary-sheet September connection IDs to
the SAME supported map. Without the extension, v20 refuses these IDs; adding
them only in a transient editor invocation is unsafe because later renders
would reject the saved overlays. Install the extended bundle in the existing
deployment before running the new owner functions. No PWA release is involved.

Existing primary CSV: 62 September records, twenty connections, each canonical
JSON legacy/no ownership evidence, one active report match, raw onu_used=0.
That is preliminary evidence, not fresh authorization to overwrite rows.
`ONUSeptemberSource_` refreshes ONLY primary Заявки in the named spreadsheet,
requires the exact twenty-ID set, reads canonical JSON (including the known
blank-heading H layout), and applies production modern/legacy semantics.
Any changed ownership/modern OFF/schema/missing/duplicate stops before apply.
Archive is never opened. Price/MAC/unchecked legacy are not ownership evidence.

Requires the already installed ONU_Correction_Helper.gs. Keep it unchanged.
Replace ONLY Код.gs with the generated bundle; preserve Без назви.gs, all
owner helper files and the production manifest. Do NOT use the generic manifest
emitted by the builder. Update the existing deployment to a new GAS version,
preserving its ID, URL, execute-as-owner and access settings. No setup or sync.
Saving editor HEAD alone is insufficient: old deployed renders lack the new IDs.

Run ONU_September_ApplyNext. At most one signed supported apply/render per run.
Under the script lock it refreshes all twenty source decisions/previews, checks
current September controls (20 connections, repair ONU 8, total 46115) and
October (7/5/20186), then selects one unapplied September-only ID. Original
eleven entries are not selected. Only work_type/work_category/onu_used overlay;
raw DTO, replacement, finance, material fields and receipts are unchanged.

Before apply: full private row snapshot in existing ONU20-prefixed Script
Properties, exact request and hashes saved under ONU-SEP26-CONTROL-V1.
After apply: raw/receipt fingerprints, primary evidence, September money and
full October stats unchanged; actual daily/weekly/monthly cells compared with
core output. Logs contain IDs/counts/money only, not source JSON/notes/MAC/key.

Only after ok:true/ONE_SEPTEMBER_APPLIED run ApplyNext again. Twenty successful
runs at most; next invocation is ALL_SEPTEMBER_APPLIED without a new write.
Final ONU_September_VerifyReadOnly checks real cells and reports actual counts.
Reference 20+8 and 7+5 are comparisons/guards, never injected output values.

Any error/timeout stops normal progression. ResumePending reuses the exact
saved request for one interrupted render, never a new ID. Repeat failures or
source conflicts require stopping. Hard GAS execution limit cannot be extended;
one render per run and durable pending state prevent uncontrolled batch renders.
Existing rate limit remains active (RATE_LIMITED: wait for the next minute
before one ResumePending, never clear the cache).

RollbackLast removes ONE latest active September overlay from this helper,
using the existing signed rollback, preserving current raw money and all prior
eleven overlays. Repeat to undo the September series if necessary. Resume an
interrupted rollback with ResumePending. Do NOT roll deployment back to v20
while any September overlay remains: old code would reject these IDs. First
rollback September overlays, read-back/verify, then switch existing deployment
back to version 20 if needed. Never restore full DTOs from stale snapshots.

Local tests: existing eleven correction scenarios, forty-two GAS security/CRUD
checks, ONU two-line presentation check and eleven September owner scenarios.
The September fixture verifies actual mocked cells: 20+8/46115 and unchanged
7+5/20186; preserves original correction, supports full reverse rollback,
interrupted render idempotency, source conflict, pending receipts and modern OFF.
Live publication and verification remain separate; local PASS is not live PASS.
