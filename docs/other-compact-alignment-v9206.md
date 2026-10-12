# Shared compact action slots / report deployment follow-up

Candidate: v92.06 / runtime-151 / maister-treker-v81-runtime-151.
Base: 934bf3fe7506ee88dcb6ef3f76dc37e6a370732b.

Compact CSS previously relied on four children being auto-placed in a two-column
grid: meta/sum on row 1, address/action on row 2. `Інше` correctly omits the sum,
so auto-placement incorrectly moved its note and action to different cells.
All types now explicitly share those existing grid cells. No special note layout,
placeholder sum, absolute positioning, markup, photo or delivery changes.

Responsive regressions compare connection, repair and three note lengths at
320/360/390/430px, check no overlap/overflow and identical button dimensions,
padding/alignment, and compare ordinary-card geometry against previous CSS
auto-placement. Existing full-mode, one-collapse-control and photo tests remain.

The no-money report behavior is already merged in the shared core. Production
GAS v16 did not receive that core during PR #92's frontend-only release. The new
bundle regression executes the actual deployable bundle's renderer and checks
note title/text with no generated financial lines; normal tickets retain exactly
one total. Neither GAS source nor material/transport/schema logic changes here.

After review approval only: merge exact approved HEAD, verify post-merge CI/Pages,
update the existing Dispatcher deployment to immutable version 17 using the
generated bundle, preserving URL, Me/Anyone, properties, secret and privacy.
Perform signed status and unsigned rejection smoke, snapshot counts/ID hash,
then one report rebuild and compare the snapshot. No retry/reconcile/full sync
or old-queue operations. No deployment/rebuild is authorized in the review phase.
