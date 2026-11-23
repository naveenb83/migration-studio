"""Plan how to run converted SQL (e.g. Genie Migrate output) safely in a sandbox, and how to compare it with legacy.

Pure Python + sqlglot: no Spark here, so it can be unit-tested locally. The job notebook (job_convert.py) does the
Spark parts: listing tables, executing the planned statements, describing outputs, scoring columns, validating.

Safety model (fail closed):
- Every statement is parsed. Anything that isn't parsed, or isn't on the allowlist, is BLOCKED (never run).
- Every object the converted code creates or writes is redirected into the team's sandbox schema.
- Every table it reads is resolved to an allowed input (pack mapping, overrides, or a table in an allowed read schema)
  or to an object created earlier in the sandbox. An unknown table blocks the statement.
- The converted text is otherwise run exactly as written: only table and function names are replaced, by position.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError, TokenError
from sqlglot.tokens import TokenType

DIALECT = "databricks"
NONDETERMINISTIC = {"current_timestamp", "current_date", "now", "current_user", "user", "session_user", "uuid", "rand",
                    "random", "randn", "monotonically_increasing_id", "current_timezone", "getdate", "sysdatetime"}


# --------------------------------------------------------------------------------------------------- statements
def split_statements(text: str) -> list[str]:
    """Split on top-level semicolons (not inside strings, comments or BEGIN ... END blocks). Comment-only pieces drop."""
    try:
        tokens = sqlglot.tokenize(text, read=DIALECT)
    except (TokenError, Exception):  # noqa: BLE001 - fall back to a plain split; the parser rejects what it can't read
        return [s.strip() for s in re.split(r";\s*(?:\n|$)", text) if _has_code(s)]
    out, start, stack = [], 0, []
    for i, t in enumerate(tokens):
        if t.token_type == TokenType.CASE:
            stack.append("CASE")
        elif t.token_type == TokenType.BEGIN or (t.token_type == TokenType.VAR and t.text.upper() == "BEGIN"):
            stack.append("BEGIN")
        elif t.token_type == TokenType.END and stack:
            stack.pop()
        elif t.token_type == TokenType.SEMICOLON and "BEGIN" not in stack:
            piece = text[start:t.start]
            if _has_code(piece):
                out.append(piece.strip())
            start = t.end + 1
    tail = text[start:]
    if _has_code(tail):
        out.append(tail.strip())
    return out


def _has_code(s: str) -> bool:
    s = re.sub(r"/\*.*?\*/", " ", s, flags=re.S)
    s = re.sub(r"--[^\n]*", " ", s)
    return bool(s.strip().strip(";").strip())


def code_preview(s: str, n: int = 240) -> str:
    s = re.sub(r"/\*.*?\*/", " ", s, flags=re.S)
    s = re.sub(r"--[^\n]*", " ", s)
    return re.sub(r"\s+", " ", s).strip()[:n]


def strip_leading_comments(s: str) -> str:
    """Drop comments (and blank space) before the first keyword, so a header comment doesn't hide what a statement is."""
    while True:
        t = s.lstrip()
        if t.startswith("--"):
            s = t.split("\n", 1)[1] if "\n" in t else ""
        elif t.startswith("/*") and "*/" in t:
            s = t.split("*/", 1)[1]
        else:
            return t


PROC_RE = re.compile(r"^\s*CREATE\s+(?:OR\s+REPLACE\s+)?PROCEDURE\s+([`\w.\[\]]+)\s*(\(([^)]*)\))?", re.I | re.S)


def inline_procedure(stmt: str) -> tuple[str, list[str]] | None:
    """CREATE PROCEDURE name() ... BEGIN <body> END -> (name, body statements). None if not a procedure.
    Raises ValueError when the procedure takes parameters or declares variables (not supported: not run)."""
    stmt = strip_leading_comments(stmt)
    m = PROC_RE.match(stmt)
    if not m:
        return None
    name = m.group(1).replace("`", "").replace("[", "").replace("]", "")
    if m.group(3) and m.group(3).strip():
        raise ValueError(f"procedure {name} takes parameters; inline its statements or call them directly")
    b = re.search(r"\bBEGIN\b", stmt, re.I)
    e = None
    for e in re.finditer(r"\bEND\b", stmt, re.I):
        pass
    if not b or not e or e.start() < b.end():
        raise ValueError(f"procedure {name}: no BEGIN ... END body found")
    body = stmt[b.end():e.start()]
    parts = split_statements(body)
    if any(re.match(r"^\s*DECLARE\b", p, re.I) for p in parts):
        raise ValueError(f"procedure {name} declares variables; not supported")
    return name, parts


