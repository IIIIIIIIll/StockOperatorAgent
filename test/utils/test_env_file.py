""".env 原子写测试（离线，tmp_path 注入 env_path，不碰真实 .env）。

覆盖（implement.md Step 2 清单）：新文件追加带注释、既有文件原位替换
（注释/顺序/无关键不动）、重复键全替换、白名单外键拒绝、空 model /
非法 Base URL / TRACING / 空密钥拒绝、LANGSMITH_PROJECT 可空、TRACING
小写归一、原子性（写失败 → 原文件不变 + 无 tmp 残留；env_path 为目录
→ 读失败返回 False）、os.environ 同步（成功后 getenv 新值、失败路径
零改动）、批量混合更新、成功路径无 tmp 残留。

env 隔离：成功写入会改 os.environ——每个成功路径用例 save/restore 白名单
键（对齐 test_billions_config 跨运行确定性约定）。所有用例显式传
env_path=tmp_path，真实 .env 零接触。
"""

import os

from utils import env_file

_ENV_KEYS = sorted(env_file.UPDATE_WHITELIST)


def _snapshot_env() -> dict:
    return {key: os.environ.get(key) for key in _ENV_KEYS}


def _restore_env(saved: dict) -> None:
    for key, value in saved.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value


def _nonempty_lines(path) -> list:
    return [line for line in path.read_text(encoding="utf-8").split("\n") if line]


class TestAppendNewKeys:

    def test_missing_file_creates_with_comments(self, tmp_path):
        env_f = tmp_path / ".env"
        ok, msg = env_file.update_env_file(
            {"LLM_API_KEY": "sk-1", "BILLIONS_API_KEY": "b-1"},
            env_path=env_f,
        )
        assert ok is True and msg == ""
        lines = _nonempty_lines(env_f)
        # 每个新键前带一行简短注释；键行顺序 = updates 传入顺序
        assert lines[0] == "# LLM API Key（OpenAI 兼容服务，如 DeepSeek 官方 key）"
        assert lines[1] == "LLM_API_KEY=sk-1"
        assert lines[-2] == "# 亿信 Fin 开放平台 API Key（可选）"
        assert lines[-1] == "BILLIONS_API_KEY=b-1"

    def test_empty_existing_file_appends(self, tmp_path):
        saved = _snapshot_env()
        env_f = tmp_path / ".env"
        env_f.write_text("")
        try:
            ok, msg = env_file.update_env_file({"TDX_API_KEY": "tdx-1"}, env_path=env_f)
            assert ok is True and msg == ""
            lines = _nonempty_lines(env_f)
            assert lines[-2].startswith("# 通达信")
            assert lines[-1] == "TDX_API_KEY=tdx-1"
        finally:
            _restore_env(saved)

    def test_append_preserves_trailing_content(self, tmp_path):
        # 无尾换行的既有文件：新键接在最后一行后（不破坏原内容）
        env_f = tmp_path / ".env"
        env_f.write_text("KEEP=1")
        ok, _ = env_file.update_env_file({"TDX_API_KEY": "t"}, env_path=env_f)
        assert ok is True
        lines = env_f.read_text().split("\n")
        assert lines[0] == "KEEP=1"
        assert lines[-1] == "TDX_API_KEY=t"

    def test_no_tmp_residue_after_success(self, tmp_path):
        env_f = tmp_path / ".env"
        ok, _ = env_file.update_env_file({"TDX_API_KEY": "k"}, env_path=env_f)
        assert ok is True
        assert list(tmp_path.glob(".env.tmp.*")) == []


