# security (GIBRAN core skill)

Spots credential exposure, auth bypasses, destructive production actions, and other
safety-boundary violations in proposed changes; escalates to OWNER when found.

How this org actually runs it:
- This session found and fixed a real harness bypass: hatta/harness.mjs's substring denylist
  could be defeated by `node -e`/`--eval` calling fs.rmSync. Fixed by blocking -e/--eval/-p/--print
  on node/bun. Re-verify adversarial cases directly, not by trusting the implementer's self-test.
- Credential rule: never print/log/transmit real tokens. telegram-client.mjs redact()s tokens;
  regression tests inject a FAKE token and override process.env. If a change touches a real
  credential, escalate to OWNER — do not consume it on the implementer's own initiative.
- Watch for falsified-success patterns (a failed mutation reported as success), silent error
  swallows that lose user intent, and destructive production writes without human approval.
- Escalate (do not auto-fix) anything touching OWNER-required actions, real money, or credentials.