# --------------------------------------------------------------------------------------------------- analysis
@dataclass
class Ref:
    written: str               # as written in the code, e.g. stg_wms.station
    name: str                  # last part, lower case
    span: tuple[int, int]      # [start, end] inclusive, in the statement text
    is_target: bool = False


@dataclass
class Analysis:
    kind: str                       # create_view | create_table | ctas | insert | merge | update | delete | truncate | query | drop | alter | use | set | call | other
    status: str = "run"             # run | skip | blocked
    reason: str = ""
    target: Ref | None = None
    refs: list[Ref] = field(default_factory=list)          # tables read (and the target)
    funcs: list[Ref] = field(default_factory=list)          # user function calls (name spans)
    nondeterministic: list[str] = field(default_factory=list)  # output columns computed from now()/user()/uuid()
    temporary: bool = False


def _table_ref(t: exp.Table, target=False) -> Ref | None:
    parts = [p for p in t.parts if isinstance(p, exp.Identifier)]
    if not parts or any("start" not in p.meta for p in parts):
        return None
    return Ref(written=".".join(p.name for p in parts), name=parts[-1].name.lower(),
               span=(parts[0].meta["start"], parts[-1].meta["end"]), is_target=target)


def _unwrap(node):
    return node.this if isinstance(node, exp.Schema) else node


def analyse(stmt: str) -> Analysis:
    code = strip_leading_comments(stmt)
    head = code.split(None, 1)[0].upper() if code else ""
    if head == "USE":
        return Analysis("use", "skip", "USE is ignored: every name is fully qualified by the app")
    if head == "SET":
        return Analysis("set", "skip", "SET is ignored")
    if head == "CALL":
        return Analysis("call", "skip", "CALL is skipped: procedure bodies are run inline")
    try:
        tree = sqlglot.parse_one(stmt, read=DIALECT)
    except (ParseError, TokenError, Exception) as e:  # noqa: BLE001
        return Analysis("other", "blocked", f"could not be parsed as Databricks SQL: {str(e).splitlines()[0][:200]}")
    if tree is None:
        return Analysis("other", "skip", "empty")
    a = Analysis(_kind(tree))
    if isinstance(tree, exp.Command):
        a.status, a.reason = "blocked", f"'{tree.this}' statements aren't supported"
        return a
    allowed = {"create_view", "create_table", "ctas", "insert", "merge", "update", "delete", "truncate", "query", "drop", "alter", "call"}
    if a.kind not in allowed:
        a.status, a.reason = "blocked", f"{a.kind} statements aren't on the allowlist"
        return a
    cte_names = {c.alias_or_name.lower() for c in tree.find_all(exp.CTE)}
    target_node = None
    if isinstance(tree, (exp.Create, exp.Insert, exp.Merge, exp.Update, exp.Delete, exp.Drop, exp.Alter)):
        target_node = _unwrap(tree.this)
    elif isinstance(tree, exp.TruncateTable) and tree.expressions:
        target_node = tree.expressions[0]
    if isinstance(tree, exp.Create):
        props = tree.args.get("properties")
        a.temporary = bool(props and any(isinstance(p, exp.TemporaryProperty) for p in props.expressions))
        if a.kind in ("create_view", "ctas"):
            a.nondeterministic = _nondeterministic_columns(tree.expression)
    if isinstance(target_node, exp.Table):
        a.target = _table_ref(target_node, target=True)
        if a.target is None:
            a.status, a.reason = "blocked", "could not locate the target name"
            return a
    for t in tree.find_all(exp.Table):
        if t is target_node:
            continue
        if not t.args.get("db") and t.name.lower() in cte_names:
            continue
        r = _table_ref(t)
        if r is None:
            a.status, a.reason = "blocked", f"could not locate table name {t.sql(DIALECT)}"
            return a
        a.refs.append(r)
    if a.target:
        a.refs.append(a.target)
    for f in tree.find_all(exp.Anonymous):
        if "start" in f.meta:
            start, end = f.meta["start"], f.meta["end"]
            if isinstance(f.parent, exp.Dot) and isinstance(f.parent.this, (exp.Identifier, exp.Column)):
                q = f.parent.this
                qi = q if isinstance(q, exp.Identifier) else q.this
                if isinstance(qi, exp.Identifier) and "start" in qi.meta:
                    start = qi.meta["start"]
            a.funcs.append(Ref(written=stmt[start:end + 1], name=f.name.lower(), span=(start, end)))
    if a.kind == "drop" and not a.target:
        a.status, a.reason = "blocked", "DROP without a table or view name"
    if a.kind == "call":
        a.status, a.reason = "skip", "CALL is skipped: procedure bodies are run inline"
    return a


