import importlib.util

from conftest import SCANNER_DIR

LOADER = SCANNER_DIR.parent / "scripts" / "load_estate.py"


def _loader():
    spec = importlib.util.spec_from_file_location("load_estate", LOADER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_sql_literal_escapes_quotes_backslashes_and_newlines():
    le = _loader()
    assert le.sql_literal("it's a \\ path\nline", "STRING") == "'it\\'s a \\\\ path\\nline'"
    assert le.sql_literal(None, "STRING") == "NULL"
    assert le.sql_literal(True, "BOOLEAN") == "true"
    assert le.sql_literal("12", "INT") == "12"
    assert le.sql_literal("x", "INT") == "NULL"


def test_insert_batches_cover_every_row():
    le = _loader()
    rows = [{"a": str(i), "b": i} for i in range(450)]
    stmts = le.insert_statements("c.s.t", [("a", "STRING"), ("b", "INT")], rows)
    assert len(stmts) == 3  # 200 + 200 + 50
    assert sum(s.count("),") + 1 for s in stmts) == 450
