"""Per-package graph JSON (control flow and data flow in one document).

Contract (schema "migration-studio/estate-graph/v1"):
  nodes: kind in {executable, event_handler, component}
    executable/event_handler: id, name, category, exec_type, parent, disabled, description, connection, sql, sql_length, sql_truncated
    component: id, name, class_id, role (source|transform|destination|command), data_flow, table, sql, sql_length,
               sql_truncated, connection, outputs[{id, name, is_error}]
  edges: kind in {precedence, path}
    precedence: id, from, to (executable ids), value (success|failure|completion), eval_op, expression, logical_and, scope
    path: id, from, to (component ids), from_output, to_input, name, is_error, data_flow
  connections, variables, parameters (secrets already masked), stats, warnings
SQL text is truncated here to keep the file small; the full text is in estate_statements (Delta).
"""

from __future__ import annotations

import json

from .dtsx import ParsedPackage
from .util import mask_secrets

GRAPH_SCHEMA = "migration-studio/estate-graph/v1"
MAX_BYTES = 1_000_000
SQL_LIMIT = 2000
SQL_LIMIT_SMALL = 300


def _sql(text: str | None, limit: int) -> tuple[str | None, int, bool]:
    if not text:
        return None, 0, False
    text = mask_secrets(text)
    if len(text) <= limit:
        return text, len(text), False
    return text[:limit] + " ...[truncated]", len(text), True


def _build(pkg: ParsedPackage, package_id: str, artifact_id: str, limit: int, with_values: bool) -> dict:
    nodes: list[dict] = []
    truncated = 0
    for e in pkg.executables:
        sql, length, cut = _sql(e["sql"], limit)
        truncated += int(cut)
        nodes.append(
            {
                "id": e["id"],
                "kind": e["kind"],
                "name": e["name"],
                "category": e["category"],
                "exec_type": e["exec_type"],
                "parent": e["parent"],
                "disabled": e["disabled"],
                "description": e["description"],
                "connection": e["connection_name"],
                "sql": sql,
                "sql_length": length,
                "sql_truncated": cut,
            }
        )
    for c in pkg.components:
        sql, length, cut = _sql(c["sql"], limit)
        truncated += int(cut)
        nodes.append(
            {
                "id": c["id"],
                "kind": "component",
                "name": c["name"],
                "class_id": c["class_id"],
                "role": c["role"],
                "data_flow": c["data_flow"],
                "table": c["table"],
                "sql": sql,
                "sql_length": length,
                "sql_truncated": cut,
                "connection": c["connection_name"],
                "outputs": c["outputs"],
            }
        )
    edges: list[dict] = []
    for pc in pkg.precedence:
        edges.append({k: pc[k] for k in ("id", "from", "to", "value", "eval_op", "expression", "logical_and", "scope")} | {"kind": "precedence"})
    for p in pkg.paths:
        edges.append(
            {
                "id": p["id"],
                "kind": "path",
                "from": p["from"],
                "to": p["to"],
                "from_output": p["from_output"],
                "to_input": p["to_input"],
                "name": p["name"],
                "is_error": p["is_error"],
                "data_flow": p["data_flow"],
            }
        )
    variables = [
        {"name": v["name"], "scope": v["scope"], "data_type": v["data_type"], "value": v["value"] if with_values else None}
        for v in pkg.variables
    ]
    graph = {
        "schema": GRAPH_SCHEMA,
        "package_id": package_id,
        "package_name": pkg.package_name,
        "artifact_id": artifact_id,
        "source_file": pkg.source_file,
        "format_version": pkg.format_version,
        "encoding": pkg.encoding,
        "nodes": nodes,
        "edges": edges,
        "connections": [
            {k: c[k] for k in ("name", "dts_id", "creation_name", "connection_string", "property_expression", "server", "database")}
            for c in pkg.connections
        ],
        "variables": variables,
        "parameters": [{"name": p["name"], "data_type": p["data_type"], "value": p["value"] if with_values else None} for p in pkg.parameters],
        "stats": {"nodes": len(nodes), "edges": len(edges), "truncated_sql": truncated},
        "warnings": pkg.warnings[:50],
    }
    return graph


def build_graph(pkg: ParsedPackage, package_id: str, artifact_id: str) -> tuple[dict, int]:
    """Return (graph, serialised byte size). Shrinks SQL and drops variable values if the file would exceed 1 MB."""
    graph = _build(pkg, package_id, artifact_id, SQL_LIMIT, True)
    size = len(json.dumps(graph, ensure_ascii=False).encode("utf-8"))
    if size > MAX_BYTES:
        graph = _build(pkg, package_id, artifact_id, SQL_LIMIT_SMALL, False)
        graph["warnings"].append("graph shrunk to fit 1 MB: SQL truncated to 300 chars, variable values omitted")
        size = len(json.dumps(graph, ensure_ascii=False).encode("utf-8"))
    return graph, size


def validate_graph(graph: dict) -> list[str]:
    """Check a graph against the contract. Returns a list of problems (empty means valid)."""
    errors: list[str] = []
    for key in ("schema", "package_id", "nodes", "edges", "connections", "variables", "parameters", "stats", "warnings"):
        if key not in graph:
            errors.append(f"missing key '{key}'")
    if graph.get("schema") != GRAPH_SCHEMA:
        errors.append("wrong schema id")
    nodes = graph.get("nodes", [])
    ids = [n.get("id") for n in nodes]
    if len(ids) != len(set(ids)):
        errors.append("duplicate node ids")
    id_set = set(ids)
    exec_ids = {n["id"] for n in nodes if n.get("kind") in ("executable", "event_handler")}
    comp_ids = {n["id"] for n in nodes if n.get("kind") == "component"}
    for n in nodes:
        if n.get("kind") not in ("executable", "event_handler", "component"):
            errors.append(f"bad node kind on {n.get('id')}")
        if n.get("parent") is not None and n["parent"] not in id_set:
            errors.append(f"node {n.get('id')} has unknown parent")
    for e in graph.get("edges", []):
        if e.get("kind") == "precedence":
            if e.get("from") not in exec_ids or e.get("to") not in exec_ids:
                errors.append(f"precedence {e.get('id')} references unknown executable")
        elif e.get("kind") == "path":
            if e.get("from") not in comp_ids or e.get("to") not in comp_ids:
                errors.append(f"path {e.get('id')} references unknown component")
        else:
            errors.append(f"bad edge kind on {e.get('id')}")
    size = len(json.dumps(graph, ensure_ascii=False).encode("utf-8"))
    if size > MAX_BYTES:
        errors.append(f"graph is {size} bytes, over 1 MB")
    return errors