def _kind(tree) -> str:
    if isinstance(tree, exp.Create):
        k = str(tree.args.get("kind") or "").upper()
        if k == "VIEW":
            return "create_view"
        if k == "TABLE":
            return "ctas" if tree.expression is not None else "create_table"
        return f"create_{k.lower() or 'other'}"
    for cls, k in ((exp.Insert, "insert"), (exp.Merge, "merge"), (exp.Update, "update"), (exp.Delete, "delete"),
                   (exp.TruncateTable, "truncate"), (exp.Drop, "drop"), (exp.Alter, "alter"), (exp.Use, "use"),
                   (exp.Set, "set"), (exp.Command, "command")):
        if isinstance(tree, cls):
            return k
    if isinstance(tree, (exp.Select, exp.Union, exp.Intersect, exp.Except, exp.With, exp.Subquery, exp.Values)):
        return "query"
    if type(tree).__name__.lower() == "call":
        return "call"
    return type(tree).__name__.lower()


def _nondeterministic_columns(query) -> list[str]:
    if query is None:
        return []
    sel = query if isinstance(query, exp.Select) else query.find(exp.Select)
    if sel is None:
        return []
    out = []
    for proj in sel.expressions:
        name = proj.alias_or_name
        for f in proj.find_all(exp.Func):
            fname = (f.name if isinstance(f, exp.Anonymous) else f.sql_name()).lower()
            if fname in NONDETERMINISTIC or isinstance(f, (exp.CurrentTimestamp, exp.CurrentDate, exp.CurrentUser, exp.Rand)):
                out.append(name)
                break
    return out


# --------------------------------------------------------------------------------------------------- planning
@dataclass
class Step:
    file: str
    n: int                       # 1-based statement number within the file
    kind: str
    status: str                  # run | skip | blocked
    reason: str
    original: str
    sql: str = ""                # what will run (names replaced)
    target: str | None = None    # sandbox FQN of the object created / written
    target_name: str | None = None
    resolved: dict = field(default_factory=dict)   # written name -> FQN (reads)
    from_procedure: str | None = None
    nondeterministic: list = field(default_factory=list)


def q(fqn: str) -> str:
    return ".".join(f"`{p.strip('`')}`" for p in fqn.split("."))


def _rewrite(stmt: str, repl: list[tuple[tuple[int, int], str]]) -> str:
    out, last = [], 0
    for (s, e), text in sorted(repl, key=lambda x: x[0][0]):
        if s < last:  # overlapping spans: keep the first
            continue
        out.append(stmt[last:s])
        out.append(text)
        last = e + 1
    out.append(stmt[last:])
    return "".join(out)