class TestReplaceInPlace:

    def test_preserves_comments_order_and_foreign_keys(self, tmp_path):
        env_f = tmp_path / ".env"
        env_f.write_text(
            "# 顶部注释\n"
            "LLM_API_KEY=sk-old\n"
            "\n"
            "LLM_MODEL=deepseek-v4-flash\n"
            "TDX_MCP_DISABLED=1\n"
            "LANGSMITH_TRACING=false\n"
        )
        ok, msg = env_file.update_env_file(
            {"LLM_MODEL": "gpt-4o", "LLM_API_KEY": "sk-new"},
            env_path=env_f,
        )
        assert ok is True and msg == ""
        lines = env_f.read_text().split("\n")
        assert lines == [
            "# 顶部注释",
            "LLM_API_KEY=sk-new",
            "",
            "LLM_MODEL=gpt-4o",
            "TDX_MCP_DISABLED=1",  # 非白名单键原样不动
            "LANGSMITH_TRACING=false",
            "",
        ]

    def test_duplicate_key_all_occurrences_replaced(self, tmp_path):
        # 重复行全部替换（load_dotenv 末行生效，不能留旧值）
        env_f = tmp_path / ".env"
        env_f.write_text("LLM_API_KEY=old1\nKEEP=1\nLLM_API_KEY=old2\n")
        ok, _ = env_file.update_env_file({"LLM_API_KEY": "new"}, env_path=env_f)
        assert ok is True
        assert env_f.read_text() == "LLM_API_KEY=new\nKEEP=1\nLLM_API_KEY=new\n"

    def test_mixed_batch_existing_and_new(self, tmp_path):
        saved = _snapshot_env()
        env_f = tmp_path / ".env"
        env_f.write_text("LLM_API_KEY=sk-old\nLLM_MODEL=deepseek-v4-flash\n")
        try:
            ok, msg = env_file.update_env_file(
                {
                    "LLM_API_KEY": "sk-new",
                    "LLM_MODEL": "gpt-4o",
                    "LLM_BASE_URL": "https://api.openai.com/v1",
                    "LANGSMITH_TRACING": "true",
                },
                env_path=env_f,
            )
            assert ok is True and msg == ""
            lines = env_f.read_text().split("\n")
            # 已有键原位（前两行），新键追加末尾（注释 + 键值），末尾空元素 = 尾换行
            assert lines[:2] == ["LLM_API_KEY=sk-new", "LLM_MODEL=gpt-4o"]
            assert lines[-3] == "# LangSmith 追踪开关（true/false）"
            assert lines[-2] == "LANGSMITH_TRACING=true"
            assert "LLM_BASE_URL=https://api.openai.com/v1" in lines
        finally:
            _restore_env(saved)


