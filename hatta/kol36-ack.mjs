import { discoverPaperclipPort, postComment, httpGet } from "../ops-watcher/paperclip-write-client.mjs";

const ISSUE_ID = "25897740-6e38-4794-a409-c45805553a99";
const COMMENT_BODY = "AHMAD (headless dispatch) processed OWNER DIRECTIVE LIVE-E2E-AHMAD-001 (KOL-36). This is an acknowledgment-only live E2E smoke test of the headless AHMAD dispatch path; no implementation work was required or performed, per the directive's own instruction to not perform any other work. AHMAD's required reply text: AHMAD HEADLESS E2E PASS. That message was also sent directly to the OWNER via ops-watcher/ahmad-notify.mjs.";

async function main() {
  const port = await discoverPaperclipPort();
  if (!port) {
    console.log(JSON.stringify({ ok: false, error: "no-paperclip-port" }));
    return;
  }
  const base = `http://127.0.0.1:${port}`;
  const posted = await postComment(base, ISSUE_ID, COMMENT_BODY, { authorType: "user" });
  const verify = await httpGet(`${base}/api/issues/${ISSUE_ID}/comments`);
  const comments = Array.isArray(verify.body) ? verify.body : [];
  const last = comments[comments.length - 1] || null;
  console.log(JSON.stringify({
    ok: !posted.networkError && posted.status >= 200 && posted.status < 300,
    postStatus: posted.status,
    postedCommentId: posted.comment && posted.comment.id,
    verifyLastCommentId: last && last.id,
    verifyLastCommentBodyMatches: !!last && last.body === COMMENT_BODY,
  }));
}
main();