def plan(files: list[dict], cfg: dict, known_tables: dict[str, str]) -> dict:
    """files: [{name, text}] in the order given. cfg: expanded conversion config:
         sandbox, inputs{name: fqn}, feeds[{match, from, label, why}], stand_ins[{kind, name, sql}], outputs[...],
         overrides{names{written_or_name_lower: fqn}}
       known_tables: {name_lower: fqn} for tables in the allowed read schemas (first schema wins).
    -> {steps, created{name: fqn}, written{name: fqn}, prep[], feeds[], unresolved[], order[]}"""
    sandbox = cfg["sandbox"]
    overrides = {k.lower(): v for k, v in ((cfg.get("overrides") or {}).get("names") or {}).items()}
    inputs = {k.lower(): v for k, v in (cfg.get("inputs") or {}).items()}
    feeds = cfg.get("feeds") or []
    stand_ins = {s["name"].lower(): s for s in (cfg.get("stand_ins") or []) if s.get("kind") == "function"}

    # 1. split + analyse (procedures inlined)
    raw: list[tuple[str, int, str, Analysis, str | None]] = []
    for f in files:
        n = 0
        for stmt in split_statements(f["text"]):
            proc = None
            try:
                proc = inline_procedure(stmt)
            except ValueError as e:
                n += 1
                raw.append((f["name"], n, stmt, Analysis("create_procedure", "blocked", str(e)), None))
                continue
            if proc:
                pname, body = proc
                for b in body:
                    n += 1
                    raw.append((f["name"], n, b, analyse(b), pname))
                continue
            n += 1
            raw.append((f["name"], n, stmt, analyse(stmt), None))

    created = {}   # name -> kind (VIEW/TABLE), objects a converted statement creates
    written = set()
    obj_files: dict[str, set] = {}   # object -> the files that create or write it
    for fname, _, _, a, _ in raw:
        if a.status == "run" and a.target:
            if a.kind in ("create_view", "create_table", "ctas"):
                created[a.target.name] = "VIEW" if a.kind == "create_view" else "TABLE"
            elif a.kind in ("insert", "merge", "update", "delete", "truncate"):
                written.add(a.target.name)
            else:
                continue
            obj_files.setdefault(a.target.name, set()).add(fname)
    temp = {a.target.name for _, _, _, a, _ in raw if a.temporary and a.target}

    def feed_for(name):
        for fd in feeds:
            if re.search(fd["match"], name, re.I):
                return fd
        return None

    prepared = {}
    for o in cfg.get("outputs") or []:
        if o.get("prepare") != "empty_like_legacy":
            continue
        for name in sorted(written - set(created)):
            if any(re.search(m, name, re.I) for m in o.get("match") or []):
                prepared[name] = o["legacy_table"]

    def resolve(r: Ref) -> str | None:
        key_full, key = r.written.lower(), r.name
        # a schema-qualified name may carry the legacy name split in two: stg_x.vw_y = legacy table stg_x_vw_y
        joined = "_".join(key_full.replace("`", "").split(".")[-2:]) if "." in key_full else key
        if key in temp:
            return r.name
        if key_full in overrides:
            return overrides[key_full]
        if key in overrides:
            return overrides[key]
        if key in created or key in prepared:
            return f"{sandbox}.{key}"
        fd = feed_for(key) or feed_for(joined)
        if fd:
            return fd["from"]
        for k in (key, joined):
            if k in inputs:
                return inputs[k]
        for k in (key, joined):
            if k in known_tables:
                return known_tables[k]
        return None

    # 2. order files by dependency (a file that reads what another creates runs after it), stable otherwise
    by_file: dict[str, list] = {}
    for item in raw:
        by_file.setdefault(item[0], []).append(item)
    creates = {fn: {a.target.name for *_, a, _ in items if a.target and a.kind in ("create_view", "create_table", "ctas")} for fn, items in by_file.items()}
    reads = {fn: {r.name for *_, a, _ in items for r in a.refs if not r.is_target} for fn, items in by_file.items()}
    order, pending = [], [f["name"] for f in files if f["name"] in by_file]
    while pending:
        for fn in pending:
            deps = {o for o in pending if o != fn and creates[o] & reads[fn]}
            if not deps:
                order.append(fn)
                pending.remove(fn)
                break
        else:  # a cycle: keep the given order for the rest
            order += pending
            break

    # 3. resolve + rewrite
    steps, unresolved = [], []
    for fn in order:
        for name, n, stmt, a, pname in by_file[fn]:
            st = Step(file=name, n=n, kind=a.kind, status=a.status, reason=a.reason, original=stmt, from_procedure=pname,
                      nondeterministic=a.nondeterministic)
            if a.status == "run":
                repl = []
                for r in a.refs:
                    if r.is_target:
                        fqn = r.name if a.temporary else f"{sandbox}.{r.name}"
                        st.target, st.target_name = fqn, r.name
                        if a.kind == "drop" and r.name not in created and r.name not in prepared:
                            st.status, st.reason = "blocked", f"DROP of {r.written}, which the converted code didn't create"
                        repl.append((r.span, fqn if a.temporary else q(fqn)))
                        continue
                    fqn = resolve(r)
                    if fqn is None:
                        st.status, st.reason = "blocked", f"unknown table {r.written}: map it to a table in Validate → Mapping"
                        unresolved.append({"name": r.written, "file": name, "n": n})
                        continue
                    st.resolved[r.written] = fqn
                    repl.append((r.span, fqn if fqn == r.name else q(fqn)))
                for fr in a.funcs:
                    if fr.name in stand_ins:
                        repl.append((fr.span, q(f"{sandbox}.{fr.name}")))
                        st.resolved[fr.written] = f"{sandbox}.{fr.name} (stand-in)"
                if st.status == "run":
                    st.sql = _rewrite(stmt, repl)
            steps.append(st)

    feeds_plan = []
    for name in sorted(created):
        fd = feed_for(name)
        if fd and created[name] == "TABLE":
            feeds_plan.append({"target_name": name, "target": f"{sandbox}.{name}", "from": fd["from"], "label": fd.get("label", "Feed"), "why": fd.get("why", "")})
    prep = []
    for s in stand_ins.values():
        prep.append({"label": s.get("label", "Stand-in"), "name": s["name"], "sql": s["sql"].replace("{sandbox}", sandbox), "why": s.get("why", "")})
    for name, legacy in prepared.items():
        prep.append({"label": "Empty table in the legacy shape", "name": name, "sql": f"CREATE TABLE {q(sandbox + '.' + name)} AS SELECT * FROM {q(legacy)} WHERE false",
                     "why": "The converted code writes to this table but none of the files creates it (its DDL isn't in the project), so it starts empty, in the legacy table's shape."})
    return {"sandbox": sandbox, "steps": steps, "created": {k: f"{sandbox}.{k}" for k in created}, "created_kinds": created, "written": sorted(written),
            "obj_files": {k: sorted(v) for k, v in obj_files.items()},
            "prepared": prepared, "prep": prep, "feeds": feeds_plan, "unresolved": unresolved, "order": order}


