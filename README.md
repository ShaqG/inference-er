# Inference ER

English · [简体中文](README.zh-CN.md)

A 60-second LLM scheduling game. A surge of long prompts is making short chats time out. Take over the service and try different policies on the same workload.

**[Play online](https://shaqg.github.io/inference-er/?lang=en)** · Or download the repository and open `index.html` to play offline.

1. Click **Take over**. The first long prompt arrives at second 8.
2. Change the decode batch size, prioritize short requests, or limit long requests. Watch backlog, short-request TTFT P95, and output tokens per second.
3. Compare the debrief with the default policy. Replay the same case and change one setting at a time.

## Request replay format

Use **Import request JSON** to load a local [example](examples/request-replay.json) or your own workload. Importing starts a fresh round and recomputes the default policy on the imported requests. Files are read locally in the browser.

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

| Field | Meaning |
| --- | --- |
| `source` | Use `synthetic` for hand-built workloads or `trace-derived` for workloads derived from an experiment. |
| `at` | Arrival second, an integer from 1 to 60. Sort rows by arrival. Rows in the same second retain file order. |
| `kind` | `short` or `long`. Used for scheduling and metric grouping. |
| `prefillWork` | Prefill work in simulated budget units. |
| `outputTokens` | Target output token count. Both work values are integers from 1 to 10,000. |
| `timeout` | Simulated deadline in seconds after arrival, from 1 to 60. A request expires on the first tick after its deadline. |

Keep each file under 128 KiB with 1 to 600 requests. To prepare a replay from a real trace, round arrivals into seconds, choose a documented mapping from prompt length to prefill work, and leave out prompt text and request identifiers. A replay models the arrivals only. All game metrics are simulated.

## How the simulation works

Prefill and decode draw from a simple shared budget. Decode is capped by the selected batch size. The default uses batch size 4 with prioritization and admission limits off. The debrief counts timeouts, rejections, and requests still in flight separately. TTFT is time to first token. Its P95 includes requests that produced a first token, even if they timed out later.

Run the workload and simulation checks locally with `node --test`.
