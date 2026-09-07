# Changelog

All notable changes to Maximilian are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Per-phase detail lives under `docs/changelogs/` — this file is the high-level summary.

## 1.0.0 (2026-09-07)


### Features

* absorb best practices from 9 upstream repos across runtime, API, UI and gateway ([7b8fcf9](https://github.com/syxscott/Maximilian/commit/7b8fcf9596b2662eb64ee99aaf7e2ab0c8ed6a79))
* **acp:** add agent-to-agent message types and A2A handler ([b1ae4f9](https://github.com/syxscott/Maximilian/commit/b1ae4f995a0565a89a04ef858fa0d28f9fab44d9))
* add HITL approvals and resource-aware execution ([62865f6](https://github.com/syxscott/Maximilian/commit/62865f691095fc24ca3be194aacd6365b88eed59))
* **api,dashboard:** OpencodeStateStore + REST routes + React hook/component ([42de329](https://github.com/syxscott/Maximilian/commit/42de329e1af1299224757832ccff39e044ecbd3b))
* **api,worker,packages:** wire self-evolution loop and harden backend ([e39ebf9](https://github.com/syxscott/Maximilian/commit/e39ebf94dd295bef28b426959e38ee8a9e64157d))
* **api:** preflight validation gate before plan execution ([59a6427](https://github.com/syxscott/Maximilian/commit/59a6427544331aeb58654ea461928095441be0f8))
* **build:** add tsc build for sdk/llm/queue so size-limit can measure them ([6c30d5d](https://github.com/syxscott/Maximilian/commit/6c30d5da4fa6b93f82e83c5a08accd2db0589e66))
* Commander schema 扩展 + preflight 校验 + 任务 condition (借鉴 [#1](https://github.com/syxscott/Maximilian/issues/1) [#14](https://github.com/syxscott/Maximilian/issues/14) [#9](https://github.com/syxscott/Maximilian/issues/9) [#3](https://github.com/syxscott/Maximilian/issues/3)) ([a799b38](https://github.com/syxscott/Maximilian/commit/a799b38829f779c00a022ef39d74f4a13ea6bb08))
* **commander:** OpencodeDecomposer with preflight validation ([5aba828](https://github.com/syxscott/Maximilian/commit/5aba828a8ab87cb452009ddee6b0863670e250bd))
* commit remaining files and fix CI ([f1ed6e5](https://github.com/syxscott/Maximilian/commit/f1ed6e51f91b4b2dd84bb642e432f4ba4b888084))
* complete remaining distinctive features + documentation clarity ([09aea2a](https://github.com/syxscott/Maximilian/commit/09aea2abf2e4e8dbbc1f11f8f6fb8653c78b48c1))
* **core-thin-sdk:** EventBridge.subscribe() for sync consumers ([f84fff0](https://github.com/syxscott/Maximilian/commit/f84fff01d47512ee1f4681dbf2d3643117a4328b))
* **core-thin-sdk:** Phase 1 PoC — opencode serve sidecar integration ([b65debb](https://github.com/syxscott/Maximilian/commit/b65debb1b85260a400b8fe2ff4f3c1f3d3af3c07))
* **core+providers:** deepseek-harness LLM patterns + pi session export ([7faf92d](https://github.com/syxscott/Maximilian/commit/7faf92d5149ac5573f2af7caa7c402e96aa42a58))
* **core:** AgentRuntime accepts opencode option to route via OpencodeExecutor ([2d12de6](https://github.com/syxscott/Maximilian/commit/2d12de6e26586100320aefddd495bb1cf7e9570a))
* **core:** load Claude Code skills from ~/.claude/skills/ ([7e080fd](https://github.com/syxscott/Maximilian/commit/7e080fd369f00c7e91d45442a4f16bc4ad38b6fd))
* **core:** OpencodeExecutor — Maximilian Task → opencode serve adapter ([8b7db95](https://github.com/syxscott/Maximilian/commit/8b7db959a1fae1e982525937a3613bbdb1960369))
* **core:** OpencodePhaseRunner + OpencodeDagExecutor ([e68a778](https://github.com/syxscott/Maximilian/commit/e68a77807d13163bee85a78e72558280d91e2c19))
* **core:** OpencodeTeamBridge + OpencodeAcpAdapter for team/ACP ([cdeb474](https://github.com/syxscott/Maximilian/commit/cdeb474100af765f77e02dcd02b7becf29c124f8))
* **core:** sanitizeDisplayLabel helper + release-please PAT fallback ([103fef3](https://github.com/syxscott/Maximilian/commit/103fef39887538c36cb979efe6c013ff25d484b9))
* **core:** wire FailureDetector into self-critique replan trigger ([953a9ed](https://github.com/syxscott/Maximilian/commit/953a9ed03d9d1e4a535bacad20ba8608e509fe50))
* **core:** wire opencode Context Compaction (prune + tool truncate) ([040c4a2](https://github.com/syxscott/Maximilian/commit/040c4a2dbb057e75fd884d931d611bad165ff242))
* **core:** wire opencode DOOM_LOOP_THRESHOLD=3 into StallDetector (Wave 5 O) ([2cf2c0f](https://github.com/syxscott/Maximilian/commit/2cf2c0f69d5e72495322857331370819c654111d))
* **core:** wire opencode git-based SnapshotSaver for file-level revert ([1bce6f0](https://github.com/syxscott/Maximilian/commit/1bce6f08e2523946a356e5ce56d9a44f6733ce92))
* **core:** wire opencode InstanceState (per-project scope + finalizers) ([235601d](https://github.com/syxscott/Maximilian/commit/235601de2ee9a59a282bccb89276723503c71b58))
* **core:** wire opencode ModelStatus enum into ModelRouter (Wave 5 L) ([e314821](https://github.com/syxscott/Maximilian/commit/e31482164cdf5b4f2d066c0f6ad858654c3951f1))
* **core:** wire opencode SessionStatus FSM ([404eaa9](https://github.com/syxscott/Maximilian/commit/404eaa90fb62e0e80f2e54670c3a112232ebfcfe))
* **core:** wire opencode SkillDiscovery (URL pull + 7d cache) ([e687d89](https://github.com/syxscott/Maximilian/commit/e687d89beffc2ee55d526d8aebf072fe3dbdcd9f))
* **core:** wire opencode TodoList state machine ([7c32e76](https://github.com/syxscott/Maximilian/commit/7c32e76381e723f200a5a0258f02ff7b94010042))
* **evolution:** OpencodeTraceCollector + VariantRunner for opencode sessions ([31ea992](https://github.com/syxscott/Maximilian/commit/31ea992bb0658133ff6dacf70f9c972da6bab53e))
* FailoverReason/工具allowlist/saveState(借鉴 hermes-agent/cc-switch/openclaw) ([4042021](https://github.com/syxscott/Maximilian/commit/40420213cf2d7564ade1a1142f0a267a2884e9bc))
* implement 30+ borrowed patterns from 22 researched OSS projects + security fixes ([05d76ba](https://github.com/syxscott/Maximilian/commit/05d76bab889c794aab1d8ac54e3f366f5777d797))
* implement grok-build design patterns ([489de7e](https://github.com/syxscott/Maximilian/commit/489de7e8fae659831ace3637145c8930b46c7087))
* **llm:** wire opencode StructuredOutput tool with Zod schema ([6a63f3d](https://github.com/syxscott/Maximilian/commit/6a63f3db3e03e53e640501b34113f92fdd5a93de))
* MemoryScope/ADR/repo memory 三件套(借鉴 crewAI/wshobson/codebase-memory-mcp) ([7bce21b](https://github.com/syxscott/Maximilian/commit/7bce21b58d04f47a43f7eaf22edd8885eed31c1e))
* **meta-system:** MetaSystemOpencodeBridge + OpencodeDigitalTwin ([7ae832d](https://github.com/syxscott/Maximilian/commit/7ae832d8749daca32f4c1065b1558d5b9ca41724))
* **monitor:** live usage pill (dashboard) + status bar (TUI) ([2e316b2](https://github.com/syxscott/Maximilian/commit/2e316b269e97dcc44746c3d6359fb12eb775aca8))
* **pro:** ship all 30 professionalization gaps ([006ec52](https://github.com/syxscott/Maximilian/commit/006ec52aeaf5c9c28df25c63a13c28d243cef854))
* **providers:** expand to 188 borrowed CC Switch presets ([d22dbfe](https://github.com/syxscott/Maximilian/commit/d22dbfe0d36e1c7478751d40c20059fa3873b46d))
* **providers:** preset-driven registry with 60+ borrowed LLM presets ([6384213](https://github.com/syxscott/Maximilian/commit/6384213874fd56943b56000581134fd1ef00bde5))
* **providers:** wire opencode ProviderTransform middleware registry ([d6ac8ff](https://github.com/syxscott/Maximilian/commit/d6ac8ff88ad0d85dba9a23f4195a23ead4db730f))
* **providers:** wire opencode retry-after header parsing ([5a0f4b2](https://github.com/syxscott/Maximilian/commit/5a0f4b2659765859a897688a0e0d0e074900d0ed))
* **queue:** wire opencode BackgroundJob lifecycle registry ([11243a8](https://github.com/syxscott/Maximilian/commit/11243a85e3d3eadab0423996e971db96bf528eac))
* **review:** integrate ScholarEval 8-dim scoring into ReviewIntelligence ([b67fd94](https://github.com/syxscott/Maximilian/commit/b67fd948602ce6a0e662f9fab3b1e97a99662b7d))
* SandboxService + PlannerObserver(借鉴 OpenHands/crewAI) ([d05457b](https://github.com/syxscott/Maximilian/commit/d05457b5db8c8d8bd6d830ed9618868a95b2d3da))
* **tools,core:** OpencodePermissionTranslator + SandboxToOpencodePlugin ([71ace61](https://github.com/syxscott/Maximilian/commit/71ace6130213a654a52b29aea504ed1a02387346))
* **tools,core:** wire opencode subagent permission scope derivation ([7f9bebd](https://github.com/syxscott/Maximilian/commit/7f9bebd39d7f1c68e91df1e5a93ec40ebed4328c))
* **tools:** wire opencode LSP client (JSON-RPC over stdio) ([05fbd37](https://github.com/syxscott/Maximilian/commit/05fbd37156af7e46aacd5f2a1687384b061de6b2))
* **tui,dashboard,sdk:** ui honesty fixes and python sdk sync ([2cd47d3](https://github.com/syxscott/Maximilian/commit/2cd47d3d92399457f09e93085e60a2a5e3a87946))
* Wave 1 — ScholarEval/FailureDetector/EventBus (借鉴 Kosmos) ([3f76a2f](https://github.com/syxscott/Maximilian/commit/3f76a2f0f73f53947229efdc0f971c203921bab6))
* Wave 2 — NullModel/PlanReviewer/DelegationManager (借鉴 Kosmos) ([f9db6ae](https://github.com/syxscott/Maximilian/commit/f9db6aeca7ff64c4e4854cac0463a6b93bd002d1))
* Wave 3 — AgentRegistry/NoveltyDetector/Safety/Reproducibility (借鉴 Kosmos) ([d89be79](https://github.com/syxscott/Maximilian/commit/d89be79a26a284c4dd893e6034c5bca767cdb02f))
* Wave 4 — KnowledgeGraph/ArtifactState/Metrics/Hypothesis/Ensemble (借鉴 Kosmos) ([b280ed9](https://github.com/syxscott/Maximilian/commit/b280ed9fa19c89ccad85adef84df19d842a95bf2))
* **workspace:** wire opencode WorkspaceAdapter abstraction (Local) ([c2e33b8](https://github.com/syxscott/Maximilian/commit/c2e33b8337f4f25584ace0359d3ceac07e1bda05))
* 借鉴 crewAI/openclaw/Magentic-One 的工具缓存/steering hooks/三态 stall ([09f840d](https://github.com/syxscott/Maximilian/commit/09f840dcb5a76a648a435e514a9a79840fc886e9))
* 借鉴 Magentic-One / AutoGen / OpenAI Agents SDK 的 agent 任务分配与难度评估 ([506ef00](https://github.com/syxscott/Maximilian/commit/506ef0006ea5628e0eacb8bd3efa677de98c4c8e))


### Bug Fixes

* 13-bug sweep across queue, runtime, shutdown, CI, lint hooks ([248307f](https://github.com/syxscott/Maximilian/commit/248307ff96b8ab266dfa9b950824d87d24432c70))
* **a2a-handler:** add event to agent/send/resp, make notify fire-and-forget, fix EventBus type ([00309d5](https://github.com/syxscott/Maximilian/commit/00309d57c4acead04befc4b2b85dd442a69a72e7))
* **agent-registry:** deliver messages to recipient receiver ([db3399d](https://github.com/syxscott/Maximilian/commit/db3399d662aa7a1c9795e31dc19b2abcff919077))
* **api:** pg-smoke used wrong db.execute payload shape (same as pg-integration) ([1de0a47](https://github.com/syxscott/Maximilian/commit/1de0a47eaa23a1f9ee80e1d678b20abafadd48f7))
* **api:** probePostgres with real drizzle client used execute(undefined) ([99c20ff](https://github.com/syxscott/Maximilian/commit/99c20ff16337ef71e5d4d5db36992725625be996))
* **api:** readiness probe materializes gitignored workspaces dir ([945e6e4](https://github.com/syxscott/Maximilian/commit/945e6e49287c7cdf3f8385ec15ae199171e56e11))
* break core &lt;-&gt; core-thin-sdk cycle via EventStoreLike interface ([740b4bd](https://github.com/syxscott/Maximilian/commit/740b4bdb3bd44695ab017bb4b0f5938eec9e7858))
* **ci:** align pnpm-lock with dashboard deps on main ([b2b5d92](https://github.com/syxscott/Maximilian/commit/b2b5d925d50b52aafb648146d83fcc4f1a9d95c2))
* **ci:** docker-publish tags emit invalid --tag prefix to GITHUB_OUTPUT ([6a48a27](https://github.com/syxscott/Maximilian/commit/6a48a275d960d08a359528986c21e0970a536fae))
* **ci:** exclude @max/e2e from upgrade-check test step ([a32c6b0](https://github.com/syxscott/Maximilian/commit/a32c6b0e671bd89b3eabdd8a4d369a8d8f9384e4))
* **ci:** exclude @max/e2e from verify test step ([4c5a7be](https://github.com/syxscott/Maximilian/commit/4c5a7bee6a2cecb707d307b42b42e590df2b1b67))
* **ci:** fetch-depth 2 so format-check can diff ${{ github.event.before }}..${{ github.sha }} ([518201f](https://github.com/syxscott/Maximilian/commit/518201f2502d8f1f20164950c244364e69dd7172))
* **ci:** format check + docker build both broke on multi-commit push ([99e74b6](https://github.com/syxscott/Maximilian/commit/99e74b6f70506ece970afaea1c68f8b6cb50aef4))
* **ci:** load.yml NODE_ENV=production skipped husky devDep ([c128407](https://github.com/syxscott/Maximilian/commit/c1284079112a6110466cf2c1495048bac715f7ff))
* **ci:** regenerate pnpm-lock.yaml — out of sync with root package.json ([2aa7c36](https://github.com/syxscott/Maximilian/commit/2aa7c36263a1d71b03ca34d06354b7413c7e6139))
* **ci:** release-please log step mangles JSON in bash ([1caa03d](https://github.com/syxscott/Maximilian/commit/1caa03df6b2b481a7c89f69abd6ffc2524d9e2b3))
* **ci:** runMigrations returns real applied count, register 0003 in journal ([25578bc](https://github.com/syxscott/Maximilian/commit/25578bcdab32e1dab5c6203f325a5565406c686a))
* **ci:** scope prettier --check to changed files + format new ones ([46bf530](https://github.com/syxscott/Maximilian/commit/46bf5302bba673ebd8ce37b352d2b6edd3cad8ef))
* **ci:** use github.event.before + sha for format check (shallow-safe) ([b0dcc98](https://github.com/syxscott/Maximilian/commit/b0dcc98ff5a424e41f1c23dbd0f8cd9be63a77c9))
* close borrowings-audit findings across core, providers, api, dashboard ([1df1988](https://github.com/syxscott/Maximilian/commit/1df19886f311847796492acf8b58cb6f7a0ab4a1))
* **core:** do not spread info onto busy state in SessionStatus FSM ([6f0a4b6](https://github.com/syxscott/Maximilian/commit/6f0a4b696c09e5eb33542c53dc082fe58e6c0af0))
* **core:** export FailoverReason and ClassifiedError types ([8de4ee4](https://github.com/syxscott/Maximilian/commit/8de4ee42edba488d6bcd1bc367732bd71c66fd09))
* **core:** use ContentPart shape for compaction system message ([f41e03b](https://github.com/syxscott/Maximilian/commit/f41e03ba80dd2f2f724d3843234922c5d53839a6))
* **dags:** export Blueprint type for autonomy ([0a6a157](https://github.com/syxscott/Maximilian/commit/0a6a157f12cf215465672ccd90b6d42aa128575c))
* **dashboard:** surface approval prompt + comment input ([d7e6f22](https://github.com/syxscott/Maximilian/commit/d7e6f224fd1a1727c4fff000ae845a2306bf98aa))
* **dashboard:** wire missing workspace deps + re-export UI primitives ([883372a](https://github.com/syxscott/Maximilian/commit/883372a383c0955a23d6618d3b9d2ecf46d4b0cf))
* **db:** getMigrationStatus compares journal when vs created_at ([47b442e](https://github.com/syxscott/Maximilian/commit/47b442e77b68f4a4806e5e3c5e972c35bd8a67ac))
* **db:** pg-integration used wrong db.execute payload shape ([51eb3c4](https://github.com/syxscott/Maximilian/commit/51eb3c4002a37972676822490bc4ce6ea4bcc1d2))
* **db:** query drizzle.__drizzle_migrations (not public.__drizzle_migrations) ([bec7d26](https://github.com/syxscott/Maximilian/commit/bec7d26e5f3ae0968812d569dcddca3234838e42))
* **db:** serialize test files to avoid CREATE SCHEMA race ([eb5af59](https://github.com/syxscott/Maximilian/commit/eb5af592963d813ca64127b5a8c985fbb4af6756))
* **db:** tenants insert uses Date objects for timestamp columns ([13de669](https://github.com/syxscott/Maximilian/commit/13de669889261c7292b85fc1086221afb72e4714))
* **db:** top-level eq import + keep workspace store API string-typed ([131d26f](https://github.com/syxscott/Maximilian/commit/131d26fe0309b0bb446ba45b51d5e81f1395976f))
* **deps:** pin patched versions to clear pnpm audit --audit-level=high ([a9e0939](https://github.com/syxscott/Maximilian/commit/a9e09391ede1c407504893a0219d9ec8164e57c5))
* **docker:** copy tsconfig*.json so strict extends resolve ([17c5188](https://github.com/syxscott/Maximilian/commit/17c5188e1c743482c3134d57945a01744c86f517))
* **docker:** runtime stage needs HUSKY=0 — `--prod` skips husky devDep ([74d49a5](https://github.com/syxscott/Maximilian/commit/74d49a58547c19c4c0258e3584012a7c533be6e8))
* **docker:** scope build to app's workspace closure ([05c7748](https://github.com/syxscott/Maximilian/commit/05c77487a2881b943b54bedb7759853bdf297915))
* **docker:** skip better-sqlite3 build script (unused drizzle peer) ([73f2c04](https://github.com/syxscott/Maximilian/commit/73f2c04348b7aefd01829886fbf99320b0fd39e2))
* **event-bus:** await async subscribers via publishAsync in phase runner ([f820096](https://github.com/syxscott/Maximilian/commit/f820096262f637d768b03f998ad8d5ae2abf4049))
* evolutionAwareFactory 转发 memory + skills prelude 到 inner agent ([7f6e60f](https://github.com/syxscott/Maximilian/commit/7f6e60f5c3f17183c31e5e542491586ef0dd5648))
* **evolution:** pass config.scoreThreshold to extractFailureModes ([b34becf](https://github.com/syxscott/Maximilian/commit/b34becf88a7c7811414d9fc2e95c0c855a140ace))
* **fe-be:** close 9 FE-BE interaction gaps surfaced by phase5 audit ([64b6307](https://github.com/syxscott/Maximilian/commit/64b63070da04d51c198ffbc835bf7fb5a63b0e4c))
* **frontend:** 30+ bug sweep across dashboard + TUI ([5e3db82](https://github.com/syxscott/Maximilian/commit/5e3db82e9f7db8a0993fbf8a937e0baf87986b7e))
* **lint:** drop duplicate eslint-disable on cbProvider cast ([a5e2693](https://github.com/syxscott/Maximilian/commit/a5e26936da261953ef943444a7a2fc4058afa0c1))
* **lint:** drop unknown-rule eslint-disable directives + 1 eqeqeq bug ([0e0338c](https://github.com/syxscott/Maximilian/commit/0e0338c18d317e1779693e08384db33a9bb2c1f2))
* **lint:** theme/index.js still had `==` instead of `===` ([fdcb567](https://github.com/syxscott/Maximilian/commit/fdcb567bdbd99e82d96d081fa58c9c8915f6c0c4))
* **meta-system,api,database:** inject TruthAudit instance + clear dead comment (Phase 1b) ([6afaf7c](https://github.com/syxscott/Maximilian/commit/6afaf7c91b4d04902943868c906bee084ce9e5b3))
* **meta-system,api,database:** wire TruthAudit closed-loop end-to-end (Phase 1) ([563d563](https://github.com/syxscott/Maximilian/commit/563d563bca63a3bce8538378b9897baa92ac592b))
* **phase:** restore state snapshot on timeout/error to prevent post-timeout writes polluting shared state ([92438bc](https://github.com/syxscott/Maximilian/commit/92438bc4d4453e72a29daf7e35fce160327aa4d4))
* **providers:** 6 bugs found by end-to-end audit ([600c279](https://github.com/syxscott/Maximilian/commit/600c279aa16c3c70320dd47e1838aab7ec60b2e9))
* **providers:** wire RETRY_MAX_DELAY_NO_HEADERS as baseDelay cap ([63fe9fe](https://github.com/syxscott/Maximilian/commit/63fe9fe78e33d6e5f9f2e8dc85b259cca3e849f6))
* **queue:** BackgroundJob.wait() returns cached result for completed jobs ([a53a070](https://github.com/syxscott/Maximilian/commit/a53a0708c7af7bdbf78c500cae7a54736059a526))
* resolve code review findings (71 bugs identified) ([3f5f49a](https://github.com/syxscott/Maximilian/commit/3f5f49a7b7e02c06933b85531b67b65e1852785f))
* restore terminalSuccess import in bash-stream.ts ([3b86dfc](https://github.com/syxscott/Maximilian/commit/3b86dfc98878a0b9f371f811c090a8c39e7cb9de))
* **runtime:** wire steering and follow-up hooks into runToolLoop ([1822590](https://github.com/syxscott/Maximilian/commit/1822590fb3ae4d3fca57841c92e8f0b2535c6a47))
* **runtime:** wiring + cleanup pass — signals, audit persistence, tenant isolation ([73c2543](https://github.com/syxscott/Maximilian/commit/73c254368b4d669ae4438f69255b4efc74187f9f))
* **security:** 25-bug sweep — auth, multi-tenant, runtime, schema ([c4838fb](https://github.com/syxscott/Maximilian/commit/c4838fbfd0ca0a11ac698f48eae2cdaa8c4c536b))
* **size-limit:** externalize @max/* subpath imports ([1c10e46](https://github.com/syxscott/Maximilian/commit/1c10e468ca00a9ac0f7e554c42472b02bd7395bf))
* StallDetector 改为 per-workspace 隔离(并发 workspace 不再共享 stall 计数) ([0a7614f](https://github.com/syxscott/Maximilian/commit/0a7614f4b930fe30f5f6c940414934c582f9e5e5))
* **stryker:** repair mutation-test CI on main ([004302f](https://github.com/syxscott/Maximilian/commit/004302f6cbed2070fb24731c50a93dda287fef12))
* **stryker:** set break=null + drop dashboard reporter ([8ee6b64](https://github.com/syxscott/Maximilian/commit/8ee6b645774ffc36775c02da15441478ee90b6f4))
* **tests:** clear 6 pre-existing test failures blocking CI ([2d5e73d](https://github.com/syxscott/Maximilian/commit/2d5e73dd6d6d3783f9b15c7256ff38db08633513))
* tighten approval/error resolution + dialog state ([5de5c52](https://github.com/syxscott/Maximilian/commit/5de5c522c484dafb2d48b4b30635a7d1c0a01eaa))
* **tools,core:** patch opencode security translator + sandbox plugin (Phase 2) ([c017a0c](https://github.com/syxscott/Maximilian/commit/c017a0cf05cd494602eb4f3545085817dd3faa2a))
* **tools:** LSP client skips malformed frames to prevent infinite loop ([dfbc36a](https://github.com/syxscott/Maximilian/commit/dfbc36aab8ffad651136a08931aace4a300d8c36))
* **tools:** LSP client uses Buffer to preserve binary frames (HIGH 6) ([01debcf](https://github.com/syxscott/Maximilian/commit/01debcfc5df8d8954d26fb107b0a7477da540f9d))
* **ui-react:** add .js extensions to relative ESM imports ([bbf3539](https://github.com/syxscott/Maximilian/commit/bbf35397ea0199cb47104664c324b3960eb32fb9))
* **ui:** local polish — Vercel/Linear four-panel pass ([7fb65a8](https://github.com/syxscott/Maximilian/commit/7fb65a83f9f98c93b52f2eb3c387efc153b53fbd))
* Wave 5 — fix 2 bugs found in 15-borrowing review ([029a52d](https://github.com/syxscott/Maximilian/commit/029a52dda3cf92eb2517ea02600a46ef51029074))
* 多 agent 并发路径的两个 bug ([f6b1de9](https://github.com/syxscott/Maximilian/commit/f6b1de9a1e127ecf4597fa41607c1575f529fa3e))


### Performance Improvements

* **autonomy:** fix Promise.all error handling, cache blueprints, share execution store reads ([ab30d23](https://github.com/syxscott/Maximilian/commit/ab30d238b7b27b674513f596a1420689ad47b474))
* **autonomy:** parallelize observe stage where safe ([6faf2b6](https://github.com/syxscott/Maximilian/commit/6faf2b637ce63cfa632fceecaab9662b0c558399))

## [Unreleased]

### Production readiness — full stack

A 6-phase push took the MVP from a single-process Hono server with file-based JSON
storage to a production-ready, multi-process, multi-tenant-ready system.

#### Added
- **PostgreSQL backend** (Drizzle ORM, `packages/database`). All 12 file-based stores
  gained drop-in PostgreSQL equivalents; selection via `DATABASE_URL`. The 4 highest-
  frequency stores (workspace, metrics, executions, org-events) are Tier 1.
- **JWT authentication** with refresh-token rotation (`/api/auth/*`), 3 RBAC roles
  (admin / operator / viewer), and `bcryptjs` password hashing. Replaces single
  `ADMIN_TOKEN`; falls back to it when `JWT_SECRET` is unset for backwards compat.
- **Multi-tenant schema**: `tenant_id` on every owned table, `tenants` table, full
  isolation enforced in every store's `load` query. Feature-flagged
  (`MULTI_TENANT_ENABLED`).
- **BullMQ task queue** with Redis backend (`packages/queue`, `apps/worker`). API
  enqueues; worker pulls and executes. Decouples request acceptance from
  execution, enables horizontal scaling. Feature-flagged (`TASK_QUEUE_ENABLED`).
- **OpenTelemetry**: traces flow to OTLP HTTP collector, gated by `OTEL_ENABLED`.
- **Prometheus metrics**: `/api/metrics` exposes request counters, duration
  histograms, task duration, active workspaces, and LLM token counters. Admin-token
  gated.
- **Security middleware**: CSP, HSTS (production-only), X-Frame-Options, X-Content-
  Type-Options, Referrer-Policy. Rate-limit (100 req/min/IP) with safe `X-Forwarded-
  For` handling when `TRUSTED_PROXIES` is configured.
- **K8s readiness probe** (`/api/ready`) actually probes Postgres + LLM providers +
  workspace dir, with 2s timeout per probe.
- **Docker Compose** for full stack: `postgres`, `api`, `dashboard`, optional
  `redis` + `worker` (queue profile), optional `otel-collector` + `prometheus`
  (observability profile). Multi-stage Dockerfiles for API and dashboard.
- **GitHub Actions CI**: type-check + test + build with PG service container. 170+
  tests across 16 packages.
- **OpenAPI 3.1 spec** auto-generated from zod-openapi route definitions. All 67
  routes documented across 13 tag groups; served at `/api/openapi.json` with
  Swagger UI at `/api/docs`.
- **API versioning**: every route mounted under both `/api/` and `/api/v1/`.
- **Cursor-based pagination** on all list endpoints (`?cursor=&limit=`).
- **SSE event bus** (`/api/events/bus`) with replay buffer; supports both
  workspace-scoped and global subscriptions.
- **VISUALIZER adapter** for the execution-graph UI (`/api/obs/graph/:id`,
  `/api/obs/timeline`).
- **Top-level scripts**: `pnpm test` (turbo-driven), `pnpm start:full` (api +
  dashboard + worker), `pnpm bootstrap` (production-data seeder).

#### Changed
- API is `OpenAPIHono` end-to-end; `c.req.valid("json")` is the standard
  validation pattern. All request bodies, params, and responses are zod-typed.
- Logging is structured JSON via `pino` (not `console.log`); every request gets
  a `X-Request-Id` header for correlation.
- `apps/web` (SolidJS) was folded into `apps/dashboard` (React 19) — single
  frontend.
- All request handlers wrap execution in OpenTelemetry spans; failures recorded
  in Prometheus.

#### Fixed
- Race condition in JWT refresh token rotation (TOCTOU between read and revoke).
- Rate-limit bypass via spoofed `X-Forwarded-For` when no `TRUSTED_PROXIES` set.
- `birth.birth()` returning undefined crashing the HITL approve path with a
  confusing TypeError.
- Memory leak in SSE reconnect (listener never unsubscribed from runtime).
- Phase 6 任务执行时机无法被 Prometheus 监控 (no active_workspaces tracking).

## [0.1.0] — 2026-06-22

### Phases 1-8 (MVP)
Initial MVP. The full evolution from a simple file-backed agent runtime through
self-evolution, DAGS team composition, and the meta-system. See
`docs/changelogs/2026-06-22-*.md` for per-phase detail.

Highlights:
- Agent runtime with multi-agent task execution (`@max/core`).
- Evolution engine: profile store, leaderboard, version snapshots, auto-promotion.
- DAGS team composition from user request.
- Meta-system: capability discovery, agent birth/retirement, team optimization,
  organization memory, governance engine, HITL approval pipeline, simulation.
- Autonomy orchestrator + learning dashboard.
- React 19 dashboard (originally SolidJS companion).
- File-backed storage for all 12 stores (later dual-mode with PostgreSQL).

[Unreleased]: https://github.com/anthropics/maximilian/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/anthropics/maximilian/releases/tag/v0.1.0
