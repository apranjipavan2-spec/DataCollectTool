import httpx
import asyncio
import logging

logger = logging.getLogger(__name__)

TELEGRAM_API = "https://api.telegram.org/bot{token}/sendMessage"

async def _send_one(token: str, chat_id: str, text: str):
    url = TELEGRAM_API.format(token=token)
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(url, json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"})
        if r.status_code != 200:
            logger.warning("Telegram send failed chat_id=%s: %s", chat_id, r.text)

async def notify(tenant, event: str, params: dict):
    """Fire-and-forget Telegram notification to all configured chat_ids."""
    cfg = tenant.notification_config or {}
    if not cfg.get("telegram_enabled"):
        return
    token = cfg.get("telegram_bot_token", "")
    chat_ids = cfg.get("telegram_chat_ids", [])
    notify_events = cfg.get("notify_events", ["submission.created", "submission.flagged", "import.complete"])
    if not token or not chat_ids or event not in notify_events:
        return

    text = _build_message(event, params)
    tasks = [_send_one(token, cid, text) for cid in chat_ids]
    asyncio.create_task(asyncio.gather(*tasks, return_exceptions=True))

def _build_message(event: str, params: dict) -> str:
    form = params.get("form_title", "")
    enumerator = params.get("enumerator_name", "")
    serial = params.get("serial_no", "")
    base = f"<b>FieldGovern</b>"
    if event == "submission.created":
        return f"{base}\n📥 New submission #{serial}\nForm: {form}\nBy: {enumerator}"
    if event == "submission.flagged":
        return f"{base}\n🚩 Submission #{serial} flagged\nForm: {form}"
    if event == "submission.approved":
        return f"{base}\n✅ Submission #{serial} approved\nForm: {form}"
    if event == "submission.rejected":
        return f"{base}\n❌ Submission #{serial} rejected\nForm: {form}"
    if event == "import.complete":
        count = params.get("count", 0)
        return f"{base}\n🔄 Import complete — {count} submissions imported\nForm: {form}"
    return f"{base}\n{event}"
