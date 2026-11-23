"""Delta table specs for the estate_* row sets. The loader and the local writer both use these column lists."""

from __future__ import annotations

S, I, B = "STRING", "INT", "BOOLEAN"
BIG = "BIGINT"

TABLE_SPECS: dict[str, list[tuple[str, str]]] = {
    "estate_scan_log": [
        ("scan_id", S), ("scanned_at", S), ("scanner_version", S), ("code_dirs", S), ("n_artifacts", I),
        ("n_packages", I), ("n_jobs", I), ("n_graphs", I), ("n_errors", I), ("n_warnings", I), ("dataset_status_source", S),
    ],
    "estate_inventory": [
        ("artifact_id", S), ("side", S), ("kind", S), ("name", S), ("package_id", S), ("rel_path", S), ("sha256", S),
        ("bytes", BIG), ("format_version", S), ("parse_status", S), ("n_executables", I), ("n_data_flows", I),
        ("n_components", I), ("n_sql", I), ("n_reads", I), ("n_writes", I), ("n_execs", I), ("schedule_text", S),
        ("n_warnings", I), ("warnings", S), ("error", S),
    ],
    "estate_packages": [
        ("package_id", S), ("package_name", S), ("rel_path", S), ("format_version", S), ("encoding", S),
        ("n_executables", I), ("n_data_flows", I), ("n_components", I), ("n_paths", I), ("n_error_paths", I),
        ("n_precedence", I), ("n_connections", I), ("n_variables", I), ("n_sql", I), ("scheduled_by", S),
        ("graph_path", S), ("graph_bytes", BIG), ("truncated_sql", I), ("warnings", S),
    ],
    "estate_dataflows": [
        ("package_id", S), ("data_flow", S), ("destination_table", S), ("dataset_key", S), ("dataset_status", S),
        ("sources", S), ("stage", B), ("landing", S), ("n_components", I),
    ],
    "estate_statements": [
        ("artifact_id", S), ("package_id", S), ("owner", S), ("owner_kind", S), ("parse_status", S), ("sql_text", S),
        ("reads", S), ("writes", S), ("execs", S), ("error", S),
    ],
    "estate_refs": [
        ("edge_id", S), ("edge_kind", S), ("src", S), ("dst", S), ("side", S), ("confidence", S), ("artifact_id", S), ("note", S),
    ],
    "estate_blocker_map": [
        ("job_name", S), ("schedule_text", S), ("packages", S), ("datasets_loaded", S), ("datasets_total", I),
        ("datasets_migrated", I), ("datasets_remaining", I), ("remaining_datasets", S), ("procedures_called", S),
        ("blocks_retirement", B), ("status_text", S),
    ],
    "estate_schedules": [
        ("source_system", S), ("schedule_name", S), ("job_name", S), ("human", S), ("weekdays", S), ("start_time", S),
        ("timezone", S), ("enabled", B), ("tasks", S), ("order_flag", S), ("artifact_id", S),
    ],
    "estate_landing": [
        ("object_name", S), ("object_kind", S), ("side", S), ("landing", S), ("reason", S), ("artifact_id", S), ("package_id", S),
    ],
}
