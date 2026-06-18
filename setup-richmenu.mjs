// ==============================================
// WAFERLOCK 可切換圖文選單（Rich Menu 分頁）設定腳本
// 建立兩個分頁：會員服務 / 其他服務，點上方分頁列即可切換。
//
// 需要：
//   1. Node 18+（內建 fetch）
//   2. 兩張底圖放同目錄：richmenu-member.png、richmenu-other.png
//      尺寸 2500 x 1686、PNG/JPEG、< 1MB。分頁列「畫在圖上」，座標見下方 areas。
//   3. 環境變數 LINE_CHANNEL_ACCESS_TOKEN（Messaging API 的 long-lived token）
//
// 執行：
//   set LINE_CHANNEL_ACCESS_TOKEN=xxxx   (Windows CMD)
//   node setup-richmenu.mjs
// ==============================================
import { readFileSync } from "node:fs";

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!TOKEN) { console.error("缺少 LINE_CHANNEL_ACCESS_TOKEN"); process.exit(1); }
const H = { Authorization: `Bearer ${TOKEN}` };
const LIFF = (p) => `https://liff.line.me/2010432600-XRCwdf5J?p=${p}`;

// 版面：2500x1686。上方分頁列高 250（兩格各 1250）；下方內容三欄各約 833 寬、高 1436。
const tabRow = (selfAlias, otherAlias, otherData) => ([
  { bounds: { x: 0,   y: 0, width: 600, height: 120 },
    action: { type: "richmenuswitch", richMenuAliasId: selfAlias, data: "tab=self" } },
  { bounds: { x: 600, y: 0, width: 600, height: 120 },
    action: { type: "richmenuswitch", richMenuAliasId: otherAlias, data: otherData } },
]);
const col = (i) => ({ x: i * 400, y: 120, width: 400, height: 690 });

const menuMember = {
  size: { width: 1200, height: 810 },
  selected: true,
  name: "WAFERLOCK 會員服務",
  chatBarText: "會員服務 / 報修",
  areas: [
    ...tabRow("rm-member", "rm-other", "tab=other"),
    { bounds: col(0), action: { type: "uri", uri: LIFF("warranty") } }, // 保固查詢
    { bounds: col(1), action: { type: "uri", uri: LIFF("repair") } },   // 我要報修
    { bounds: col(2), action: { type: "uri", uri: LIFF("bind") } },     // LINE綁定
  ],
};

const menuOther = {
  size: { width: 1200, height: 810 },
  selected: false,
  name: "WAFERLOCK 其他服務",
  chatBarText: "會員服務 / 報修",
  areas: [
    ...tabRow("rm-other", "rm-member", "tab=member"),
    { bounds: col(0), action: { type: "message", text: "我要找服務據點" } },
    { bounds: col(1), action: { type: "message", text: "常見問題" } },
    { bounds: col(2), action: { type: "message", text: "我要真人客服" } },
  ],
};

async function api(path, opt) {
  const r = await fetch(`https://api.line.me${path}`, opt);
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${t}`);
  return t ? JSON.parse(t) : {};
}

async function createMenu(menu) {
  const { richMenuId } = await api("/v2/bot/richmenu", {
    method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify(menu),
  });
  return richMenuId;
}
async function uploadImage(richMenuId, file) {
  const img = readFileSync(file);
  const ct = file.endsWith(".jpg") || file.endsWith(".jpeg") ? "image/jpeg" : "image/png";
  await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
    method: "POST", headers: { ...H, "Content-Type": ct }, body: img,
  }).then(async r => { if (!r.ok) throw new Error("upload " + r.status + " " + await r.text()); });
}
async function setAlias(aliasId, richMenuId) {
  // 先刪舊的（重跑用），再建
  await fetch(`https://api.line.me/v2/bot/richmenu/alias/${aliasId}`, { method: "DELETE", headers: H });
  await api("/v2/bot/richmenu/alias", {
    method: "POST", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ richMenuAliasId: aliasId, richMenuId }),
  });
}

async function cleanup() {
  const { richmenus } = await api("/v2/bot/richmenu/list", { headers: H });
  for (const m of richmenus || []) {
    await fetch(`https://api.line.me/v2/bot/richmenu/${m.richMenuId}`, { method: "DELETE", headers: H });
  }
  if ((richmenus || []).length) console.log(`已清除 ${richmenus.length} 個舊選單`);
}

(async () => {
  await cleanup();
  console.log("建立 會員服務 選單…");
  const idMember = await createMenu(menuMember);
  await uploadImage(idMember, "richmenu-member.jpg");

  console.log("建立 其他服務 選單…");
  const idOther = await createMenu(menuOther);
  await uploadImage(idOther, "richmenu-other.jpg");

  console.log("設定別名…");
  await setAlias("rm-member", idMember);
  await setAlias("rm-other", idOther);

  console.log("設為預設選單（會員服務）…");
  await api(`/v2/bot/user/all/richmenu/${idMember}`, { method: "POST", headers: H });

  console.log("完成 ✅  member:", idMember, " other:", idOther);
})().catch(e => { console.error("❌", e.message); process.exit(1); });
