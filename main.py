from dotenv import load_dotenv
from core.ui.display import write_ui
from loguru import logger
from utils.constants import LOG_DIR

# 日志路径锚定仓库根 logs/（原 './logs/...' 相对路径随 CWD 漂移，换目录启动
# 日志落别处；2026-08-02 修复）。loguru 自动创建父目录。
# handler 幂等注册（2026-08-02 修复）：Streamlit 每次交互（提交/切 Tab）重新
# 执行 main.py 顶层代码，裸 logger.add 每次 rerun 叠加一个同文件 handler——
# 每条日志按 handler 数重复落盘（实测同毫秒时间戳出现 2-14 份）。已存在同
# 路径 handler 则跳过。loguru 无公开的 handler 枚举 API，用私有
# handler._sink._file_path 判定（属性缺失时 getattr 回落 None → 重新注册，
# 失败模式 = 旧行为）。
def _ensure_file_handler():
    log_path = str(LOG_DIR / "stock_operator_agent.log")
    if any(getattr(handler._sink, "_file_path", None) == log_path
           for handler in logger._core.handlers.values()):
        return
    logger.add(log_path, enqueue=True, rotation="50 MB", retention=10)

_ensure_file_handler()
logger.info("Starting the Stock Analysis Application")
load_dotenv()

def main():
    write_ui()

main()