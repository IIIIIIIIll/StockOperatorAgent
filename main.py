from dotenv import load_dotenv
from core.ui.display import write_ui
from loguru import logger
from utils.constants import LOG_DIR

# 日志路径锚定仓库根 logs/（原 './logs/...' 相对路径随 CWD 漂移，换目录启动
# 日志落别处；2026-08-02 修复）。loguru 自动创建父目录。
logger.add(str(LOG_DIR / "stock_operator_agent.log"), enqueue=True, rotation="50 MB", retention=10)
logger.info("Starting the Stock Analysis Application")
load_dotenv()

def main():
    write_ui()

main()