from dotenv import load_dotenv
from core.ui.display import write_ui
from loguru import logger

logger.add("./logs/stock_operator_agent.log", enqueue=True, rotation="50 MB", retention=10)
logger.info("Starting the Stock Analysis Application")
load_dotenv()

def main():
    write_ui()

main()