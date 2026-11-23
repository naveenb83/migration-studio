"""Clean-room SSIS .dtsx parser.

Handles the 2012+ attribute form (DTS:ObjectName="...") and the 2008 form (<DTS:Property DTS:Name="...">).
Extracts: the executables tree (containers, tasks, data flows, event handlers), precedence constraints,
connection managers (secrets masked), variables and parameters, Execute SQL statements, and data-flow
components with their paths (including error outputs).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .util import clean_name, encoding_label, mask_secrets, mask_value, parse_xml_text, read_text
import re

DTS_NS = "www.microsoft.com/SqlServer/Dts"
D = "{%s}" % DTS_NS

SOURCE_CLASSES = {
    "Microsoft.OLEDBSource",
    "Microsoft.FlatFileSource",
    "Microsoft.ExcelSource",
    "Microsoft.ADONETSource",
    "Microsoft.SqlServerSource",
}
DEST_CLASSES = {
    "Microsoft.OLEDBDestination",
    "Microsoft.ADONETDestination",
    "Microsoft.FlatFileDestination",
    "Microsoft.ExcelDestination",
    "Microsoft.SqlServerDestination",
}
# Transforms that run SQL per row (write or execute against the database).
COMMAND_CLASSES = {"Microsoft.OLEDBCommand", "Microsoft.ADONETCommand"}

PRECEDENCE_VALUE = {"0": "success", "1": "failure", "2": "completion"}
EVAL_OP = {"0": "constraint", "1": "expression", "2": "expression_and_constraint", "3": "expression_or_constraint"}
CONN_SERVER_RE = re.compile(r"(?i)(?:data\s+source|server|address|addr)\s*=\s*([^;]+)")
CONN_DB_RE = re.compile(r"(?i)(?:initial\s+catalog|database)\s*=\s*([^;]+)")


def _local(tag) -> str:
    if not isinstance(tag, str):
        return ""
    return tag.split("}")[-1]


def prop(el, name: str) -> str | None:
    """Read a property in either DTS format: attribute (2012+) or <DTS:Property DTS:Name=...> child (2008)."""
    if el is None:
        return None
    value = el.get(D + name)
    if value is not None:
        return value
    for child in el.findall(D + "Property"):
        if child.get(D + "Name") == name:
            return child.text or ""
    return None


def attr_by_local(el, localname: str) -> str | None:
    """Attribute lookup that ignores namespace (SqlTaskData and pipeline attributes live in their own namespaces)."""
    for key, value in el.attrib.items():
        if _local(key) == localname:
            return value
    return None


def value_of(el, localname: str) -> str | None:
    """Attribute (any namespace), child element (any namespace) or <DTS:Property DTS:Name=...> with that name."""
    v = attr_by_local(el, localname)
    if v is not None:
        return v
    for sub in el:
        if _local(sub.tag) == localname:
            return sub.text or ""
        if sub.tag == D + "Property" and sub.get(D + "Name") == localname:
            return sub.text or ""
    return None


def categorize_executable(exec_type: str | None) -> str:
    t = exec_type or ""
    if t.startswith("STOCK:"):
        return "container"
    return {
        "Microsoft.Pipeline": "data_flow",
        "Microsoft.ExecuteSQLTask": "execute_sql",
        "Microsoft.ExecutePackageTask": "execute_package",
        "Microsoft.ScriptTask": "script",
        "Microsoft.FileSystemTask": "file_system",
        "Microsoft.SendMailTask": "send_mail",
        "Microsoft.Package": "package",
    }.get(t, "other")


@dataclass
class ParsedPackage:
    package_name: str
    source_file: str
    format_version: str
    encoding: str
    executables: list[dict] = field(default_factory=list)
    components: list[dict] = field(default_factory=list)
    paths: list[dict] = field(default_factory=list)
    precedence: list[dict] = field(default_factory=list)
    connections: list[dict] = field(default_factory=list)
    variables: list[dict] = field(default_factory=list)
    parameters: list[dict] = field(default_factory=list)
    sql_blobs: list[dict] = field(default_factory=list)  # {owner, owner_kind, text, label}
    warnings: list[str] = field(default_factory=list)


def _connections(root) -> tuple[list[dict], dict[str, str], dict[str, str]]:
    records: list[dict] = []
    name_by_dts: dict[str, str] = {}
    name_by_ref: dict[str, str] = {}
    container = root.find(D + "ConnectionManagers")
    if container is None:
        return records, name_by_dts, name_by_ref
    for cm in container.findall(D + "ConnectionManager"):
        name = prop(cm, "ObjectName") or ""
        dts_id = cm.get(D + "DTSID") or prop(cm, "DTSID") or ""
        ref = cm.get(D + "refId") or name
        expression = None
        for pe in cm.findall(D + "PropertyExpression"):
            if pe.get(D + "Name") == "ConnectionString":
                expression = (pe.text or "").strip() or None
        conn_string = None
        obj = cm.find(D + "ObjectData")
        if obj is not None:
            for child in obj:
                value = value_of(child, "ConnectionString")
                if value is not None:
                    conn_string = value
        raw = conn_string or ""
        server = CONN_SERVER_RE.search(raw)
        database = CONN_DB_RE.search(raw)
        records.append(
            {
                "name": name,
                "ref_id": ref,
                "dts_id": dts_id,
                "creation_name": cm.get(D + "CreationName") or "",
                "connection_string": mask_secrets(conn_string),  # masked before it is stored anywhere
                "property_expression": mask_secrets(expression),
                "server": server.group(1).strip() if server else None,
                "database": database.group(1).strip() if database else None,
            }
        )
        name_by_dts[dts_id] = name
        name_by_ref[ref] = name
    return records, name_by_dts, name_by_ref


def _variables(scope_el, scope: str, out: list[dict]) -> None:
    container = scope_el.find(D + "Variables")
    if container is None:
        return
    for var in container.findall(D + "Variable"):
        name = prop(var, "ObjectName") or ""
        value_el = var.find(D + "VariableValue")
        value = value_el.text if value_el is not None else None
        out.append(
            {
                "name": name,
                "namespace": var.get(D + "Namespace") or "",
                "scope": scope,
                "data_type": var.get(D + "DataType") or "",
                "value": mask_value(name, value[:200]) if value else None,
            }
        )


def parse_dtsx(path: Path) -> ParsedPackage:
    text = read_text(path)
    root = parse_xml_text(text)
    is_2012 = root.get(D + "ObjectName") is not None
    pkg = ParsedPackage(
        package_name=prop(root, "ObjectName") or path.stem,
        source_file=path.name,
        format_version="2012+" if is_2012 else "2008",
        encoding=encoding_label(path),
    )
    pkg.connections, name_by_dts, name_by_ref = _connections(root)

    params = root.find(D + "PackageParameters")
    if params is not None:
        for p in params.findall(D + "PackageParameter"):
            name = prop(p, "ObjectName") or ""
            raw = None
            for child in p.findall(D + "Property"):
                if child.get(D + "Name") == "ParameterValue":
                    raw = child.text
            pkg.parameters.append(
                {
                    "name": name,
                    "data_type": p.get(D + "DataType") or "",
                    "value": mask_value(name, raw) if raw else None,
                }
            )

    def walk_exec(el, parent_id: str | None) -> None:
        ref = el.get(D + "refId") or prop(el, "refId") or prop(el, "ObjectName") or f"exec{len(pkg.executables)}"
        exec_type = el.get(D + "ExecutableType") or prop(el, "ExecutableType") or ""
        creation = el.get(D + "CreationName") or prop(el, "CreationName") or ""
        category = categorize_executable(exec_type or creation)
        name = prop(el, "ObjectName") or ref
        rec = {
            "id": ref,
            "kind": "executable",
            "name": name,
            "exec_type": exec_type or creation,
            "category": category,
            "parent": parent_id,
            "dts_id": el.get(D + "DTSID") or prop(el, "DTSID") or "",
            "disabled": (prop(el, "Disabled") or "").lower() == "true",
            "description": prop(el, "Description"),
            "connection_name": None,
            "sql": None,
            "sql_source_type": None,
        }
        pkg.executables.append(rec)
        _variables(el, ref, pkg.variables)

        if category == "execute_sql":
            od = el.find(D + "ObjectData")
            if od is not None:
                for child in od:
                    sql_text = value_of(child, "SqlStatementSource")
                    if sql_text is None:
                        continue
                    rec["sql"] = sql_text
                    rec["sql_source_type"] = value_of(child, "SqlStatementSourceType") or "DirectInput"
                    conn = value_of(child, "Connection") or ""
                    rec["connection_name"] = name_by_dts.get(conn, conn or None)
                    break
            if rec["sql"]:
                pkg.sql_blobs.append({"owner": ref, "owner_kind": "execute_sql", "text": rec["sql"], "label": name})
            elif rec["sql_source_type"] not in (None, "DirectInput"):
                pkg.warnings.append(f"Execute SQL '{name}' reads its SQL from {rec['sql_source_type']}; not scanned")

        if category == "data_flow":
            pipeline = None
            od = el.find(D + "ObjectData")
            if od is not None:
                for sub in od.iter():
                    if _local(sub.tag) == "pipeline":
                        pipeline = sub
                        break
            if pipeline is not None:
                _pipeline(pipeline, ref, pkg, name_by_dts, name_by_ref)
            else:
                pkg.warnings.append(f"Data flow '{name}' has no pipeline element")

        children = el.find(D + "Executables")
        if children is not None:
            for child in children.findall(D + "Executable"):
                walk_exec(child, ref)

        handlers = el.find(D + "EventHandlers")
        if handlers is not None:
            for eh in handlers.findall(D + "EventHandler"):
                event = eh.get(D + "EventName") or prop(eh, "EventName") or "event"
                eh_ref = eh.get(D + "refId") or f"{ref}.EventHandlers[{event}]"
                pkg.executables.append(
                    {
                        "id": eh_ref,
                        "kind": "event_handler",
                        "name": prop(eh, "ObjectName") or event,
                        "exec_type": "EventHandler",
                        "category": "event_handler",
                        "parent": ref,
                        "dts_id": eh.get(D + "DTSID") or "",
                        "disabled": False,
                        "description": event,
                        "connection_name": None,
                        "sql": None,
                        "sql_source_type": None,
                    }
                )
                _variables(eh, eh_ref, pkg.variables)
                eh_ex = eh.find(D + "Executables")
                if eh_ex is not None:
                    for child in eh_ex.findall(D + "Executable"):
                        walk_exec(child, eh_ref)

    walk_exec(root, None)  # the package element is the root executable

    seen = set()
    for pc in root.iter(D + "PrecedenceConstraint"):
        ref = pc.get(D + "refId") or f"pc{len(pkg.precedence)}"
        if ref in seen:
            continue
        seen.add(ref)
        holder = pc.getparent()  # <PrecedenceConstraints>
        owner = holder.getparent() if holder is not None else None  # the container that owns the constraint
        expr = pc.get(D + "Expression")
        pkg.precedence.append(
            {
                "id": ref,
                "kind": "precedence",
                "from": pc.get(D + "From") or "",
                "to": pc.get(D + "To") or "",
                "value": PRECEDENCE_VALUE.get(pc.get(D + "Value") or "0", "success"),
                "eval_op": EVAL_OP.get(pc.get(D + "EvalOp") or "0", "constraint"),
                "expression": mask_secrets(expr) if expr else None,
                "logical_and": (pc.get(D + "LogicalAnd") or "True").lower() == "true",
                "scope": owner.get(D + "refId") if owner is not None else None,
            }
        )
    if not pkg.executables:
        pkg.warnings.append("No executables found")
    return pkg


def _pipeline(pipeline, owner_ref: str, pkg: ParsedPackage, name_by_dts: dict, name_by_ref: dict) -> None:
    comp_by_output: dict[str, str] = {}
    comp_by_input: dict[str, str] = {}
    output_error: dict[str, bool] = {}
    comps_el = pipeline.find("components")
    for c in (comps_el.findall("component") if comps_el is not None else []):
        ref = c.get("refId") or f"{owner_ref}\\component{len(pkg.components)}"
        class_id = c.get("componentClassID") or ""
        props: dict[str, str] = {}
        props_el = c.find("properties")
        if props_el is not None:
            for p in props_el.findall("property"):
                props[p.get("name") or ""] = p.text or ""
        conn_refs = [
            (conn.get("connectionManagerRefId") or conn.get("connectionManagerID") or "")
            for conn in c.findall("connections/connection")
        ]
        outputs = []
        for out in c.findall("outputs/output"):
            oref = out.get("refId") or ""
            is_err = (out.get("isErrorOut") or "false").lower() == "true"
            outputs.append({"id": oref, "name": out.get("name") or "", "is_error": is_err})
            comp_by_output[oref] = ref
            output_error[oref] = is_err
        for inp in c.findall("inputs/input"):
            comp_by_input[inp.get("refId") or ""] = ref

        if class_id in SOURCE_CLASSES:
            role = "source"
        elif class_id in DEST_CLASSES:
            role = "destination"
        elif class_id in COMMAND_CLASSES:
            role = "command"
        else:
            role = "transform"

        open_rowset = (props.get("OpenRowset") or "").strip()
        open_var = (props.get("OpenRowsetVariable") or "").strip()
        sql_cmd = (props.get("SqlCommand") or "").strip() or None
        table = clean_name(open_rowset) if open_rowset and not open_var else None
        conn_name = None
        if conn_refs and conn_refs[0]:
            conn_name = name_by_ref.get(conn_refs[0]) or name_by_dts.get(conn_refs[0]) or conn_refs[0]
        pkg.components.append(
            {
                "id": ref,
                "kind": "component",
                "name": c.get("name") or ref.split("\\")[-1],
                "class_id": class_id,
                "role": role,
                "data_flow": owner_ref,
                "table": table,
                "sql": sql_cmd,
                "access_mode": props.get("AccessMode"),
                "connection_name": conn_name,
                "outputs": outputs,
            }
        )
        if sql_cmd:
            pkg.sql_blobs.append(
                {"owner": ref, "owner_kind": f"data_flow_{role}", "text": sql_cmd, "label": c.get("name") or ref}
            )

    paths_el = pipeline.find("paths")
    for p in (paths_el.findall("path") if paths_el is not None else []):
        start = p.get("startId") or ""
        end = p.get("endId") or ""
        pkg.paths.append(
            {
                "id": p.get("refId") or f"path{len(pkg.paths)}",
                "kind": "path",
                "data_flow": owner_ref,
                "from": comp_by_output.get(start, start.split(".Outputs[")[0]),
                "from_output": start,
                "to": comp_by_input.get(end, end.split(".Inputs[")[0]),
                "to_input": end,
                "name": p.get("name") or "",
                "is_error": bool(output_error.get(start, False)),
            }
        )
