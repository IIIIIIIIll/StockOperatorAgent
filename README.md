# StockOperatorAgent - 多智能体交易决策系统

---

## 安装

请确保你已经安装了Python 3.13或更高版本。然后，克隆此仓库并安装所需的依赖项，推荐使用venv：

```bash
git clone https://github.com/IIIIIIIIll/StockOperatorAgent.git
pip install -r requirements.txt
```

## 使用

1. **配置API密钥**：在`.env`文件中设置 **DeepSeek API 密钥**（默认 LLM，https://platform.deepseek.com）。模型默认 `deepseek-v4-flash`，可用 `DEEPSEEK_MODEL=deepseek-v4-pro` 切换；`DEEPSEEK_BASE_URL` 可覆盖 endpoint（默认 `https://api.deepseek.com`，例：OpenCode Zen 网关 `https://opencode.ai/zen/go/v1`）。可选配置阿里云千问密钥（`DASHSCOPE_API_KEY`，https://bailian.console.aliyun.com）以保留 Qwen 支持。可将密钥填入本地.env.example文件将其重命名为.env。
   - 可选：设置 `TDX_API_KEY`（通达信 MCP）启用实时市场情报（概念板块/资金流/大盘概况）注入 agent 决策。未配置时应用正常降级运行，仅跳过实时情报。
2. 运行主程序：

```bash
 streamlit run main.py
``` 

3. 在浏览器中打开`http://localhost:8501`，即可使用StockOperatorAgent进行多模态交易决策。

![基础界面](docs/start_page.png)

## 功能

1. 基于真实市场数据，提供基本面与趋势分析报告
2. 支持多智能体协作决策
3. 提供可视化的交易决策界面

## 数据源

- **主链路（纯 TDX/pytdx）**：`data_source/chinese_mainland/tdx/` 薄包装
  vendored [tdx_quant](https://github.com/henrylin99/tdx_quant)（pytdx 直连通达信
  行情服务器，快且稳定）。历史行情（前复权 qfq）、**个股概览**（行情/股本/行业/
  估值与市值派生/涨跌幅）与**业绩报告**（F10 派生 + 环比自算）全部由 TDX 提供。
  个股数据**按需单股构建**（分析哪只构建哪只，不做全市场行情扫描）。更新 vendor
  的方式见 `data_source/chinese_mainland/tdx/vendor/VENDOR.md`。
- **akshare**：备用路径，主流程不再调用（原方法保留）。北交所（BJ）行情与
  akshare 特有字段等场景仍可走该路径。BJ 代码（4/8 前缀）TDX 全链路不可用
  （无名称/无行情），UI 输入 BJ 代码会明确提示不支持而非静默 NaN。
- **字段缺失语义**：pytdx 无数据的字段（量比/5分钟涨跌/动量/毛利率等）输出 NaN，
  不报错；名称索引拉取失败时回退股票代码。

## 注意事项
- 请确保你的API密钥安全，不要泄露给他人。
- 由于数据出口限制，首次启动时数据可能需要超过10分钟才能加载完成，请耐心等待。
- 本项目仅供学习和研究使用，不构成任何投资建议。