class TestValidation:

    def _write_guard(self, tmp_path):
        """带哨兵行的既有文件：拒绝路径必须保持原样。"""
        env_f = tmp_path / ".env"
        env_f.write_text("SENTINEL=1\n")
        return env_f

    def test_non_whitelist_key_rejected(self, tmp_path):
        env_f = self._write_guard(tmp_path)
        ok, msg = env_file.update_env_file({"TDX_MCP_DISABLED": "1"}, env_path=env_f)
        assert ok is False
        assert "TDX_MCP_DISABLED" in msg
        assert env_f.read_text() == "SENTINEL=1\n"  # 文件未动

    def test_empty_model_rejected(self, tmp_path):
        # 模型自由文本（不再枚举供应商模型），但必填非空
        env_f = self._write_guard(tmp_path)
        ok, msg = env_file.update_env_file({"LLM_MODEL": ""}, env_path=env_f)
        assert ok is False
        assert "LLM_MODEL" in msg
        assert env_f.read_text() == "SENTINEL=1\n"

    def test_invalid_base_url_scheme_rejected(self, tmp_path):
        # 裸域名不是 http(s) 前缀——格式级校验拒绝
        env_f = self._write_guard(tmp_path)
        ok, msg = env_file.update_env_file(
            {"LLM_BASE_URL": "api.deepseek.com"}, env_path=env_f)
        assert ok is False
        assert "http" in msg
        assert env_f.read_text() == "SENTINEL=1\n"

    def test_empty_base_url_rejected(self, tmp_path):
        env_f = self._write_guard(tmp_path)
        ok, msg = env_file.update_env_file({"LLM_BASE_URL": ""}, env_path=env_f)
        assert ok is False
        assert "LLM_BASE_URL" in msg
        assert env_f.read_text() == "SENTINEL=1\n"

    def test_valid_base_url_accepted(self, tmp_path):
        saved = _snapshot_env()
        env_f = tmp_path / ".env"
        try:
            ok, msg = env_file.update_env_file(
                {"LLM_BASE_URL": "http://localhost:8000/v1"}, env_path=env_f)
            assert ok is True and msg == ""
            assert "LLM_BASE_URL=http://localhost:8000/v1" in env_f.read_text()
        finally:
            _restore_env(saved)

    def test_invalid_tracing_rejected(self, tmp_path):
        env_f = self._write_guard(tmp_path)
        ok, msg = env_file.update_env_file({"LANGSMITH_TRACING": "yes"}, env_path=env_f)
        assert ok is False
        assert "LANGSMITH_TRACING" in msg
        assert env_f.read_text() == "SENTINEL=1\n"

    def test_empty_api_key_rejected(self, tmp_path):
        env_f = self._write_guard(tmp_path)
        ok, msg = env_file.update_env_file({"LLM_API_KEY": ""}, env_path=env_f)
        assert ok is False
        assert "LLM_API_KEY" in msg
        assert env_f.read_text() == "SENTINEL=1\n"

    def test_blank_api_key_rejected(self, tmp_path):
        env_f = self._write_guard(tmp_path)
        ok, msg = env_file.update_env_file({"BILLIONS_API_KEY": "   "}, env_path=env_f)
        assert ok is False
        assert "BILLIONS_API_KEY" in msg
        assert env_f.read_text() == "SENTINEL=1\n"

    def test_non_string_value_rejected(self, tmp_path):
        env_f = self._write_guard(tmp_path)
        ok, msg = env_file.update_env_file({"LLM_API_KEY": 123}, env_path=env_f)
        assert ok is False
        assert "LLM_API_KEY" in msg
        assert env_f.read_text() == "SENTINEL=1\n"

    def test_empty_project_allowed(self, tmp_path):
        saved = _snapshot_env()
        env_f = tmp_path / ".env"
        try:
            ok, msg = env_file.update_env_file({"LANGSMITH_PROJECT": ""}, env_path=env_f)
            assert ok is True and msg == ""
            assert "LANGSMITH_PROJECT=" in env_f.read_text()
        finally:
            _restore_env(saved)

    def test_tracing_normalized_to_lowercase(self, tmp_path):
        saved = _snapshot_env()
        env_f = tmp_path / ".env"
        try:
            ok, _ = env_file.update_env_file({"LANGSMITH_TRACING": "TRUE"}, env_path=env_f)
            assert ok is True
            assert "LANGSMITH_TRACING=true" in env_f.read_text()
        finally:
            _restore_env(saved)

    def test_error_message_contains_no_value(self, tmp_path):
        # R6：错误消息只含键名不含值（用非法 Base URL 触发校验失败，
        # 值不落入错误消息；合法密钥值会真的写入，不适用于本断言）
        ok, msg = env_file.update_env_file(
            {"LLM_BASE_URL": "sk-secret-value"}, env_path=tmp_path / "x.env"
        )
        assert ok is False
        assert "LLM_BASE_URL" in msg
        assert "sk-secret-value" not in msg


class TestAtomicity:

    def test_replace_failure_leaves_original_and_cleans_tmp(self, tmp_path):
        env_f = tmp_path / ".env"
        env_f.write_text("KEEP=1\n")
        real_replace = env_file.os.replace

        def _boom(src, dst):
            raise OSError("injected replace failure")

        env_file.os.replace = _boom
        try:
            ok, msg = env_file.update_env_file({"LLM_API_KEY": "sk-new"}, env_path=env_f)
            assert ok is False
            assert "写入 .env 失败" in msg
            assert env_f.read_text() == "KEEP=1\n"  # 原文件不变
            assert list(tmp_path.glob(".env.tmp.*")) == []  # tmp 已清理
        finally:
            env_file.os.replace = real_replace

    def test_env_path_is_directory_returns_false(self, tmp_path):
        target = tmp_path / ".env"
        target.mkdir()
        ok, msg = env_file.update_env_file({"LLM_API_KEY": "k"}, env_path=target)
        assert ok is False
        assert "读取 .env 失败" in msg
        assert list(tmp_path.glob(".env.tmp.*")) == []


