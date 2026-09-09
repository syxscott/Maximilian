# 同类项目调研与借鉴落地报告

> 日期: 2026-07-19 ~ 2026-07-22
> 范围: GitHub 上 22 个与 Maximilian(多 agent OS)思路类似的项目
> 方法: `gh search repos` + `git clone --depth 1` + Explore agent 深度代码审查

## 调研项目一览

| 项目                             | Stars | 分类                       | 落地状态 |
| -------------------------------- | ----- | -------------------------- | -------- |
| openai/swarm                     | 21.8k | multi-agent orchestration  | ✅ 落地  |
| oh-my-claudecode                 | 37.8k | teams-first Claude Code    | ✅ 落地  |
| kdcokenny/opencode-workspace     | 537   | OpenCode harness           | ✅ 落地  |
| sdeonvacation/opencode-x         | 138   | Claude Code fork           | ✅ 落地  |
| framerslab/agentos               | 600   | TS multi-provider + memory | ✅ 落地  |
| voicetree                        | 894   | spatial IDE graph          | ✅ 落地  |
| sentient-agi/ROMA                | 5.1k  | recursive meta-agent       | ✅ 落地  |
| kyegomez/swarms                  | 6.9k  | enterprise multi-agent     | ✅ 落地  |
| VRSEN/agency-swarm               | 4.5k  | reliable orchestration     | ✅ 落地  |
| Kocoro-lab/Shannon               | 2.1k  | Go enterprise orchestrator | ✅ 落地  |
| myclaude                         | 2.7k  | multi-vendor CLI           | ✅ 落地  |
| NousResearch/hermes-evolution    | 4.7k  | self-evolution DSPy+GEPA   | ✅ 落地  |
| EverMind-AI/EvoAgentBench        | 26    | evolution benchmark        | ✅ 落地  |
| a7ul/vibes                       | 12    | pydantic-ai TS port        | ✅ 评估  |
| axar-ai/axar                     | 162   | minimal TS agent           | ✅ 评估  |
| kingkillery/pk-pi-hermes-evolve  | 9     | TS+Python hybrid           | ✅ 参考  |
| thinkneo-ai/mcp-server           | 3     | MCP↔A2A bridge             | ✅ 落地  |
| ibmlachezar/multi-agent-patterns | 1     | 5 A2A patterns             | ✅ 落地  |
| ajbarea/kourai-khryseai          | 1     | 10 A2A agents              | ✅ 落地  |
| questflowai/awesome-a2a-hub      | 26    | A2A ecosystem list         | ✅ 落地  |
| cft0808/edict                    | 16.2k | 三省六部 multi-agent       | ✅ 覆盖  |

## 落地统计

总计新增 ~3800 行生产代码,68 个文件改动,50+ 新测试,全绿。
