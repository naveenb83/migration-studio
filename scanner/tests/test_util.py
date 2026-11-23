from pathlib import Path

from estate.util import mask_secrets, mask_value, norm_name, read_text, clean_name


def test_mask_inline_password_forms():
    assert mask_secrets("Data Source=x;Password=abc;") == "Data Source=x;Password=***;"
    assert mask_secrets("PWD='a b';") == "PWD=***;"
    assert mask_secrets("EXEC p @pwd = 'zz'") == "EXEC p @pwd = ***"


def test_mask_ssis_par_password_argument():
    text = '/Par "\\"$Package::ConnectionPassword(String)\\"";"Pw-VALUE"'
    masked = mask_secrets(text)
    assert "Pw-VALUE" not in masked
    assert "***" in masked


def test_mask_value_by_name():
    assert mask_value("ConnectionPassword", "anything") == "***"
    assert mask_value("edh_db_cfg", "Password=zzz;") == "Password=***;"
    assert mask_value("RowCount", "0") == "0"


def test_read_text_handles_utf16_bom_and_utf8_bom(tmp_path: Path):
    body = "<root>Café</root>"
    u16 = tmp_path / "u16.dtsx"
    u16.write_bytes(body.encode("utf-16"))  # BOM + little-endian on this platform
    assert read_text(u16) == body
    u8 = tmp_path / "u8.dtsx"
    u8.write_bytes(b"\xef\xbb\xbf" + body.encode("utf-8"))
    assert read_text(u8) == body


def test_name_helpers():
    assert norm_name("[dbo].[STG_A]") == "stg_a"
    assert clean_name("[dbo].[vw_X]") == "dbo.vw_X"