def find_output(o: dict, plan_out: dict, overrides: dict | None = None) -> tuple[str | None, str]:
    """Which converted object stands in for this legacy output. -> (sandbox fqn or None, how)."""
    ov = ((overrides or {}).get("outputs") or {}).get(o["id"])
    if ov:
        return ov, "set by you"
    sb = plan_out["sandbox"]
    names = list(plan_out["created"]) + [n for n in plan_out["prepared"] if n not in plan_out["created"]]
    kinds = {n: plan_out["created_kinds"].get(n, "TABLE") for n in names}
    allowed = o.get("kinds") or ["VIEW", "TABLE"]
    pick = lambda hits: sorted(hits, key=lambda x: (allowed.index(kinds[x]), len(x)))[0]
    legacy = o.get("legacy_object", "").lower()
    if legacy in names and kinds[legacy] in allowed:
        return f"{sb}.{legacy}", "same name as the legacy object"
    # the object made by the file converted from the legacy file (Genie Migrate keeps the file names)
    files = [f.lower() for f in o.get("files") or []]
    if files:
        hits = [n for n in names if kinds[n] in allowed and any(h in fn.lower() for fn in (plan_out.get("obj_files") or {}).get(n, []) for h in files)]
        if hits:
            n = pick(hits)
            return f"{sb}.{n}", f"made by the converted {next(fn for fn in plan_out['obj_files'][n] if any(h in fn.lower() for h in files))}"
    for pat in o.get("match") or []:
        hits = [n for n in names if kinds[n] in allowed and (re.search(pat, n, re.I) or re.search(pat.replace("_", ""), n.replace("_", ""), re.I))]
        if hits:
            n = pick(hits)
            return f"{sb}.{n}", f"name matches '{pat}'"
    return None, "no converted object matches"


# --------------------------------------------------------------------------------------------------- columns + checks
def norm(c: str) -> str:
    return re.sub(r"[^a-z0-9]", "", c.lower())


