""".env 原子写（08-08-billions-switches-ui，Step 2）。

设置面板「持久化区」（模型/密钥/LangSmith）保存时调用 `update_env_file`：
读-改-写现有 .env（保留行序/注释/空白与白名单外键），白名单键原位替换
值、新键末尾追加（带一行简短注释），tmp 文件 + os.replace 原子替换，
成功后同步 os.environ（立即生效——display 的 `_has_deepseek_key` 门控
读 os.environ，保存后无需重启）。

设计要点（design.md「.env 原子写」节）：
- **只动白名单键** `UPDATE_WHITELIST`：用户手写键（TDX_MCP_DISABLED 等）
  零改动——UI 无法破坏手写配置
- **值校验**：DEEPSEEK_MODEL ∈ {flash, pro}；LANGSMITH_TRACING 布尔化
  （true/false，小写归一）；密钥类键非空字符串；LANGSMITH_PROJECT 可空
  （用户可能清空项目名）
- **原子性**：写同目录 `.env.tmp.<pid>` → os.replace 原子替换；失败清理
  tmp 且返回 (False, 消息)，不抛异常（UI 提示用）
- **密钥纪律（R6）**：任何路径不 log/不打印写入值；返回消息只含键名
  不含值
- 行解析简单优先：`split("=", 1)` 取键（首段 strip），值原样保留不 trim
  引号——与 load_dotenv 兼容即可（现有 .env 无引号）
- 并发提示（非阻断）：用户 IDE 若打开 .env 且有未保存缓冲，其保存会覆盖
  UI 写入——由 UI caption 提示（display.py Step 3），本模块不处理
"""

from __future__ import annotations

import os
from pathlib import Path

from utils.constants import REPO_ROOT

# UI 可更新的 .env 键（白名单）：键名恒为大写，行内匹配即原位替换。
# 白名单外的键（TDX_MCP_DISABLED 等用户手写配置）一律拒绝写入。
UPDATE_WHITELIST: frozenset[str] = frozenset({
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_MODEL",
    "DASHSCOPE_API_KEY",
    "TDX_API_KEY",
    "BILLIONS_API_KEY",
    "LANGSMITH_TRACING",
    "LANGSMITH_API_KEY",
    "LANGSMITH_PROJECT",
})

# DEEPSEEK_MODEL 合法取值（与 .env.example 注释一致）
_MODELS = ("deepseek-v4-flash", "deepseek-v4-pro")

# 密钥类键：非空字符串校验（UI 不允许清空——清空 = 拒绝保存并提示）
_KEY_KEYS = frozenset({
    "DEEPSEEK_API_KEY",
    "DASHSCOPE_API_KEY",
    "TDX_API_KEY",
    "BILLIONS_API_KEY",
    "LANGSMITH_API_KEY",
})

# 新键末尾追加时的注释行（键 → 简短中文说明，与 .env.example 风格一致）
_NEW_KEY_COMMENTS = {
    "DEEPSEEK_API_KEY": "# DeepSeek（默认 LLM）API Key",
    "DEEPSEEK_MODEL": "# DeepSeek 模型：deepseek-v4-flash / deepseek-v4-pro",
    "DASHSCOPE_API_KEY": "# DashScope API Key（Qwen 可选 LLM）",
    "TDX_API_KEY": "# 通达信 TDX API Key（可选）：实时市场情报",
    "BILLIONS_API_KEY": "# 亿信 Fin 开放平台 API Key（可选）",
    "LANGSMITH_TRACING": "# LangSmith 追踪开关（true/false）",
    "LANGSMITH_API_KEY": "# LangSmith API Key（可选）",
    "LANGSMITH_PROJECT": "# LangSmith 项目名",
}


def _line_key(line: str) -> str | None:
    """KEY=value 行的键；无 '=' 的行（注释/空白/其他）→ None。"""
    if "=" not in line:
        return None
    return line.split("=", 1)[0].strip()


