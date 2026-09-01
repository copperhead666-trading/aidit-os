# structural-analysis (GRAPHIFY-ANALYST core skill)

Answers structural and multi-hop code questions from current repo state; does not modify code.

How this org actually runs it:
- Answer from the actual current repo (this workspace's ops-watcher/, config/, handoffs/,
  hatta/), not from memory of a prior session. Re-read the files for the question at hand.
- Multi-hop questions (e.g. "which runner writes the OWNER_REQUIRED guard and which file reads
  it") require tracing real call paths across files, citing each hop with a file:line reference.
- graphify-out/ holds generated structural graphs (graph.json, GRAPH_REPORT.md) — read them as
  a secondary structural view, but the source code is the ground truth if they diverge.
- Never modify code. You answer; HATTA implements any change your analysis suggests.