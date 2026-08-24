# -*- coding: utf-8 -*-
# ==============================================
# WAFERLOCK 貨運託運單 Worker — 解析 PDF → 配對客戶 → 寫入 shipments
#
# 為什麼要這支：PDF 解析用 PyMuPDF，Supabase Edge Function(Deno) 沒有對應品，
#   所以 shipment-intake 只負責收檔存 Storage、排進 shipment_files 佇列，
#   實際解析與配對由這支 Python worker 輪詢處理。
#
# 流程：撈 shipment_files(status=pending) → 從 Storage 下載原檔
#       → parsers.py 解析 → matching.py 配對 customers/installs
#       → upsert shipments → 回寫 shipment_files 狀態
#
# 部署：任何能跑 Python 3.10+ 的地方（本機工作站排程即可，不需要常駐服務）。
#   單次執行：  python main.py
#   持續輪詢：  python main.py --loop 300      （每 300 秒跑一次）
#   本機排程：  Windows 工作排程器每 5 分鐘呼叫 `python main.py`
#
# 需要的環境變數：
#   SUPABASE_URL              （https://<ref>.supabase.co）
#   SUPABASE_SERVICE_ROLE_KEY （讀寫 shipments / 下載 Storage 用）
#   SHIPMENT_BUCKET           （預設 shipment-docs）
#
# 前置：先在 Supabase SQL Editor 執行 sql/supabase_shipments.sql
# ==============================================
import argparse
import datetime
import json
import os
import sys
import tempfile
import time

import requests

import matching
import parsers

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
BUCKET = os.environ.get("SHIPMENT_BUCKET", "shipment-docs")

BATCH = 10  # 單次最多處理幾份 PDF


def _headers(extra=None):
    h = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"}
    if extra:
        h.update(extra)
    return h


def db_get(path):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{path}", headers=_headers(), timeout=30)
    r.raise_for_status()
    return r.json()


def db_patch(path, body):
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers=_headers({"Content-Type": "application/json"}),
        json=body, timeout=30,
    )
    r.raise_for_status()
    return r


def db_upsert(table, rows):
    """以主鍵覆蓋寫入。同一份 PDF 重跑不會產生重複列。"""
    if not rows:
        return
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=_headers({
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        }),
        json=rows, timeout=60,
    )
    if not r.ok:
        raise RuntimeError(f"寫入 {table} 失敗 HTTP {r.status_code}：{r.text[:300]}")


def storage_download(path):
    r = requests.get(
        f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{path}",
        headers=_headers(), timeout=60,
    )
    r.raise_for_status()
    return r.content


def load_thresholds():
    """門檻由 config 表覆寫，不硬編碼決策值。讀不到就用預設。"""
    try:
        rows = db_get("config?key=eq.shipment_match_thresholds&select=value")
        if rows:
            return {**matching.DEFAULT_THRESHOLDS, **json.loads(rows[0]["value"])}
    except Exception as exc:
        print(f"  （門檻沿用預設，讀 config 失敗：{exc}）")
    return dict(matching.DEFAULT_THRESHOLDS)


def load_reference():
    """一次撈齊配對需要的客戶與安裝單，避免每筆託運單各打一次 API。"""
    customers = db_get(
        "customers?select=wf_id,name,phone,address,dealer_code,customer_type&limit=100000"
    )
    installs = db_get(
        "installs?select=id,wf_id,name,phone,address,shipment_no,shipped_date&limit=100000"
    )
    # 已經掛過託運單的安裝單不再重複配對，降低誤配面
    taken = {
        s["install_id"]
        for s in db_get("shipments?select=install_id&install_id=not.is.null&limit=100000")
        if s.get("install_id")
    }
    for ins in installs:
        ins["tracking_no"] = ins["id"] in taken
    return customers, installs