def _validate(updates: dict) -> tuple[dict, str]:
    """校验并归一化更新项：返回 (归一化 dict, "") 或 (None, 错误消息)。

    错误消息可含键名、不含值（R6）。
    """
    normalized = {}
    for key, value in updates.items():
        if key not in UPDATE_WHITELIST:
            return None, f"拒绝写入非白名单键：{key}（UI 只更新已批准配置项）"
        if not isinstance(value, str):
            return None, f"{key} 的值必须是字符串"
        if key == "DEEPSEEK_MODEL":
            if value not in _MODELS:
                return None, f"DEEPSEEK_MODEL 只支持 {' / '.join(_MODELS)}"
        elif key == "LANGSMITH_TRACING":
            low = value.strip().lower()
            if low not in ("true", "false"):
                return None, "LANGSMITH_TRACING 只支持 true / false"
            value = low
        elif key in _KEY_KEYS:
            if not value.strip():
                return None, f"{key} 不能为空"
        # LANGSMITH_PROJECT：任意值（可空）
        normalized[key] = value
    return normalized, ""


def env_file_path() -> Path:
    """.env 路径解析（08-08-billions-switches-ui，Step 4）：env
    `ENV_FILE_PATH` 非空 → 覆盖；否则回退 `REPO_ROOT / ".env"`。

    e2e 关键隔离点：mock 服务器注入 `ENV_FILE_PATH=<tmp 路径>` 后，设置
    面板「保存」只写 tmp 文件、真实 .env 零接触（曾实测：未隔离时保存
    直接改写开发者真实密钥）。持久化区默认路径 = `env_file_path()`——
    display 的保存调用无需感知。
    """
    override = os.environ.get("ENV_FILE_PATH", "").strip()
    if override:
        return Path(override)
    return REPO_ROOT / ".env"


def update_env_file(updates: dict, env_path=None) -> tuple[bool, str]:
    """原子更新 .env 白名单键并同步 os.environ。

    :param updates: {键: 值}，键必须 ∈ UPDATE_WHITELIST（否则拒绝、不动文件）
    :param env_path: .env 路径（默认 env_file_path()——ENV_FILE_PATH 覆盖
        或 REPO_ROOT/.env；测试注入 tmp 路径）
    :return: (True, "") 成功；(False, 中文错误消息) 失败——消息不含键值，
        供 UI st.error 提示
    """
    if env_path is None:
        env_path = env_file_path()
    env_path = Path(env_path)
    normalized, message = _validate(updates)
    if normalized is None:
        return False, message
    if not normalized:
        return True, ""
    try:
        content = env_path.read_text(encoding="utf-8") if env_path.exists() else ""
    except OSError as exc:
        return False, f"读取 .env 失败：{exc}"
    # split("\n") 的末尾空元素即原文件尾换行——先弹出（追加内容直接接在
    # 最后一行后），join 后再补回，避免叠加成空行/双尾换行
    had_trailing_newline = content != "" and content.endswith("\n")
    lines = content.split("\n") if content else []
    if had_trailing_newline and lines and lines[-1] == "":
        lines.pop()
    remaining = dict(normalized)
    for i, line in enumerate(lines):
        key = _line_key(line)
        if key in normalized:
            # 原位替换（重复行全部替换——load_dotenv 末行生效，不能留旧值）
            lines[i] = f"{key}={normalized[key]}"
            remaining.pop(key, None)
    for key, value in remaining.items():
        lines.append(_NEW_KEY_COMMENTS[key])
        lines.append(f"{key}={value}")
    new_content = "\n".join(lines)
    if had_trailing_newline or content == "":
        new_content += "\n"
    tmp_path = env_path.with_name(f".env.tmp.{os.getpid()}")
    try:
        tmp_path.write_text(new_content, encoding="utf-8")
        os.replace(tmp_path, env_path)  # 原子替换（同目录 rename）
    except OSError as exc:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        return False, f"写入 .env 失败：{exc}"
    for key, value in normalized.items():
        os.environ[key] = value  # 同步 env：保存后立即生效，无需重启
    return True, ""
