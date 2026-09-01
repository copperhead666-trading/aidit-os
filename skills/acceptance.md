# acceptance (GIBRAN core skill)

Judges whether a delivered artifact meets the stated acceptance criteria; distinguishes
"works" from "meets spec."

How this org actually runs it:
- Read the acceptance criteria AHMAD put in the task packet, then read the delivered artifact
  against them criterion by criterion. A green `node *.regression.test.mjs` run proves "works";
  it does not by itself prove "meets spec".
- Flag honest non-claims as acceptable when true (e.g. cockpit quota section reporting "not
  available — no metering data source" was judged the only sound answer; a fabricated estimate
  would carry false authority). Honesty about gaps is a plus, not a minus.
- Flag scope creep and silent scope changes against the packet. Note residual gaps explicitly
  as P0/P1/non-blocking rather than hiding them.
- A "PASS WITH NOTES" verdict is legitimate when the artifact meets spec but carries a known
  residual gap that is explicitly documented and non-blocking.