from typing import Annotated, Optional
from typing_extensions import TypedDict
from langgraph.graph.message import add_messages

class State(TypedDict):
    target_stock_ticker: Optional[str]
    stock_information: Optional[str]
    messages: Annotated[list, add_messages]
    fundamental_analysis: Optional[str]
    trend_analysis: Optional[str]
    bullish_opinions: Annotated[list, add_messages]
    bearish_opinions: Annotated[list, add_messages]
    final_decision: Optional[str]