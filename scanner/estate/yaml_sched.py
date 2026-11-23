"""Framework YAML: Quartz cron schedules (6 or 7 fields) with timezone, plus workflow and ingest config shapes."""

from __future__ import annotations

from pathlib import Path

import yaml

DAY_NAMES = {"SUN": 0, "MON": 1, "TUE": 2, "WED": 3, "THU": 4, "FRI": 5, "SAT": 6}
DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _dow_to_days(field: str) -> list[str]:
    """Quartz day-of-week: names (MON-FRI) or numbers (1=SUN..7=SAT). '?' and '*' mean every day here."""
    if field in ("?", "*", ""):
        return list(DAY_ORDER)
    picked: set[int] = set()
    for part in field.upper().split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-", 1)
            lo, hi = _day_index(a), _day_index(b)
            if lo is None or hi is None:
                raise ValueError(f"unsupported day range '{part}'")
            if lo <= hi:
                picked.update(range(lo, hi + 1))
            else:
                picked.update(list(range(lo, 7)) + list(range(0, hi + 1)))
        else:
            idx = _day_index(part)
            if idx is None:
                raise ValueError(f"unsupported day '{part}'")
            picked.add(idx)
    names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    return [d for d in DAY_ORDER if names.index(d) in picked]


def _day_index(token: str) -> int | None:
    token = token.strip().upper()
    if token in DAY_NAMES:
        return DAY_NAMES[token]
    if token.isdigit() and 1 <= int(token) <= 7:
        return int(token) - 1  # Quartz: 1 = Sunday
    return None


def parse_quartz(expr: str) -> dict:
    """Parse a Quartz cron expression. Returns time (HH:MM), weekdays, and a human sentence. Raises ValueError."""
    fields = (expr or "").split()
    if len(fields) not in (6, 7):
        raise ValueError(f"expected 6 or 7 Quartz fields, got {len(fields)}")
    sec, minute, hour, dom, month, dow = fields[:6]
    if not (sec.isdigit() and minute.isdigit() and hour.isdigit()):
        raise ValueError("only fixed second/minute/hour values are supported")
    time_local = f"{int(hour):02d}:{int(minute):02d}"
    days = _dow_to_days(dow)
    if days == DAY_ORDER[:5]:
        when = "Mon-Fri"
    elif len(days) == 7:
        when = "every day"
    else:
        when = ", ".join(days)
    return {
        "time_local": time_local,
        "weekdays": days,
        "dom": dom,
        "month": month,
        "human": f"{when} at {time_local}",
        "cron": expr,
    }


def load_yaml(path: Path) -> object:
    with path.open("r", encoding="utf-8-sig") as fh:
        return yaml.safe_load(fh)


def classify_yaml(doc: object) -> str:
    """Return 'workflow' (schedule + jobs), 'ingest_config' (tables with source/destination), or 'other'."""
    if not isinstance(doc, dict):
        return "other"
    if isinstance(doc.get("schedule"), dict) and isinstance(doc.get("jobs"), list):
        return "workflow"
    if isinstance(doc.get("schedule"), str) and isinstance(doc.get("tables"), list):
        return "ingest_config"
    if isinstance(doc.get("tables"), list) and any(isinstance(t, dict) and "target_table" in t for t in doc["tables"]):
        return "framework_config"
    return "other"


def workflow_schedule(doc: dict) -> dict:
    sched = doc.get("schedule") or {}
    cron = sched.get("quartz_cron_expression")
    out = {
        "cron": cron,
        "timezone": sched.get("timezone_id"),
        "pause_status": sched.get("pause_status"),
        "time_local": None,
        "weekdays": [],
        "human": None,
        "parse_error": None,
    }
    if cron:
        try:
            parsed = parse_quartz(cron)
            out.update(time_local=parsed["time_local"], weekdays=parsed["weekdays"], human=parsed["human"])
        except ValueError as err:
            out["parse_error"] = str(err)
    return out


def ingest_schedule(doc: dict) -> dict:
    """Lakeflow-style ingest configs carry the cron as a plain string and usually no timezone."""
    return workflow_schedule({"schedule": {"quartz_cron_expression": doc.get("schedule"), "timezone_id": doc.get("timezone")}})