def name_matches(legacy_cols: list[str], conv_cols: list[str], fixed: dict[str, str | None]) -> dict[str, tuple[str, str]]:
    """legacy col -> (converted col, how) by: your mapping, then exact name, then name without _ and case."""
    out, used = {}, set()
    lc = {c.lower(): c for c in conv_cols}
    for l, c in fixed.items():
        if c and c.lower() in lc:
            out[l] = (lc[c.lower()], "set by you")
            used.add(lc[c.lower()])
    for l in legacy_cols:
        if l in out or l in fixed:
            continue
        c = lc.get(l.lower())
        if c and c not in used:
            out[l] = (c, "same name")
            used.add(c)
    nc = {}
    for c in conv_cols:
        nc.setdefault(norm(c), c)
    for l in legacy_cols:
        if l in out or l in fixed:
            continue
        c = nc.get(norm(l))
        if c and c not in used:
            out[l] = (c, "same name, ignoring case and _")
            used.add(c)
    return out


def ignored(cols: list[str], patterns: list[str], extra: list[str] = ()) -> list[str]:
    ex = {e.lower() for e in extra}
    return [c for c in cols if c.lower() in ex or any(re.search(p, c, re.I) for p in patterns)]


def safe_name(s: str) -> str:
    return re.sub(r"[^a-z0-9_]", "_", s.lower())[:60].strip("_")


def to_type(col: str, from_type: str | None, to_type_: str) -> str:
    """Converted column expressed in the legacy column's type. Same type: as is. Otherwise via text, because Spark
    rejects some direct casts (e.g. double -> date) at compile time, even inside try_cast."""
    if from_type and from_type == to_type_:
        return f"`{col}`"
    return f"try_cast(CAST(`{col}` AS STRING) AS {to_type_})"


