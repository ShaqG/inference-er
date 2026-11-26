# 推理急诊室

[English](README.md) · 简体中文

一场 60 秒的 LLM 推理调度小游戏。长 Prompt 突然涌入，短聊天开始超时。接管服务，在同一批请求上比较调度策略。

**[在线试玩](https://shaqg.github.io/inference-er/?lang=zh)** · 也可以下载仓库，打开 `index.html` 离线玩。

1. 点击 **接管服务**。第 8 秒会出现第一条长请求。
2. 调整 Decode 批大小、短请求优先或长请求限流。观察积压、短请求 TTFT P95 和输出吞吐。
3. 查看复盘，与默认策略对比。重开同一局，每次改动一项设置。

## 请求回放格式

点击 **导入请求 JSON**，载入本地[示例](examples/request-replay.json)或自己的请求文件。导入后会开始新一轮，并在同一批请求上重新计算默认策略。浏览器在本地读取文件。

```json
{
  "version": 1,
  "source": "synthetic",
  "requests": [
    {"at": 1, "kind": "short", "prefillWork": 4, "outputTokens": 5, "timeout": 9},
    {"at": 8, "kind": "long", "prefillWork": 34, "outputTokens": 25, "timeout": 23}
  ]
}
```

| 字段 | 含义 |
| --- | --- |
| `source` | 合成请求填 `synthetic`，根据实验轨迹生成的请求填 `trace-derived`。 |
| `at` | 到达时间，取 1 到 60 的整数秒。按到达时间排序，同秒请求按文件顺序处理。 |
| `kind` | `short` 或 `long`，用于调度和指标分组。 |
| `prefillWork` | Prefill 工作量，用模拟预算单位计。 |
| `outputTokens` | 目标输出 token 数。工作量和输出 token 数均取 1 到 10,000 的整数。 |
| `timeout` | 自到达起的模拟超时秒数，取 1 到 60。超过截止时间后的第一个模拟步判定为超时。 |

文件大小上限为 128 KiB，每轮可包含 1 到 600 条请求。从实测生成回放时，将到达时间归入整数秒，记录从输入长度到 Prefill 工作量的换算规则，并去掉 Prompt 正文和原始请求 ID。请求时间可以来自实测，游戏结果仍是模拟值。

## 模拟规则

Prefill 和 Decode 共用简化的算力预算，Decode 每步受批大小限制。默认策略使用批大小 4，关闭优先和限流。超时、主动拒绝和结束时仍在途的请求分别计数。TTFT 是首 token 等待时间，P95 统计已输出首 token 的请求，包括后来超时的请求。

在本地运行 `node --test` 可验证回放格式和模拟行为。