class TestEnvFilePath:
    """env_file_path() 两态 + update_env_file 默认路径（Step 4 隔离点）。

    ENV_FILE_PATH 覆盖 → 返回覆盖路径；未设置/空白 → REPO_ROOT/.env。
    成功写入路径的用例同步 os.environ 白名单键——save/restore 对齐
    _snapshot_env/_restore_env 约定。
    """

    def test_default_falls_back_to_repo_root(self):
        saved = os.environ.get("ENV_FILE_PATH")
        os.environ.pop("ENV_FILE_PATH", None)
        try:
            assert env_file.env_file_path() == env_file.REPO_ROOT / ".env"
        finally:
            if saved is not None:
                os.environ["ENV_FILE_PATH"] = saved

    def test_env_override_wins(self, tmp_path):
        saved = os.environ.get("ENV_FILE_PATH")
        os.environ["ENV_FILE_PATH"] = str(tmp_path / ".env")
        try:
            assert env_file.env_file_path() == tmp_path / ".env"
        finally:
            if saved is not None:
                os.environ["ENV_FILE_PATH"] = saved
            else:
                os.environ.pop("ENV_FILE_PATH", None)

    def test_blank_env_value_falls_back(self):
        saved = os.environ.get("ENV_FILE_PATH")
        os.environ["ENV_FILE_PATH"] = "   "
        try:
            assert env_file.env_file_path() == env_file.REPO_ROOT / ".env"
        finally:
            if saved is not None:
                os.environ["ENV_FILE_PATH"] = saved
            else:
                os.environ.pop("ENV_FILE_PATH", None)

    def test_update_env_file_default_uses_env_file_path(self, tmp_path):
        # 默认参数走 env_file_path()（ENV_FILE_PATH 覆盖）——e2e 保存路径
        # 隔离的实现点：display 的 _save_settings 不传 env_path 也写 tmp
        saved = _snapshot_env()
        env_saved = os.environ.get("ENV_FILE_PATH")
        target = tmp_path / "custom.env"
        os.environ["ENV_FILE_PATH"] = str(target)
        try:
            ok, msg = env_file.update_env_file({"TDX_API_KEY": "k"})
            assert ok is True and msg == ""
            assert target.exists()
            assert "TDX_API_KEY=k" in target.read_text()
        finally:
            _restore_env(saved)
            if env_saved is not None:
                os.environ["ENV_FILE_PATH"] = env_saved
            else:
                os.environ.pop("ENV_FILE_PATH", None)


class TestEnvironSync:

    def test_environ_updated_after_successful_write(self, tmp_path):
        saved = _snapshot_env()
        env_f = tmp_path / ".env"
        env_f.write_text("LLM_API_KEY=sk-old\n")
        try:
            ok, _ = env_file.update_env_file({"LLM_API_KEY": "sk-new"}, env_path=env_f)
            assert ok is True
            assert os.environ.get("LLM_API_KEY") == "sk-new"
            # 批量：新增键也同步
            ok, _ = env_file.update_env_file(
                {"LLM_BASE_URL": "https://api.deepseek.com", "LANGSMITH_TRACING": "false"},
                env_path=env_f,
            )
            assert ok is True
            assert os.environ.get("LLM_BASE_URL") == "https://api.deepseek.com"
            assert os.environ.get("LANGSMITH_TRACING") == "false"
        finally:
            _restore_env(saved)

    def test_environ_unchanged_on_failure(self, tmp_path):
        saved = _snapshot_env()
        try:
            ok, _ = env_file.update_env_file(
                {"LLM_API_KEY": "x"}, env_path=tmp_path / "missing" / ".env"
            )
            assert ok is False
            assert os.environ.get("LLM_API_KEY") == saved["LLM_API_KEY"]
        finally:
            _restore_env(saved)
