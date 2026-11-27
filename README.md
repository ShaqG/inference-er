# Inference ER

English · [简体中文](README.zh-CN.md)

A series of 60-second browser games about serving large language models. Each case hands you a service on the edge and tests one trade-off at a time. Everything runs offline in a browser and all results are simulated.

- **CASE 01 · Scheduling** · [Play online](https://shaqg.github.io/inference-er/?lang=en) · [Open offline](index.html) · A surge of long prompts is making short chats time out. Take over the service and try scheduling policies on the same workload.
- **CASE 02 · MoE Triage** · [Play online](https://shaqg.github.io/inference-er/triage/?lang=en) · [Open offline](triage/index.html) · A burst of tokens is heading for the same few experts, and their rank is slowing every step. Re-place the experts and decide when to pay for redundant ones.

To play offline, download the repository and open either `index.html` file.

## CASE 01 · Scheduling

1. Click **Take over**. The first long prompt arrives at second 8.
2. Change the decode batch size, prioritize short requests, or limit long requests. Watch backlog, short-request TTFT P95, and output tokens per second.
3. Compare the debrief with the default policy. Replay the same case and change one setting at a time.

### Request replay format

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

### How the simulation works

Prefill and decode draw from a simple shared budget. Decode is capped by the selected batch size. The default uses batch size 4 with prioritization and admission limits off. The debrief counts timeouts, rejections, and requests still in flight separately. TTFT is time to first token. Its P95 includes requests that produced a first token, even if they timed out later.

## CASE 02 · MoE Triage

1. Click **Start triage**. Two experts heat up at second 15, and one dominant expert takes over at second 39.
2. Click **Rebalance now**, and turn on **Redundant experts** when moving experts is not enough. Watch step latency, the imbalance, the idle share, and the load on each rank.
3. Compare the debrief with the default policy. Replay the same tokens and change one setting at a time.

### How the simulation works

Each second is one step of 4096 tokens through a model with 16 experts and top-2 routing across 4 ranks. A seeded generator draws the routing, so every replay sees the same tokens, and no token is dropped. A rank computes every row routed to its experts, a step finishes when its slowest rank does, and the idle share is the rank time the other ranks spend waiting. Rebalancing re-places experts by their load over the last 4 steps. Weights only move when the new layout cuts the slowest rank's load by 5% or more, and every new copy or swapped pair adds weight moves to that step. Redundant experts give each rank a fifth slot for 25% more weight memory and split a hot expert's tokens evenly across its copies. The default policy never rebalances and uses no redundant experts.

The cost model is sized from a reference deployment, not measured: 58 MoE layers with experts of hidden size 7168 and intermediate size 2048 in BF16, about 150 TFLOPS of effective compute, and a 150 GB/s link. That gives about 34 µs per row per step, 1.2 ms of fixed overhead per step, and 34 ms to move one expert's weights. Communication is assumed to overlap with compute. A production rebalance moves weights for every layer and runs minutes apart; the game compresses that into a pause of a few steps.

Run the workload and simulation checks for both cases locally with `node --test`.
