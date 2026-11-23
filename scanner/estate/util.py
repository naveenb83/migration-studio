"""Shared helpers: encoding detection, XML loading, secret masking, hashing."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

from lxml import etree

# Keys whose values must never be written anywhere.
SECRET_NAME_RE = re.compile(r"(?i)(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)")
# Inline secrets inside connection strings and SQL text, e.g. Password=abc; PWD='x'; PASSWORD = 'x'
INLINE_SECRET_RE = re.compile(r"(?i)((?:password|passwd|pwd)\s*=\s*)('(?:[^']|'')*'|[^;,\s\"')]+)")
# SSIS /Par form: $Package::Password(String)";"value"  (value after the ;)
PAR_SECRET_RE = re.compile(r"(?i)((?:password|passwd|pwd)(?:\([^)]*\))?[\\\"]*\s*;\s*[\\\"]*)([^\"\\;\s]+)")

MASK = "***"


def mask_secrets(text: str | None) -> str | None:
    """Mask inline password-like values in free text (connection strings, SQL, commands)."""
    if text is None:
        return None
    text = INLINE_SECRET_RE.sub(lambda m: m.group(1) + MASK, text)
    return PAR_SECRET_RE.sub(lambda m: m.group(1) + MASK, text)


def mask_value(name: str | None, value: str | None) -> str | None:
    """Mask a value if its name looks secret, otherwise mask inline secrets in it."""
    if value is None:
        return None
    if name and SECRET_NAME_RE.search(name):
        return MASK if value != "" else value
    return mask_secrets(value)


def read_text(path: Path) -> str:
    """Read a text file, honouring UTF-16 (with or without BOM) and UTF-8 BOM."""
    raw = path.read_bytes()
    if raw.startswith(b"\xff\xfe") or raw.startswith(b"\xfe\xff"):
        return raw.decode("utf-16")  # codec consumes the BOM
    if raw.startswith(b"\xef\xbb\xbf"):
        return raw[3:].decode("utf-8")
    if len(raw) > 1 and raw[1:2] == b"\x00" and raw[0:1] != b"\x00":
        return raw.decode("utf-16-le")  # BOM-less UTF-16 LE
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("cp1252", errors="replace")


def encoding_label(path: Path) -> str:
    raw = path.read_bytes()[:4]
    if raw.startswith(b"\xff\xfe") or raw.startswith(b"\xfe\xff"):
        return "utf-16-bom"
    if raw.startswith(b"\xef\xbb\xbf"):
        return "utf-8-bom"
    if len(raw) > 1 and raw[1:2] == b"\x00":
        return "utf-16-le-nobom"
    return "utf-8"


_XML_DECL_RE = re.compile(r"^\s*<\?xml[^>]*\?>")


def parse_xml_text(text: str) -> etree._Element:
    """Parse XML from decoded text. The declaration is stripped so an encoding mismatch cannot break parsing."""
    body = _XML_DECL_RE.sub("", text.lstrip("﻿"), count=1)
    parser = etree.XMLParser(huge_tree=True, resolve_entities=False, recover=False)
    return etree.fromstring(body.encode("utf-8"), parser)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def slug(text: str) -> str:
    """Filesystem- and id-safe slug that keeps the original casing."""
    s = re.sub(r"[^A-Za-z0-9_-]+", "_", text or "").strip("_")
    return s or "unnamed"


def norm_name(name: str | None) -> str:
    """Normalise a SQL object name for matching: drop brackets/quotes, lower-case, keep the last part."""
    if not name:
        return ""
    cleaned = name.replace("[", "").replace("]", "").replace('"', "").strip()
    return cleaned.split(".")[-1].strip().lower()


def clean_name(name: str | None) -> str:
    """Display form of a (possibly bracketed, possibly qualified) name: dbo.Thing."""
    if not name:
        return ""
    parts = [p.strip().strip("[]\"").strip() for p in name.split(".")]
    return ".".join(p for p in parts if p)