def process_file(rec, customers, installs, thresholds):
    """處理一份 PDF。回傳 (解析筆數, 自印筆數, 狀態摘要字串)。"""
    path = rec.get("storage_path")
    if not path:
        raise RuntimeError("shipment_files 缺 storage_path")

    pdf_bytes = storage_download(path)
    tmp = os.path.join(tempfile.gettempdir(), f"waferlock_{rec['id']}.pdf")
    with open(tmp, "wb") as f:
        f.write(pdf_bytes)
    try:
        result = parsers.parse_pdf(tmp)
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass

    carrier, rows, declared = result["carrier"], result["rows"], result["declared"]

    payload = []
    stats = {}
    for row in rows:
        m = matching.match_row(row, customers, installs, thresholds)
        stats[m["match_status"]] = stats.get(m["match_status"], 0) + 1
        payload.append({
            "id": f"{row['carrier']}:{row['tracking_no']}",
            "carrier": row["carrier"],
            "tracking_no": row["tracking_no"],
            "ship_date": row.get("ship_date"),
            "shipper_account": row.get("shipper_account"),
            "shipper_name": row.get("shipper_name"),
            "station": row.get("station"),
            "order_no": row.get("order_no"),
            "recipient_code": row.get("recipient_code"),
            "recipient_name": row.get("recipient_name"),
            "recipient_phone": row.get("recipient_phone"),
            "recipient_address": row.get("recipient_address"),
            "address_norm": matching.norm_addr_match(row.get("recipient_address")),
            "remark": row.get("remark"),
            "pieces": row.get("pieces"),
            "wf_id": m["wf_id"],
            "install_id": m["install_id"],
            "match_score": m["match_score"],
            "match_status": m["match_status"],
            "matched_by": m["matched_by"],
            "source_file": rec.get("file_name"),
            "source_file_id": rec["id"],
            "raw_row": row,
        })

    db_upsert("shipments", payload)

    # 已配對的安裝單就地標記，避免同一批內後面的託運單重複配到同一張單
    for p in payload:
        if p["install_id"]:
            for ins in installs:
                if ins["id"] == p["install_id"]:
                    ins["tracking_no"] = True

    summary = "、".join(f"{k} {v}" for k, v in sorted(stats.items())) or "無資料"
    return carrier, len(rows), declared, summary


def run_once():
    if not SUPABASE_URL or not SERVICE_KEY:
        print("❌ 未設定 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY，無法執行。")
        return 1

    pending = db_get(
        f"shipment_files?status=eq.pending&select=*&order=created_at.asc&limit={BATCH}"
    )
    if not pending:
        print("本次無待解析的貨運單。")
        return 0

    thresholds = load_thresholds()
    customers, installs = load_reference()
    print(f"待處理 {len(pending)} 份｜客戶 {len(customers)} 筆、安裝單 {len(installs)} 筆")

    ok = failed = 0
    warnings = []
    for rec in pending:
        name = rec.get("file_name") or rec["id"]
        try:
            carrier, parsed, declared, summary = process_file(rec, customers, installs, thresholds)
        except Exception as exc:
            failed += 1
            print(f"❌ {name}：{exc}")
            # 失敗要留痕，不能靜默跳過——否則這份託運單會永遠消失
            db_patch(f"shipment_files?id=eq.{rec['id']}", {
                "status": "failed",
                "error": str(exc)[:500],
                "parsed_at": datetime.datetime.now().astimezone().isoformat(),
            })
            continue

        count_ok = declared is None or declared == parsed
        db_patch(f"shipment_files?id=eq.{rec['id']}", {
            "status": "parsed",
            "carrier": carrier,
            "parsed_count": parsed,
            "declared_count": declared,
            "error": None if count_ok else f"解析 {parsed} 筆，PDF 自印 {declared} 筆，可能漏抓",
            "parsed_at": datetime.datetime.now().astimezone().isoformat(),
        })
        ok += 1
        flag = "" if count_ok else f"  ⚠ 與 PDF 自印 {declared} 筆不符"
        print(f"✅ {name}（{carrier}）{parsed} 筆｜{summary}{flag}")
        if not count_ok:
            warnings.append(f"{name}：解析 {parsed} 筆，PDF 自印 {declared} 筆")

    print(f"\n完成：成功 {ok} 份、失敗 {failed} 份。")
    if warnings:
        print("⚠ 筆數不符（可能漏抓，請人工核對原始 PDF）：")
        for w in warnings:
            print(f"  - {w}")
    return 1 if failed else 0


def main():
    ap = argparse.ArgumentParser(description="貨運託運單解析 worker")
    ap.add_argument("--loop", type=int, metavar="SECONDS",
                    help="持續輪詢，每 N 秒跑一次（省略則只跑一次）")
    args = ap.parse_args()

    if not args.loop:
        return run_once()

    print(f"輪詢模式，每 {args.loop} 秒一次。Ctrl+C 結束。")
    while True:
        try:
            run_once()
        except Exception as exc:
            print(f"❌ 本輪異常（不中斷輪詢）：{exc}")
        time.sleep(args.loop)


if __name__ == "__main__":
    sys.exit(main() or 0)
