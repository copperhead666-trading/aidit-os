// ops-watcher/alert-delivery.mjs
// One judge for "did the owner's alert actually go out?".
//
// Every alert sender in this repo reports failure by RETURN VALUE, not by
// throwing. `defaultPostAlert` catches its own spawn failure and returns
// `{ pid: null, error }`; `telegram-client.sendMessage` returns
// `{ sent: false, ok: false, reason }` when there is no token or the API
// refuses. A `try { postAlert(m) } catch {}` therefore catches nothing, and the
// caller that follows it with `alerted = true` has just claimed a delivery it
// never checked.
//
// That claim is worse than a lost message on its own, because each of these
// callers writes a cooldown timestamp right after it. A failed alert marked as
// sent suppresses every retry for the length of the cooldown, so the first
// failure silences the channel instead of repeating on it. This is the same
// shape as the label bug that left KOL-68 with an escalation comment and no
// OWNER_REQUIRED label: success was assumed from a result nobody read.
//
// Rule: only a result that positively reports delivery counts as delivered.
// Anything else — an error field, a false `sent`/`ok`, a null pid, a thrown
// exception, or no result at all — is a failure with a stated reason.

// Judge one alert result. Never throws.
export function judgeAlertDelivery(result) {
  if (result === null || result === undefined) {
    return { delivered: false, reason: "alert sender returned nothing" };
  }
  if (typeof result !== "object") {
    return { delivered: false, reason: `alert sender returned ${typeof result}` };
  }
  // An explicit error always wins, even alongside a pid or a truthy sent flag.
  if (result.error) {
    return { delivered: false, reason: String(result.error) };
  }
  // Telegram-shaped result: sendMessage reports { sent, ok, reason }.
  if (result.sent === false || result.ok === false) {
    return { delivered: false, reason: String(result.reason || "alert sender reported failure") };
  }
  if (result.sent === true || result.ok === true) {
    return { delivered: true, reason: null, pid: result.pid ?? null };
  }
  // Spawn-shaped result: defaultPostAlert reports { pid } on success.
  if ("pid" in result) {
    if (result.pid === null || result.pid === undefined) {
      return { delivered: false, reason: "alert process did not start (no pid)" };
    }
    return { delivered: true, reason: null, pid: result.pid };
  }
  // A shape nobody recognises is not evidence of delivery.
  return { delivered: false, reason: "alert sender returned an unrecognised result" };
}

// Run an alert sender and judge it in one step. Accepts sync or async senders,
// and converts a throw into the same verdict shape so no caller needs its own
// try/catch to stay honest.
export async function deliverAlert(send) {
  let result;
  try {
    result = await send();
  } catch (err) {
    return { delivered: false, reason: String((err && err.message) || err) };
  }
  return judgeAlertDelivery(result);
}
