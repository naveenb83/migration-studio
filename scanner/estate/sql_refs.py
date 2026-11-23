"""T-SQL reference extraction: which tables a statement reads, writes and executes.

Uses sqlglot (tsql dialect). Anything sqlglot cannot model (it returns a Command, e.g. EXEC, IF, DECLARE blocks)
falls back to a regex pass, and those refs are marked confidence='regex'. EXEC calls are always regex-derived,
because sqlglot returns EXEC as an opaque Command.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import sqlglot
from sqlglot import exp

from .util import clean_name, norm_name

PARSED = "parsed"
REGEX = "regex"

# Whole-line noise that carries no lineage. Removed before parsing.
BENIGN_LINE_RE = re.compile(
    r"(?im)^\s*(?:SET\s+\w+\s+(?:ON|OFF)|USE\s+\[?[\w\s]+\]?|BEGIN\s+TRANSACTION|COMMIT(?:\s+TRANSACTION)?|"
    r"GO|BEGIN|END|ELSE|GOTO\s+\w+)\s*;?\s*$"
)
GO_RE = re.compile(r"(?im)^\s*GO\s*$")
# Control flow that the statement parser does not model: its inner tables are picked up by the regex pass.
CONTROL_RE = re.compile(r"(?im)(?:^|;|\bBEGIN\b|\bELSE\b)\s*(?:IF|WHILE|BEGIN\s+TRY|BEGIN\s+CATCH)\b")
BLOCK_COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
LINE_COMMENT_RE = re.compile(r"--[^\n]*")

CREATE_RE = re.compile(
    r"(?is)\bCREATE\s+(?:OR\s+(?:ALTER|REPLACE)\s+)?(PROCEDURE|PROC|VIEW|FUNCTION|TABLE)\s+"
    r"((?:\[[^\]]+\]|[\w$#]+)(?:\s*\.\s*(?:\[[^\]]+\]|[\w$#]+)){0,2})"
)
AS_RE = re.compile(r"(?i)\bAS\b")
EXEC_RE = re.compile(
    r"(?i)\bEXEC(?:UTE)?\s+(?:@\w+\s*=\s*|\?\s*=\s*)?"
    r"((?:\[[^\]]+\]|[\w$#]+)(?:\s*\.\s*(?:\[[^\]]+\]|[\w$#]+)){0,2})"
)
EXEC_KEYWORDS = {"AS", "CALLER", "OWNER", "SELF", "ON", "TO", "USER", "OBJECT", "PERMISSIONS", "LOGIN", "ROLE"}
NAME_PART = r"(?:\[[^\]]+\]|[\w$#]+)(?:\s*\.\s*(?:\[[^\]]+\]|[\w$#]+)){0,2}"
REGEX_READ_RE = re.compile(rf"(?i)\b(?:FROM|JOIN)\s+({NAME_PART})")
REGEX_WRITE_RE = re.compile(
    rf"(?i)\b(?:INSERT\s+(?:INTO\s+)?|UPDATE\s+|DELETE\s+(?:FROM\s+)?|MERGE\s+(?:INTO\s+)?|TRUNCATE\s+TABLE\s+)({NAME_PART})"
)
SYSTEM_EXEC = {"sp_executesql"}


def _is_system(name: str) -> bool:
    """SQL Server system objects (msdb.*, sp_*) are platform calls, not legacy business logic."""
    parts = [p.strip().strip("[]").lower() for p in name.split(".")]
    return parts[0] == "msdb" or parts[-1].startswith("sp_") or parts[-1] in SYSTEM_EXEC


@dataclass(frozen=True)
class Ref:
    name: str
    confidence: str


@dataclass
class SqlAnalysis:
    reads: list[Ref] = field(default_factory=list)
    writes: list[Ref] = field(default_factory=list)
    execs: list[Ref] = field(default_factory=list)
    defines: str | None = None  # object defined by CREATE VIEW/PROC/FUNCTION/TABLE, if any
    defines_kind: str | None = None
    parse_status: str = PARSED  # parsed | partial | regex | error
    statements: int = 0
    error: str | None = None


def split_batches(text: str) -> list[str]:
    return [b for b in GO_RE.split(text) if b and b.strip()]


def _strip_noise(text: str) -> str:
    text = BLOCK_COMMENT_RE.sub(" ", text)
    text = LINE_COMMENT_RE.sub(" ", text)
    return "\n".join(line for line in text.splitlines() if not BENIGN_LINE_RE.match(line))


def _definition(batch: str) -> tuple[str | None, str | None, str]:
    """Return (kind, object name, body text). For non-definitions, kind and name are None and body is the batch."""
    m = CREATE_RE.search(batch)
    if not m:
        return None, None, batch
    kind = m.group(1).upper()
    name = clean_name(m.group(2))
    if kind == "TABLE":
        return kind, name, ""  # DDL: its column list is not lineage
    rest = batch[m.end():]
    for am in AS_RE.finditer(rest):
        before = rest[: am.start()]
        if re.search(r"(?i)\bEXEC(?:UTE)?\s*$", before):  # "WITH EXEC AS CALLER" is not the body separator
            continue
        return kind, name, rest[am.end():]
    return kind, name, ""


def _tables(node) -> list[exp.Table]:
    return list(node.find_all(exp.Table)) if node is not None else []


def _qname(t: exp.Table) -> str:
    parts = [p for p in (t.args.get("catalog"), t.args.get("db"), t.args.get("this")) if p is not None]
    names = []
    for p in parts:
        names.append(p.name if hasattr(p, "name") else str(p))
    return ".".join(n for n in names if n)


def _is_temp(name: str, text: str) -> bool:
    short = name.split(".")[-1]
    return short.startswith("#") or re.search(r"#\s*" + re.escape(short) + r"\b", text) is not None


def _regex_fallback(text: str, into: SqlAnalysis, confidence: str = REGEX) -> None:
    known_r = {norm_name(r.name) for r in into.reads}
    known_w = {norm_name(w.name) for w in into.writes}
    for m in REGEX_READ_RE.finditer(text):
        name = clean_name(m.group(1))
        if name and not _is_system(name) and not _is_temp(name, text) and norm_name(name) not in known_r:
            into.reads.append(Ref(name, confidence))
            known_r.add(norm_name(name))
    for m in REGEX_WRITE_RE.finditer(text):
        name = clean_name(m.group(1))
        if name and not _is_temp(name, text) and norm_name(name) not in known_w:
            into.writes.append(Ref(name, confidence))
            known_w.add(norm_name(name))


def _exec_refs(text: str) -> list[Ref]:
    out = []
    for m in EXEC_RE.finditer(text):
        name = clean_name(m.group(1))
        if not name or _is_system(name) or name.upper() in EXEC_KEYWORDS:
            continue
        out.append(Ref(name, REGEX))  # sqlglot returns EXEC as an opaque Command, so this is always regex
    return out


def _parse_batch(body: str, dialects: tuple[str, ...]):
    last_err = None
    for dialect in dialects:
        try:
            trees = [t for t in sqlglot.parse(body, read=dialect) if t is not None]
        except sqlglot.errors.ParseError as err:
            last_err = err
            continue
        if trees and not all(isinstance(t, exp.Command) for t in trees):
            return trees, dialect
    if last_err is not None:
        return None, str(last_err).splitlines()[0][:200]
    return None, "no parseable statements"


def _collect_statement(tree, defined: str | None, text: str, into: SqlAnalysis) -> bool:
    """Add reads/writes for one parsed statement. Returns True if it contained a Command fallback."""
    if isinstance(tree, exp.Command):
        return True

    write_nodes: list[exp.Table] = []
    if isinstance(tree, exp.Insert):
        write_nodes = _tables(tree.this)
    elif isinstance(tree, (exp.Update, exp.Delete)):
        write_nodes = _tables(tree.this)
    elif isinstance(tree, exp.Merge):
        write_nodes = _tables(tree.this)
    elif isinstance(tree, exp.TruncateTable):
        write_nodes = _tables(tree)
    elif isinstance(tree, exp.Select) and tree.args.get("into") is not None:
        write_nodes = _tables(tree.args["into"])

    # Create: skip the object being defined (it is not a read)
    cte_names = {c.alias_or_name.lower() for c in tree.find_all(exp.CTE)}
    write_ids = {id(t) for t in write_nodes}
    write_names = {norm_name(_qname(t)) for t in write_nodes}
    seen_reads: set[str] = set()
    for t in _tables(tree):
        if id(t) in write_ids:
            continue
        name = _qname(t)
        if not name:
            continue
        if not t.args.get("db") and t.name.lower() in cte_names:
            continue
        key = norm_name(name)
        if key == norm_name(defined) or _is_temp(name, text):
            continue
        if isinstance(tree, (exp.Update, exp.Delete, exp.Merge, exp.Insert)) and key in write_names:
            continue  # self-reference inside the target clause
        if key in seen_reads:
            continue
        seen_reads.add(key)
        into.reads.append(Ref(name, PARSED))
    for t in write_nodes:
        name = _qname(t)
        if name and not _is_temp(name, text):
            into.writes.append(Ref(name, PARSED))
    return False


def analyze_sql(text: str | None, dialects: tuple[str, ...] = ("tsql",)) -> SqlAnalysis:
    """Analyse one SQL blob (a file, an Execute SQL statement, or a data-flow SQL command)."""
    out = SqlAnalysis()
    if not text or not text.strip():
        return out
    fallback_used = False
    for raw_batch in split_batches(text):
        batch = _strip_noise(raw_batch)
        kind, name, body = _definition(batch)
        if kind and not out.defines:
            out.defines, out.defines_kind = name, kind
        execs = _exec_refs(batch)
        out.execs.extend(execs)
        if kind == "TABLE" or not body.strip():
            continue
        body = re.sub(r"(?is)^\s*BEGIN\s+(?=\S)", "", body)
        body = re.sub(r"(?is)\bEND\s*;?\s*$", "", body)
        control = CONTROL_RE.search(body) is not None
        body = EXEC_RE.sub(" ", body)  # EXEC calls are handled above, not by the parser
        if not body.strip():
            continue
        trees, info = _parse_batch(body, dialects)
        if trees is None:
            fallback_used = True
            _regex_fallback(body, out)
            out.parse_status = REGEX
            out.error = out.error or info
            continue
        out.statements += len(trees)
        has_command = False
        for tree in trees:
            if _collect_statement(tree, name, body, out):
                has_command = True
        if has_command or control:
            fallback_used = True
            _regex_fallback(body, out)
    if fallback_used and out.parse_status == PARSED:
        out.parse_status = "partial"
    return out


def dedupe(refs: list[Ref]) -> list[Ref]:
    seen, out = set(), []
    for r in refs:
        k = (norm_name(r.name), r.confidence)
        if k not in seen:
            seen.add(k)
            out.append(r)
    return out
