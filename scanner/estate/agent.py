"""SQL Server Agent job script parser (msdb.dbo.sp_add_job / sp_add_jobstep / schedules / sp_attach_schedule).

Reads named arguments with a regex over each msdb call. Produces jobs with their steps (SSIS package
references taken from the step command) and their schedules, with a human-readable schedule string.
"""

from __future__ import annotations

import re

from .util import mask_secrets

CALL_RE = re.compile(r"msdb\s*\.\s*dbo\s*\.\s*(sp_\w+)", re.I)
ARG_RE = re.compile(r"@(\w+)\s*=\s*(N?'(?:[^']|'')*'|[^,\s]+)", re.I)
PACKAGE_FILE_RE = re.compile(r"([^\\/\"\s]+)\.dtsx", re.I)

WEEKDAY_BITS = [(1, "Sun"), (2, "Mon"), (4, "Tue"), (8, "Wed"), (16, "Thu"), (32, "Fri"), (64, "Sat")]
FREQ_TYPE = {1: "once", 4: "daily", 8: "weekly", 16: "monthly", 32: "monthly_relative", 64: "agent_start", 128: "idle"}
SUBDAY_UNIT = {2: "second", 4: "minute", 8: "hour"}


def _value(raw: str) -> str:
    raw = raw.strip()
    if raw[:2].upper() == "N'":
        raw = raw[1:]
    if len(raw) >= 2 and raw.startswith("'") and raw.endswith("'"):
        return raw[1:-1].replace("''", "'")
    return raw


def _args(segment: str) -> dict[str, str]:
    return {m.group(1).lower(): _value(m.group(2)) for m in ARG_RE.finditer(segment)}


def _int(value: str | None, default: int = 0) -> int:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


def fmt_time(hhmmss: int) -> str:
    hh, mm = hhmmss // 10000, (hhmmss // 100) % 100
    return f"{hh:02d}:{mm:02d}"


def weekdays_from_bitmask(mask: int) -> list[str]:
    return [name for bit, name in WEEKDAY_BITS if mask & bit]


def describe_schedule(s: dict) -> tuple[str, list[str], str | None]:
    """Return (human text, weekday names, local start time HH:MM) for an msdb schedule dict."""
    freq = _int(s.get("freq_type"))
    interval = _int(s.get("freq_interval"))
    subday = _int(s.get("freq_subday_type"))
    sub_interval = _int(s.get("freq_subday_interval"))
    start_t = _int(s.get("active_start_time"))
    end_t = _int(s.get("active_end_time"), 235959)
    days: list[str] = []
    if freq == 8:
        days = weekdays_from_bitmask(interval)
        if days == ["Mon", "Tue", "Wed", "Thu", "Fri"]:
            when = "Mon-Fri"
        elif len(days) == 7:
            when = "every day"
        else:
            when = ", ".join(days) or "no days set"
        base = f"Weekly on {when}"
    elif freq == 4:
        days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        base = "Daily" if interval <= 1 else f"Every {interval} days"
    else:
        base = FREQ_TYPE.get(freq, f"freq_type {freq}")
    start = fmt_time(start_t) if start_t or freq in (4, 8) else None
    if subday in SUBDAY_UNIT and sub_interval:
        unit = SUBDAY_UNIT[subday]
        text = f"{base}, every {sub_interval} {unit}(s) from {start} to {fmt_time(end_t)}"
    elif start:
        text = f"{base} at {start}"
    else:
        text = base
    return text, days, start


def _package_ref(command: str) -> tuple[str | None, str]:
    upper = command.upper()
    if "/ISSERVER" in upper:
        kind = "ssisdb"
    elif "/FILE" in upper:
        kind = "file"
    else:
        kind = "unknown"
    found = PACKAGE_FILE_RE.findall(command)
    return (found[-1] if found else None), kind


def parse_agent_script(text: str, source_file: str) -> dict:
    """Parse one SQL Agent job script. Returns {'jobs': [...], 'named_schedules': {...}, 'warnings': [...]}."""
    calls = list(CALL_RE.finditer(text))
    jobs: list[dict] = []
    jobs_by_name: dict[str, dict] = {}
    named: dict[str, dict] = {}
    warnings: list[str] = []
    current: dict | None = None
    for i, m in enumerate(calls):
        proc = m.group(1).lower()
        end = calls[i + 1].start() if i + 1 < len(calls) else len(text)
        args = _args(text[m.end():end])
        if proc == "sp_add_job":
            name = args.get("job_name")
            if not name:
                warnings.append("sp_add_job without @job_name")
                continue
            current = {
                "job_name": name,
                "description": args.get("description"),
                "category": args.get("category_name"),
                "owner": args.get("owner_login_name"),
                "enabled": _int(args.get("enabled"), 1) == 1,
                "source_file": source_file,
                "steps": [],
                "schedules": [],
            }
            jobs.append(current)
            jobs_by_name[name] = current
        elif proc == "sp_add_jobstep":
            target = jobs_by_name.get(args.get("job_name", ""), current)
            if target is None:
                warnings.append("sp_add_jobstep before sp_add_job")
                continue
            command = mask_secrets(args.get("command", "")) or ""
            pkg, ref_kind = _package_ref(command) if (args.get("subsystem", "").upper() == "SSIS") else (None, "")
            target["steps"].append(
                {
                    "step_name": args.get("step_name"),
                    "step_id": _int(args.get("step_id"), len(target["steps"]) + 1),
                    "subsystem": args.get("subsystem"),
                    "package_ref": pkg,
                    "package_ref_kind": ref_kind or None,
                    "command": command,
                    "database_name": args.get("database_name"),
                    "on_success_action": _int(args.get("on_success_action"), 1),
                    "on_fail_action": _int(args.get("on_fail_action"), 2),
                }
            )
        elif proc == "sp_add_schedule":
            name = args.get("schedule_name")
            if name:
                named[name] = {k: args.get(k) for k in _SCHED_KEYS} | {"name": name}
        elif proc == "sp_add_jobschedule":
            target = current
            if target is None:
                warnings.append("sp_add_jobschedule before sp_add_job")
                continue
            sched = {k: args.get(k) for k in _SCHED_KEYS} | {"name": args.get("name")}
            target["schedules"].append(sched)
        elif proc == "sp_attach_schedule":
            target = jobs_by_name.get(args.get("job_name", ""), current)
            sched = named.get(args.get("schedule_name", ""))
            if target is not None and sched is not None:
                target["schedules"].append(dict(sched))
            elif target is not None:
                warnings.append(f"sp_attach_schedule references unknown schedule '{args.get('schedule_name')}'")

    for job in jobs:
        for sched in job["schedules"]:
            text_, days, start = describe_schedule(sched)
            sched["human"] = text_
            sched["weekdays"] = days
            sched["start_time"] = start
            sched["enabled"] = _int(sched.get("enabled"), 1) == 1
    return {"jobs": jobs, "named_schedules": named, "warnings": warnings}


_SCHED_KEYS = (
    "freq_type",
    "freq_interval",
    "freq_subday_type",
    "freq_subday_interval",
    "active_start_date",
    "active_start_time",
    "active_end_time",
    "enabled",
)