def compare_checks(o: dict, keys: list[tuple[str, str]], cols: list[dict], ltypes: dict[str, str], unmatched: list[str],
                   ctypes: dict[str, str] | None = None) -> list[dict]:
    """Generated recon checks for one output. keys: [(legacy, converted)], cols: [{legacy, converted, how}] (non-key).
    Converted values are cast to the legacy column's type, so 1 vs '1' differs only if the cast changes the value."""
    oid = safe_name(o["id"])
    L, C = "${%s_legacy}" % oid, "${%s_conv}" % oid
    ctypes = ctypes or {}
    cast = lambda c, l: to_type(c, ctypes.get(c), ltypes[l])
    pairs = keys + [(c["legacy"], c["converted"]) for c in cols]
    l_list = ", ".join(f"`{l}`" for l, _ in pairs)
    c_list = ", ".join(f"{cast(c, l)} AS `{l}`" for l, c in pairs)
    lbl = o.get("label", o["id"])
    checks = [
        {"name": f"{oid}_row_count", "level": "L2", "severity": "FAIL", "expect": "== 0", "min_coverage": 1,
         "description": f"{lbl}: same number of rows in legacy and converted",
         "sql": f"SELECT abs((SELECT count(*) FROM {L}) - (SELECT count(*) FROM {C})) AS metric, "
                f"concat('legacy ', (SELECT count(*) FROM {L}), ' rows · converted ', (SELECT count(*) FROM {C}), ' rows') AS detail, "
                f"(SELECT count(*) FROM {L}) AS coverage"},
        {"name": f"{oid}_rows_only_in_legacy", "level": "L3", "severity": "FAIL", "expect": "== 0", "min_coverage": 1,
         "description": f"{lbl}: legacy rows with no identical converted row (on the {len(pairs)} matched columns)",
         "sql": f"WITH l AS (SELECT {l_list} FROM {L}), c AS (SELECT {c_list} FROM {C}) "
                f"SELECT count(*) AS metric, concat(count(*), ' legacy rows have no identical converted row') AS detail, (SELECT count(*) FROM l) AS coverage "
                f"FROM (SELECT * FROM l EXCEPT ALL SELECT * FROM c)",
         "sample_sql": f"WITH l AS (SELECT {l_list} FROM {L}), c AS (SELECT {c_list} FROM {C}) SELECT 'legacy only' AS side, * FROM (SELECT * FROM l EXCEPT ALL SELECT * FROM c)"},
        {"name": f"{oid}_rows_only_in_converted", "level": "L3", "severity": "FAIL", "expect": "== 0", "min_coverage": 1,
         "description": f"{lbl}: converted rows with no identical legacy row (on the {len(pairs)} matched columns)",
         "sql": f"WITH l AS (SELECT {l_list} FROM {L}), c AS (SELECT {c_list} FROM {C}) "
                f"SELECT count(*) AS metric, concat(count(*), ' converted rows have no identical legacy row') AS detail, (SELECT count(*) FROM c) AS coverage "
                f"FROM (SELECT * FROM c EXCEPT ALL SELECT * FROM l)",
         "sample_sql": f"WITH l AS (SELECT {l_list} FROM {L}), c AS (SELECT {c_list} FROM {C}) SELECT 'converted only' AS side, * FROM (SELECT * FROM c EXCEPT ALL SELECT * FROM l)"},
    ]
    if keys:
        kl = ", ".join(f"`{l}`" for l, _ in keys)
        kc = ", ".join(f"{cast(c, l)} AS `{l}`" for l, c in keys)
        on = " AND ".join(f"l.`{l}` <=> c.`{l}`" for l, _ in keys)
        for col in cols:
            l, c = col["legacy"], col["converted"]
            checks.append({
                "name": f"{oid}__{safe_name(l)}", "level": "L4", "severity": "FAIL", "expect": "== 0", "min_coverage": 1,
                "description": f"{lbl}: legacy {l} vs converted {c} ({col['how']}), compared at the key",
                "sql": f"WITH l AS (SELECT {kl}, `{l}` AS v FROM {L}), c AS (SELECT {kc}, {cast(c, l)} AS v FROM {C}) "
                       f"SELECT (SELECT count(*) FROM (SELECT * FROM l EXCEPT ALL SELECT * FROM c)) AS metric, "
                       f"'keys where {l} differs' AS detail, (SELECT count(*) FROM l) AS coverage",
                "sample_sql": f"WITH l AS (SELECT {kl}, `{l}` AS v FROM {L}), c AS (SELECT {kc}, {cast(c, l)} AS v FROM {C}), "
                              f"bad AS (SELECT * FROM l EXCEPT ALL SELECT * FROM c) "
                              f"SELECT {', '.join(f'b.`{x}`' for x, _ in keys)}, b.v AS legacy_value, c.v AS converted_value "
                              f"FROM bad b LEFT JOIN c ON {on.replace('l.', 'b.')}"})
    if unmatched:
        checks.append({"name": f"{oid}_legacy_columns_unmatched", "level": "L4", "severity": "WARN", "expect": "== 0",
                       "description": f"{lbl}: legacy columns with no converted counterpart (not compared)",
                       "sql": f"SELECT {len(unmatched)} AS metric, '{', '.join(unmatched)[:900].replace(chr(39), '')}' AS detail"})
    return checks


def execution_checks(steps: list[Step], feeds: list[dict], prep: list[dict]) -> list[dict]:
    failed = [s for s in steps if s.status == "failed"]
    blocked = [s for s in steps if s.status == "blocked"]
    bad_setup = [x for x in feeds + prep if x.get("status") == "failed"]
    esc = lambda t: t.replace("'", "’")[:900]
    det = lambda xs: esc("; ".join(f"{s.file} #{s.n}: {s.reason or s.kind}" for s in xs)) or "none"
    return [
        {"name": "converted_statements_failed", "level": "L1", "severity": "FAIL", "expect": "== 0",
         "description": "Converted statements that failed when run", "sql": f"SELECT {len(failed)} AS metric, '{det(failed)}' AS detail"},
        {"name": "converted_statements_not_run", "level": "L1", "severity": "FAIL", "expect": "== 0",
         "description": "Converted statements the app wouldn't run (blocked): untested code",
         "sql": f"SELECT {len(blocked)} AS metric, '{det(blocked)}' AS detail"},
        {"name": "converted_setup_failed", "level": "L1", "severity": "FAIL", "expect": "== 0",
         "description": "Stand-ins and feeds that failed (assumed functions, the staging load)",
         "sql": f"SELECT {len(bad_setup)} AS metric, '{esc('; '.join(x.get('label', '') + ': ' + x.get('error', '') for x in bad_setup)) or 'none'}' AS detail"},
    ]
