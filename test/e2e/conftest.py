"""Playwright UI e2e 测试 fixtures（08-07-playwright-ui-test-framework）。

session 级 fixture：子进程起 streamlit mock 服务器（test/e2e/mock_app.py，
env 注入 dummy DEEPSEEK_API_KEY + dummy BILLIONS_API_KEY）→ 轮询
/_stcore/health 就绪（超时 60s）→ chromium context；每个用例独立 page；
用例失败自动截图 logs/e2e/<test_name>.png；teardown terminate + wait。

第二个 session 级 fixture `server_no_billions`（端口 SERVER_PORT+1，**无**
BILLIONS_API_KEY）——AC1「无 key 现有 UI 零变化」的浏览器级断言（新 Tab
不渲染）专用，env 其余与主服务器一致。

**零 LLM/零网络审计**（pytest_sessionfinish，与用例顺序无关）：读取
服务器日志验证 mock 自检标记（E2E_MOCK_CALL_COUNT 出现且 ≥1——mock
图确实被构造过）且无真实链路痕迹（agent Query/Response、api.deepseek
.com、TdxSource/akshare 抓取、亿信 API 调用日志——见 _REAL_FLOW_MARKERS）。

不装 pytest-playwright 插件——conftest 直接 sync_playwright()（无新
依赖：playwright/pytest/streamlit 均为已有依赖，见设计文档）。

服务器端口可用 SOA_E2E_PORT 覆盖（默认 8502；无 key 服务器 = +1），
避免 CI/本地冲突。
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

REPO_ROOT = Path(__file__).resolve().parents[2]
APP_PATH = REPO_ROOT / "test" / "e2e" / "mock_app.py"
LOG_DIR = REPO_ROOT / "logs" / "e2e"
SERVER_LOG = LOG_DIR / "server.log"
NO_BILLIONS_LOG = LOG_DIR / "server_no_billions.log"

SERVER_PORT = int(os.environ.get("SOA_E2E_PORT", "8502"))
BASE_URL = f"http://127.0.0.1:{SERVER_PORT}"
NO_BILLIONS_PORT = SERVER_PORT + 1  # 无 key 服务器端口（避开主服务器）
HEALTH_TIMEOUT = 60  # streamlit 首次启动（脚本编译）可能较慢

# 亿信全部开关/上限 env（08-08-billions-api-integration，Step 5）：e2e
# 子进程 env 必须显式清除（主服务器注入 dummy BILLIONS_API_KEY → ANALYST
# 开 → 信息面 Tab 渲染路径被真实覆盖；无 key 服务器不带 key → 关）——
# 开发者本机残留的 BILLIONS_* 值不得影响 e2e 确定性
_BILLIONS_ENV_KEYS = (
    "BILLIONS_DISABLED",
    "BILLIONS_FINDB_DISABLED",
    "BILLIONS_SEARCH_DISABLED",
    "BILLIONS_TWITTER_DISABLED",
    "BILLIONS_FETCH_DISABLED",
    "BILLIONS_ANALYST_DISABLED",
    "BILLIONS_FINDB_MAX_CALLS",
    "BILLIONS_SEARCH_MAX_CALLS",
    "BILLIONS_TWITTER_MAX_CALLS",
    "BILLIONS_FETCH_MAX_CALLS",
    "BILLIONS_ANALYST_MAX_CALLS",
)

# 真实链路痕迹（审计用）：mock 路径绝不产生这些日志。
# - "Expert Query"/"Trader Query"/"Manager Query"：真实 agent 每次 LLM
#   调用前必打（agents/*.py debug，loguru 默认 stderr 级别 DEBUG 全捕获）
# - "api.deepseek.com"：DeepSeekApi base_url（真实调用异常 traceback 含）
# - "fetching from network"：tdx_source.py:160 安全列表缓存 miss 时的真实
#   抓取 debug 日志（成功抓取也打）——比类名 "TdxSource"（仅异常 traceback
#   出现）可靠；"akshare" 覆盖备用抓取路径
# - "亿信"/"openapi.billionsintelligence.com"/"BillionsApiError"（08-08-
#   billions-api-integration，Step 5）：真实亿信调用失败打 warning 的行
#   **必含**"亿信"前缀（"亿信 search 检索失败: ..." / "亿信 fin-db 查询
#   失败（002027）: ..." / "亿信 fetch 全文抓取失败: ..." / "亿信 twitter
#   检索失败: ..." / "亿信 {} 检索失败（{}）: ..."）——**唯一可靠捕获点**
#   （实测：dummy key → HTTP 401 → 归一化 BillionsApiError 的 str 为
#   "亿信 API 错误：HTTP 401（Unauthorized）"，不含网关 URL 也不含类名；
#   httpx 网络异常消息同样不含 URL——"openapi.billionsintelligence.com"/
#   "BillionsApiError" 仅异常 traceback 场景出现，保留作补充）；成功路径
#   不打日志——结构性保证（mock 替换 + FakeGraph 零工具）兜底。mock 路径
#   绝不产生"亿信"字样（mock 报告/种子快照/守卫日志均无）
_REAL_FLOW_MARKERS = (
    "api.deepseek.com",
    "Expert Query",
    "Trader Query",
    "Manager Query",
    "fetching from network",
    "akshare",
    "openapi.billionsintelligence.com",
    "BillionsApiError",
    "亿信",
)

# 服务器 fixture 成功启动标记（session.stash）：启动失败（端口占用等）时
# 审计跳过——用例已报失败，不叠加误导性断言
_SERVER_OK = pytest.StashKey[bool]()


def _log_tail(path: Path, n: int = 30) -> str:
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        return "\n".join(lines[-n:])
    except Exception as e:  # 日志文件缺失/损坏时不阻断诊断
        return f"(log unreadable: {e})"


def _wait_healthy(proc: subprocess.Popen, timeout: int = HEALTH_TIMEOUT,
                  port: int | None = None, log_path: Path | None = None) -> None:
    """轮询 /_stcore/health 至 "ok"；进程提前退出/超时 → 带日志定位报错。

    port/log_path（08-08-billions-api-integration，Step 5）：可指定非默认
    端口与独立日志文件（无 key 服务器复用同一健康检查流程）。

    端口占用时 streamlit 打印 "Port X is not available" 后退出的速度可能
    慢于健康检查通过（端口上的旧服务返回 ok）——health ok 后还须确认
    **本进程**存活，否则端口冲突会被误判为启动成功。
    """
    port = SERVER_PORT if port is None else port
    log_path = SERVER_LOG if log_path is None else log_path
    url = f"http://127.0.0.1:{port}/_stcore/health"
    deadline = time.time() + timeout
    last_error = ""
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(
                f"streamlit server exited early (rc={proc.returncode}); "
                f"log tail:\n{_log_tail(log_path)}"
            )
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if resp.read().decode().strip() == "ok":
                    if proc.poll() is not None:
                        raise RuntimeError(
                            f"health ok but streamlit server exited (port conflict? "
                            f"rc={proc.returncode}); log tail:\n{_log_tail(log_path)}"
                        )
                    # 沉降 2s 再确认进程存活：端口冲突时 streamlit 打印
                    # "Port X is not available" 后退出，但退出可能晚于健康
                    # 检查通过（端口上旧服务返回 ok）——等它退出完再判定
                    time.sleep(2)
                    if proc.poll() is not None:
                        raise RuntimeError(
                            f"health ok but streamlit exited shortly after (port "
                            f"conflict? rc={proc.returncode}); log tail:\n{_log_tail(log_path)}"
                        )
                    return
        except Exception as e:  # 未就绪（连接拒绝等）→ 继续轮询
            last_error = repr(e)
        time.sleep(0.5)
    raise RuntimeError(
        f"streamlit health not ok within {timeout}s (last: {last_error}); "
        f"log tail:\n{_log_tail(log_path)}"
    )


def _start_streamlit(env: dict, port: int, log_path: Path) -> tuple[subprocess.Popen, object]:
    """子进程起 streamlit mock 服务器；stdout/stderr 落 log_path（清空重写）。"""
    logf = open(log_path, "wb")
    proc = subprocess.Popen(
        [sys.executable, "-m", "streamlit", "run", str(APP_PATH),
         "--server.headless=true", f"--server.port={port}",
         "--server.address=127.0.0.1", "--browser.gatherUsageStats=false"],
        cwd=str(REPO_ROOT), env=env, stdout=logf, stderr=subprocess.STDOUT,
    )
    return proc, logf


def _stop_streamlit(proc: subprocess.Popen, logf) -> None:
    """terminate + wait（超时 kill），关闭日志文件句柄。"""
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)
    logf.close()


@pytest.fixture(scope="session")
def server(request):
    """session 级：子进程起 streamlit mock 服务器，health 就绪后 yield。

    env 注入 dummy DEEPSEEK_API_KEY——display 模块顶层
    `InvestmentCommittee()` 构造 DeepSeekApi（无 key 抛 OpenAIError），
    dummy key 一箭双雕：满足顶层构造 + 绕过 _has_deepseek_key() 门禁。
    亿信（08-08-billions-api-integration，Step 5）：另注入 dummy
    BILLIONS_API_KEY → ANALYST 开关开 → 信息面 Tab 渲染路径被真实覆盖；
    显式清除全部亿信开关/上限 env——开发者本机残留值不得影响 e2e 确定性。
    stdout/stderr 落盘 server.log（失败诊断 + 零 LLM/网络审计）。
    teardown: terminate + wait（超时 kill）。
    """
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["DEEPSEEK_API_KEY"] = "dummy"
    env["BILLIONS_API_KEY"] = "dummy"
    for name in _BILLIONS_ENV_KEYS:
        env.pop(name, None)
    proc, logf = _start_streamlit(env, SERVER_PORT, SERVER_LOG)
    try:
        _wait_healthy(proc)
        request.session.stash[_SERVER_OK] = True
        yield proc
    finally:
        _stop_streamlit(proc, logf)


@pytest.fixture(scope="session")
def server_no_billions(request):
    """session 级：无 BILLIONS_API_KEY 的第二个 streamlit mock 服务器。

    AC1 浏览器级断言（08-08-billions-api-integration，Step 5）：未配置
    BILLIONS_API_KEY → ANALYST 开关关 → report_tabs() 无信息面条目 →
    「信息面分析」Tab 不渲染（现有 UI 与今日逐字节一致）。env 仅注入
    dummy DEEPSEEK_API_KEY（顶层构造 + 门禁），并显式清除全部亿信开关/
    上限 env——开发者本机残留 key/开关值不得影响"无 key"语义。
    端口 SERVER_PORT+1，日志独立文件（审计同样覆盖零调用）。
    """
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["DEEPSEEK_API_KEY"] = "dummy"
    env.pop("BILLIONS_API_KEY", None)
    for name in _BILLIONS_ENV_KEYS:
        env.pop(name, None)
    proc, logf = _start_streamlit(env, NO_BILLIONS_PORT, NO_BILLIONS_LOG)
    try:
        _wait_healthy(proc, port=NO_BILLIONS_PORT, log_path=NO_BILLIONS_LOG)
        yield proc
    finally:
        _stop_streamlit(proc, logf)


@pytest.fixture(scope="session")
def browser():
    """session 级 chromium（headless）。"""
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        yield b
        b.close()


@pytest.fixture(scope="session")
def browser_context(browser):
    ctx = browser.new_context()
    yield ctx
    ctx.close()


@pytest.fixture
def page(browser_context, server):
    """每个用例独立 page：打开首页并等表单（ticker 输入）渲染。

    交互类等待用「内容出现」条件（表单/报告/图表），不用固定 sleep
    等报告——首个用例承担 streamlit/vega 首启预热。
    """
    pg = browser_context.new_page()
    pg.goto(BASE_URL, timeout=30000)
    pg.locator("input").first.wait_for(timeout=30000)  # st.text_input 渲染
    yield pg
    pg.close()


@pytest.fixture
def page_no_billions(browser_context, server_no_billions):
    """无 BILLIONS_API_KEY 服务器上的独立 page（08-08-billions-api-
    integration，Step 5：新 Tab 不渲染断言用），结构与 page 相同。"""
    pg = browser_context.new_page()
    pg.goto(f"http://127.0.0.1:{NO_BILLIONS_PORT}", timeout=30000)
    pg.locator("input").first.wait_for(timeout=30000)  # st.text_input 渲染
    yield pg
    pg.close()


@pytest.hookimpl(hookwrapper=True, tryfirst=True)
def pytest_runtest_makereport(item, call):
    """用例失败 → 截图 logs/e2e/<test_name>.png（复用仓库 logs/ 惯例）。"""
    outcome = yield
    report = outcome.get_result()
    if report.when == "call" and report.failed:
        page = item.funcargs.get("page")
        if page is not None:
            try:
                LOG_DIR.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(LOG_DIR / f"{item.name}.png"))
            except Exception:
                pass  # 截图失败不叠加误导性错误


def _audit_server_log(path: Path, violations: list, require_mock_marker: bool) -> None:
    """单份服务器日志的零 LLM/零网络审计（08-08-billions-api-integration，
    Step 5 起主/无 key 两份日志共用）。

    require_mock_marker：主服务器日志必须含 mock 自检标记
    E2E_MOCK_CALL_COUNT 且最大计数 ≥1（mock 图确实被构造过——用例跑了
    mock 路径，而非意外短路）；无 key 服务器日志不要求（其用例失败时
    fixture 已报错，不叠加误导断言）。真实链路标记（LLM/TDX/akshare/
    亿信）两份日志都必须为零。日志缺失（fixture 未启动/启动失败）→
    跳过该份（对应用例已报失败）。
    """
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        return
    if require_mock_marker:
        counts = [int(c) for c in re.findall(r"E2E_MOCK_CALL_COUNT=(\d+)", text)]
        if not counts:
            violations.append(f"no E2E_MOCK_CALL_COUNT marker in {path.name} (mock self-check did not run)")
        elif max(counts) < 1:
            violations.append(f"mock graph never built in {path.name} (CALL_COUNT all zero: {counts})")
    for marker in _REAL_FLOW_MARKERS:
        if marker in text:
            violations.append(f"real-flow marker found in {path.name}: {marker!r}")


@pytest.hookimpl(trylast=True)
def pytest_sessionfinish(session, exitstatus):
    """零 LLM/零网络审计（session 收尾，不依赖用例执行顺序）。

    主服务器日志：mock 自检标记 E2E_MOCK_CALL_COUNT 出现且最大计数 ≥ 1
    （mock 图确实被构造过）；无 key 服务器日志：同组真实链路标记检查
    （亿信 openapi/BillionsApiError、agent Query/Response、api.deepseek
    .com、TdxSource/akshare 抓取日志）——真实 LLM/亿信/网络从未被触发。
    服务器未启动（fixture 失败）→ 对应日志检查跳过（用例已报失败，不
    叠加误导性断言）。
    """
    if not session.stash.get(_SERVER_OK, False):
        return
    violations = []
    _audit_server_log(SERVER_LOG, violations, require_mock_marker=True)
    _audit_server_log(NO_BILLIONS_LOG, violations, require_mock_marker=False)
    if violations:
        raise AssertionError("zero-LLM/zero-network audit failed:\n- " + "\n- ".join(violations))
