import { discoverPaperclipPort, httpGet } from "../ops-watcher/paperclip-write-client.mjs";

const ISSUE_ID = "25897740-6e38-4794-a409-c45805553a99";
const TARGET_COMMENT_ID = "0f738b4a-95ce-45d0-9291-849d650aba59";

async function main() {
  const port = await discoverPaperclipPort();
  if (!port) {
    console.log(JSON.stringify({ ok: false, error: "no-paperclip-port" }));
    return;
  }
  const base = `http://127.0.0.1:${port}`;
  const res = await httpGet(`${base}/api/issues/${ISSUE_ID}/comments`);
  const comments = Array.isArray(res.body) ? res.body : [];
  const found = comments.find((c) => c.id === TARGET_COMMENT_ID);
  console.log(JSON.stringify({
    ok: !res.networkError,
    totalComments: comments.length,
    found: !!found,
    foundBody: found ? found.body : null,
    foundCreatedAt: found ? found.createdAt : null,
    allCommentIdsInOrder: comments.map((c) => ({ id: c.id, createdAt: c.createdAt })),
  }));
}
main();