# Changelog

All notable changes to Maximilian are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Per-phase detail lives under `docs/changelogs/` — this file is the high-level summary.

## [1.1.0](https://github.com/syxscott/Maximilian/compare/v1.0.0...v1.1.0) (2026-09-26)


### Features

* **api,dashboard,i18n:** round 7 — jobs real BullMQ dispatch, goals × evolution, i18n audit + 180 keys ([5e03513](https://github.com/syxscott/Maximilian/commit/5e03513c740e913013a0138e513f47a449699f76))
* **api,dashboard:** full OpenAPI document + typed client generator v0 ([5ac72cf](https://github.com/syxscott/Maximilian/commit/5ac72cf555afb13426373a4f1d6f596e2b9df141))
* **api,dashboard:** integrate 4-domain batch — jobs host, 46 schema-aligned renderers, 40 ai-elements, 13 stores + dock layout ([c071051](https://github.com/syxscott/Maximilian/commit/c07105162ecc14df5551c6ee961955cd58fe6ff4))
* **api,dashboard:** jobs domain (PendingSlot host) + automations/memory/skills settings domains ([d65b684](https://github.com/syxscott/Maximilian/commit/d65b684aa36e9f6ba0b8c67cff9110d9b962a4dc))
* **api,dashboard:** oracle lessons editor + system overview section ([0545757](https://github.com/syxscott/Maximilian/commit/0545757f6b78a74f49635955e1642e4ec130cbf8))
* **api,dashboard:** P3 observability analytics + P4 workflow runs view ([a5959ee](https://github.com/syxscott/Maximilian/commit/a5959eebc7d08a4f78faf4500ed688777e0d1edc))
* **api,dashboard:** round 14 — conversation live status, dock density, oracle editor, system overview ([57d91c3](https://github.com/syxscott/Maximilian/commit/57d91c3391748ad312a125140ee713b40bfe5a97))
* **api,dashboard:** round 8 — renderer coverage complete (62), memory viewer deepening, migrations card, dock density, timeline virtual heights ([8a705d5](https://github.com/syxscott/Maximilian/commit/8a705d54ae81a13a9fde739537d407ab245c02a9))
* **api,dashboard:** session history browser — the read side of the double-write ([b3cf929](https://github.com/syxscott/Maximilian/commit/b3cf929a25e0f1ab48248859d4dcbbd78b213d7b))
* **api,dashboard:** settings center v2 — eight admin domains behind one segmented surface ([5b18db6](https://github.com/syxscott/Maximilian/commit/5b18db639363722be451569412ba2358735054c5))
* **api,worker:** scheduled jobs materialize message into real workspace runs ([b05d9c5](https://github.com/syxscott/Maximilian/commit/b05d9c5228ac72c28119ffafb339fcb7c1e93476))
* **api:** jobs executor — real BullMQ dispatch with honest degradation ([bcbbc55](https://github.com/syxscott/Maximilian/commit/bcbbc551befa7bedc0c7edba1c96a87eeef9adab))
* **api:** workflow routes — the WorkflowEngine gains its consumer ([da47d89](https://github.com/syxscott/Maximilian/commit/da47d89bb4dbd703b37f4f9c2515e8f5169062b7))
* **autonomy:** promotion write-back — a promoted candidate reaches the live blueprint ([355f222](https://github.com/syxscott/Maximilian/commit/355f2228c8155aa4c245b5d105ede50bd8dabd6d))
* **core:** vault-sourced provider credentials — the Vault gains its consumer ([bbd28f9](https://github.com/syxscott/Maximilian/commit/bbd28f9e1ce29b256f12523b13a4da074d3c0ac6))
* **dashboard,api:** integrate deep settings domains — providers catalog browser, model tester, subagents, usage charts, store status ([736727c](https://github.com/syxscott/Maximilian/commit/736727cf11d5b58da55e93e09b4073305a57fbe8))
* **dashboard,api:** memory import/export + migrations card follow-ups ([9e196da](https://github.com/syxscott/Maximilian/commit/9e196da58de34297fe154af8bd98eb399b374bbb))
* **dashboard,api:** memory viewer deepening + migrations status card ([03d528b](https://github.com/syxscott/Maximilian/commit/03d528bca82c59d0e9ab3cd0d784ab0109f5ba5c))
* **dashboard,api:** settings deep domains — providers catalog browser, model tester, subagents, usage charts, store status ([e94a4ed](https://github.com/syxscott/Maximilian/commit/e94a4eda15a189ca3ea126b12e8c9cd4ad941be7))
* **dashboard,api:** wire session-search route + fix EmptyState test import after trajectory move ([1aaf02a](https://github.com/syxscott/Maximilian/commit/1aaf02abdbe8f583c947f1904bb53afcd5eeecb1))
* **dashboard,tui:** goals/deliverables wiring + TUI panel deepening ([6942724](https://github.com/syxscott/Maximilian/commit/6942724774285af975deb3ea2b08838bbf688d7c))
* **dashboard:** 8 domain stores + dock layout engine v1 ([55a5cd8](https://github.com/syxscott/Maximilian/commit/55a5cd82ae9ccd9d87312d0e4e43cf0d2d46003f))
* **dashboard:** ai-elements density in timeline — usage/latency/error/stats surfaces ([ccc08a4](https://github.com/syxscott/Maximilian/commit/ccc08a4cdbc3f0d71bf595d9a02d52832aaa1f5b))
* **dashboard:** ai-elements expands to 40 message-part components ([cfe4d69](https://github.com/syxscott/Maximilian/commit/cfe4d6956036a1c5f01ef1336e8ff823740ed904))
* **dashboard:** ai-elements message-part library + domain stores ([2865c96](https://github.com/syxscott/Maximilian/commit/2865c969325cf09c7a5dcbb458c6533f65351fa0))
* **dashboard:** ai-elements mounted across renderers, deliverables and session-query ([1990d4c](https://github.com/syxscott/Maximilian/commit/1990d4c2ffa03800008489d48e46ec1e2549bb17))
* **dashboard:** ai-elements mounted in goals/deliverables/settings ([690bbd1](https://github.com/syxscott/Maximilian/commit/690bbd18aa0c50b7539b507919b9d89ca688a2c8))
* **dashboard:** ai-elements second wave — streaming cursor, skeletons, banners, quotes ([3806276](https://github.com/syxscott/Maximilian/commit/3806276090ddf7a0d7418f4e248dce11533d442a))
* **dashboard:** auto-aggregating domain i18n + feature registry ([a05d964](https://github.com/syxscott/Maximilian/commit/a05d9648a2cab659246ca7d27265d1098d8f563d))
* **dashboard:** automations domain wired to real job triggers ([8620422](https://github.com/syxscott/Maximilian/commit/8620422da570b668de03d39d08530333721230d0))
* **dashboard:** automations slots panel + trigger feedback loop ([0c04c80](https://github.com/syxscott/Maximilian/commit/0c04c801cd5e63c7eb2693f0438ba57998d2f21f))
* **dashboard:** ChatPanel timeline on ConversationWindow + virtual-height estimation ([3bea6ea](https://github.com/syxscott/Maximilian/commit/3bea6eac1b6543ebf4fc0db6b1fa2cbbe2ba19f0))
* **dashboard:** complete tool-renderer set — 43 domain renderers with registry aggregation ([0739cc7](https://github.com/syxscott/Maximilian/commit/0739cc71f8f3b4ca318695a45788d5ca8f6b141c))
* **dashboard:** conversation finishing — tail coexistence, cursor separation, flash-once ([fbee8c6](https://github.com/syxscott/Maximilian/commit/fbee8c6c4d0ec77fd08c4be2e32c7a672300d09e))
* **dashboard:** conversation full-bleed finishing — frozen counts, find highlighting tiers, in-scope find hotkey ([a934a76](https://github.com/syxscott/Maximilian/commit/a934a76a8dd6ee2076652392ca0051668a97b785))
* **dashboard:** conversation live status — running tool spinners, turn timers, steering flash, failed-expand ([65d7099](https://github.com/syxscott/Maximilian/commit/65d70992d7113f6d33beac5ef7f3c8fd1b6e052b))
* **dashboard:** conversation turn-unit pipeline — pairing, retry waves, find index, markdown export ([dbf67b0](https://github.com/syxscott/Maximilian/commit/dbf67b0ecff7cce80823bdf49565d47528a209ac))
* **dashboard:** conversation windowing, text units, live-tail model, share sections ([d863282](https://github.com/syxscott/Maximilian/commit/d8632829547998cb4f361f7513427bc3ec925dab))
* **dashboard:** dock density — conditional review/output leaves, badges, grouped menu ([7d64b64](https://github.com/syxscott/Maximilian/commit/7d64b647bc4a00bdbafd278f8f418078928fdc0f))
* **dashboard:** dock density (tri-state panels, split tooltips, double-click reset) + timeline virtual-height placeholders ([eecfb59](https://github.com/syxscott/Maximilian/commit/eecfb59518f54996916a46c674d5d03d3856232b))
* **dashboard:** dock engine hosts the main conversation grid + store wiring completion ([176e7b7](https://github.com/syxscott/Maximilian/commit/176e7b7d543aeef6b041e34ecc5e6f9cd605cf8e))
* **dashboard:** feature catalogs — prompt toolbar, mention providers, quickpick, shortcut recorder ([d061e8a](https://github.com/syxscott/Maximilian/commit/d061e8acaa8d75a57c32db1bd32499544501cd1b))
* **dashboard:** goals + deliverables mounted as dock-resident panels ([9a175d8](https://github.com/syxscott/Maximilian/commit/9a175d89fadb0cb82892b376750766da7155a984))
* **dashboard:** goals × evolution — role performance panel + compact chat header ([a4380b8](https://github.com/syxscott/Maximilian/commit/a4380b8becee2e0f3b1e69a6186ee2c81c6d8aec))
* **dashboard:** goals progress domain + deliverables deepening ([0414338](https://github.com/syxscott/Maximilian/commit/04143388c72f110d486a3ebec0805317d75434e1))
* **dashboard:** jobs dispatch records link to materialized workspaces ([4ab4545](https://github.com/syxscott/Maximilian/commit/4ab4545bd25b4f108b56b4924049593c7bcac859))
* **dashboard:** jobs materialized chip promoted to collapsed row + status icons ([ab6e392](https://github.com/syxscott/Maximilian/commit/ab6e39236c3e2e06c9ebfee035f7fba116686c53))
* **dashboard:** model-picker + deliverables feature domains ([637cb2f](https://github.com/syxscott/Maximilian/commit/637cb2ff5a6c938ddb096e82aab2243cf4142e04))
* **dashboard:** multi-workspace tab strip — ZCode titlebar borrowing ([96ccfe8](https://github.com/syxscott/Maximilian/commit/96ccfe8658f928505845707707694d028c54e2ce))
* **dashboard:** oracle editor mounted + system overview section wired ([99ebafe](https://github.com/syxscott/Maximilian/commit/99ebafe58e3920b06bb743b5bcdb30ac88f7faad))
* **dashboard:** P1 conversation surface — timeline v2, tool-renderer registry, command keyboard layer ([7bfd4e8](https://github.com/syxscott/Maximilian/commit/7bfd4e804b00c081af4c03b0bf3a2b2bda3108f6))
* **dashboard:** P7 artifacts explorer — a file-browser view over agent-produced files ([cbe199e](https://github.com/syxscott/Maximilian/commit/cbe199e0d5b7e3b59a89f6a5623eba91eba55df9))
* **dashboard:** remaining tool renderers aligned to real event shapes ([9b1a7cc](https://github.com/syxscott/Maximilian/commit/9b1a7cc95bf92abfa82601f92b49fbb5a6741a6e))
* **dashboard:** renderer audit finalization — labels, phase tones, group depth guard ([97a1139](https://github.com/syxscott/Maximilian/commit/97a1139f0ec95ca3b19c837ea423deb8a7b1f46d))
* **dashboard:** renderer audit table executed — density top-ups and source grounding ([5900bb1](https://github.com/syxscott/Maximilian/commit/5900bb1f8d42a2a8d63baa8209ea1c9c0b68015d))
* **dashboard:** renderer duration humanization + audit coverage locked ([504fd8a](https://github.com/syxscott/Maximilian/commit/504fd8aac1846e7c00f8ad4d762b354a7b5d8b0c))
* **dashboard:** renderer field audit table + third alignment pass ([7435f57](https://github.com/syxscott/Maximilian/commit/7435f5795159183371e51cff3c2c4cd917b98b7a))
* **dashboard:** renderer finalization — group stats wiring, density lock, error prefix ([b8d0631](https://github.com/syxscott/Maximilian/commit/b8d0631ac1429d9c3a2a4cb1ce0c2722047cf4e6))
* **dashboard:** renderer payload variants + shared fixtures ([3b6d337](https://github.com/syxscott/Maximilian/commit/3b6d33716abf85835d59f4f032809ffbe6fc5b42))
* **dashboard:** renderer polish — outcome stats, inline errors, low-density top-ups ([33dbca1](https://github.com/syxscott/Maximilian/commit/33dbca17fac06fc5fa87ceb5dac2c69b810f0a15))
* **dashboard:** rolling usage windows card — usage-windows endpoint gains its consumer ([2e4bc9e](https://github.com/syxscott/Maximilian/commit/2e4bc9e932397919b9f51abe5f8b09c327fbcfb4))
* **dashboard:** session-query dock leaf + automations event filters + search export ([ebfdf7e](https://github.com/syxscott/Maximilian/commit/ebfdf7e6f932f770f08c335c7112c1dc43b2c977))
* **dashboard:** settings search filter + description keys ([1c2ae99](https://github.com/syxscott/Maximilian/commit/1c2ae99f41bcbf2b146a7f6301007186c65bbe70))
* **dashboard:** sidebar drawer unified with dock panel registry ([07114ac](https://github.com/syxscott/Maximilian/commit/07114ac54b076125ce99360ae052ec71c8009e9b))
* **dashboard:** text units surface in timeline + slash quickpick wiring ([dd037b4](https://github.com/syxscott/Maximilian/commit/dd037b49e12f9c41f5822933c88a344d844ecded))
* **dashboard:** timeline auto-tail via liveTailState — frozen-entry count on the jump affordance ([c8b5cf3](https://github.com/syxscott/Maximilian/commit/c8b5cf3f7dcac6ef3a8287c078b0d011c09d5776))
* **dashboard:** timeline deep surface — find, turn navigator, windowing, markdown share + i18n merge infrastructure ([fbd888c](https://github.com/syxscott/Maximilian/commit/fbd888c0fa72e37f9bbea391565a9c278acd7e1b))
* **dashboard:** timeline switches to the turn-unit pipeline (pairing + retry waves) with find/navigate/window/share preserved ([257324f](https://github.com/syxscott/Maximilian/commit/257324fe9d4a71eb67408464a54a3931e2c48f24))
* **dashboard:** tool renderers — final alignment to real event fields ([f168b79](https://github.com/syxscott/Maximilian/commit/f168b798f8a47c8a6ff90b54c1636e455b114ae7))
* **dashboard:** tool renderers aligned to real schemas + full extended set ([9cf5a9f](https://github.com/syxscott/Maximilian/commit/9cf5a9f5aa12aa4c714bc422ea37a455772618b0))
* **dashboard:** tool-renderer coverage completed — dedicated bodies for the full registry ([a60c524](https://github.com/syxscott/Maximilian/commit/a60c524e1077695d64239bcd80a325d56fb5067f))
* **dashboard:** trajectory panel consumes trajectoryStore — window size and expand state wired ([e6da646](https://github.com/syxscott/Maximilian/commit/e6da646b5e4c335d552cee63937126cfb7aae89f))
* **dashboard:** true virtual scrolling for the conversation timeline ([c74f4b4](https://github.com/syxscott/Maximilian/commit/c74f4b492096db3d6d1f2f2e3c5384909e97c186))
* **dashboard:** turn pipeline finalization — single render path, merged tests ([a20ce9a](https://github.com/syxscott/Maximilian/commit/a20ce9a36c1d3978d956a52b802444c5d9660d4d))
* **dashboard:** unify feature/settings/workspace registries under FEATURE_DOMAINS ([c750bbc](https://github.com/syxscott/Maximilian/commit/c750bbc1b1bc734df237248d7544b99c9db4049b))
* **dashboard:** wire 13 domain stores into the shell + mount four settings domains ([1254b47](https://github.com/syxscott/Maximilian/commit/1254b47d59a93fb15a1ee40d90dcc6aa5d0a32a4))
* **dashboard:** wire domain dictionaries — flatten nested domain JSONs into t()'s flat key space ([e13200f](https://github.com/syxscott/Maximilian/commit/e13200fa3db24b9767383d81e60d3e2e7eb047a7))
* **dashboard:** wire session-search onOpenSession through the dock area ([4fe1e82](https://github.com/syxscott/Maximilian/commit/4fe1e821970b1b2ef9ed0c76bd05648fe0ac4c81))
* **dashboard:** workflow renderers field-aligned to engine shapes ([eefa273](https://github.com/syxscott/Maximilian/commit/eefa27395319a486d02ecc125df7ecfc9c4b7d73))
* **dashboard:** workspace sidebar becomes a dock-resident panel system ([617ad19](https://github.com/syxscott/Maximilian/commit/617ad19d2776962c273ff5fed4630cbe48c7774f))
* **dashboard:** ZCode GUI borrowings — trajectory/subagents/diff panes, [@mentions](https://github.com/mentions), onboarding, contract guard ([7472c27](https://github.com/syxscott/Maximilian/commit/7472c277f785fb7fa27ca73928ffa2d1b58f0ffd))
* **i18n:** add 8 locales (ja/ko/de/fr/es/pt-BR/ru/ar) ([5ce6c0b](https://github.com/syxscott/Maximilian/commit/5ce6c0ba181e7553f5551742eb5e000f547ac13b))
* **i18n:** audit tooling + 150-key expansion, hardcode cleanup ([518bfa0](https://github.com/syxscott/Maximilian/commit/518bfa0107bbea388cb47db9f49c4033d7303e1b))
* **meta-system:** truth-audit closure — usage-anchor calibrator fills real actuals ([e096186](https://github.com/syxscott/Maximilian/commit/e096186fa6eccb1fd9c7e32439936f702b4d3624))
* **scripts:** compat-check — machine-readable compatibility gate ([6ad20af](https://github.com/syxscott/Maximilian/commit/6ad20af092fcf4af3ae0b095cac9e75db7f378a3))
* **session-store,dashboard:** cross-session message search — session-query feature domain ([59f6934](https://github.com/syxscott/Maximilian/commit/59f6934dd3aff2d786025d61a104a2cf7c530ad7))
* **session-store:** wire the SQLite double-write into api + worker (M4 wiring) ([1077f0a](https://github.com/syxscott/Maximilian/commit/1077f0acdcb734eac9c4cc05b1b4434a16379c62))
* **tui:** agents and cron panels with evolution data ([4ea3e3a](https://github.com/syxscott/Maximilian/commit/4ea3e3a15f50c0ed1fba52e981dbebc8d387f0e1))
* **tui:** jobs dialog consumes materialization chain ([558c523](https://github.com/syxscott/Maximilian/commit/558c52393d75ba0db1515c7b5cd8e662133f7f1e))
* **tui:** jobs/goals/usage panels with api clients ([b1306b7](https://github.com/syxscott/Maximilian/commit/b1306b727f02b8c654347a05c8305a510ed39558))
* **tui:** memory viewer panel with efficacy ledger and gating badges ([785ee5a](https://github.com/syxscott/Maximilian/commit/785ee5a5c288dfdaaace7f31619847f22fd56ea6))
* **tui:** panels deepening — efficacy sort, review timeline, usage windows ([2d82120](https://github.com/syxscott/Maximilian/commit/2d821204a0ec4bb85c89e3b4151c9a6c3e2bc958))
* **tui:** panels deepening — job history, dependency depth, cache hit rate ([588a5a5](https://github.com/syxscott/Maximilian/commit/588a5a50fbc7eda22334beb812ccb67cb1517bf5))
* **tui:** settings dialog with section navigation ([539b912](https://github.com/syxscott/Maximilian/commit/539b912a9dcdb33efefa3344dc8f6ea279770924))
* **ui-react:** 15 generic primitives (datagrid/tabs/accordion/splitpane/stepper/...) ([df6b79b](https://github.com/syxscott/Maximilian/commit/df6b79b2d9fdf02b7597e8db8a91e85c6da328c5))
* **worker:** autonomy observe + crash budgets — the queue-mode closed loop ([f17d9ea](https://github.com/syxscott/Maximilian/commit/f17d9ea7d26855b1607c0dad12411b750b54d59b))


### Bug Fixes

* **api:** missing route imports crashed boot — sessionRoutes/vaultStatus/oracleLessons/truthReport ([9c7ef3a](https://github.com/syxscott/Maximilian/commit/9c7ef3ac56c16fa2a0d88e7dfef416e0d986416f))
* **autonomy:** type-check — duplicate stub properties + implicit any in writeback test ([9168f17](https://github.com/syxscott/Maximilian/commit/9168f17fc17189a38e3fcac41403c8e0255f7a44))
* **credential-lease:** broker unusable-lease retry livelock + atomic-write temp-file collision + broker/state machine coverage ([219c72f](https://github.com/syxscott/Maximilian/commit/219c72fca7e300df57f07ed8b64f91bd973d449b))
* **credential-lease:** runLogin authorizing epoch under lock — cross-machine generation regression ([6d96d36](https://github.com/syxscott/Maximilian/commit/6d96d36909dd08a7780c2974f873a943b6951627))
* **dashboard,api:** land the onNavigate wiring and jobs dispatch loop-back ([e234ec2](https://github.com/syxscott/Maximilian/commit/e234ec2fc065ac6233a8fa03f6c43b403ea5e4a9))
* **dashboard:** matchKeybind — a mod-less bind must not fire while ctrl/meta is held ([9ea7b11](https://github.com/syxscott/Maximilian/commit/9ea7b11caae71de8973d3a0c0d2142a13b5f6cbf))
* **dashboard:** restore model-picker + deliverables dictionary registration in locales aggregator (lost in parallel commit) ([ddb6af8](https://github.com/syxscott/Maximilian/commit/ddb6af8b9e130501968beb221047dbc4a11643a7))
* **deps:** commit pnpm-lock for the dashboard zustand dependency ([25c976f](https://github.com/syxscott/Maximilian/commit/25c976f5249d3f1ad687d4eb6ee9154e5de939f9))
* **evolution,core:** C2C borrowings — handoff self-report truth, oracle-triad corpus/gating parity, production entry point ([c41f625](https://github.com/syxscott/Maximilian/commit/c41f6255dd1290edcfb237ea900d5df894e6b61c))
* **lint:** remove eslint-disable directive for undefined react-hooks rule ([e6dfb8a](https://github.com/syxscott/Maximilian/commit/e6dfb8a40724f6aa342262a670d5cb2ab1927011))
* **lint:** remove eslint-disable directives for an undefined rule ([223472c](https://github.com/syxscott/Maximilian/commit/223472c5b96cf5fe0d84a0df394a7fb3bbced5da))
* **lint:** remove eslint-disable directives for undefined react rules ([fd78519](https://github.com/syxscott/Maximilian/commit/fd78519ecb8996c02b9c8495018d0628689b259f))
* **scripts:** compat-check recognizes package-scope manifest entries ([d9897e9](https://github.com/syxscott/Maximilian/commit/d9897e95680d6e24c2bfeb42b6faf39202458444))

## 1.0.0 (2026-09-22)


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
* **core,agents,api,worker,tui:** activate the tool loop, steering receipts, retry-status events ([45c8ea5](https://github.com/syxscott/Maximilian/commit/45c8ea533617a82e0876222685cb8b9ef808898e))
* **core+providers:** deepseek-harness LLM patterns + pi session export ([7faf92d](https://github.com/syxscott/Maximilian/commit/7faf92d5149ac5573f2af7caa7c402e96aa42a58))
* **core:** AgentRuntime accepts opencode option to route via OpencodeExecutor ([2d12de6](https://github.com/syxscott/Maximilian/commit/2d12de6e26586100320aefddd495bb1cf7e9570a))
* **core:** load Claude Code skills from ~/.claude/skills/ ([7e080fd](https://github.com/syxscott/Maximilian/commit/7e080fd369f00c7e91d45442a4f16bc4ad38b6fd))
* **core:** OpencodeExecutor — Maximilian Task → opencode serve adapter ([8b7db95](https://github.com/syxscott/Maximilian/commit/8b7db959a1fae1e982525937a3613bbdb1960369))
* **core:** OpencodePhaseRunner + OpencodeDagExecutor ([e68a778](https://github.com/syxscott/Maximilian/commit/e68a77807d13163bee85a78e72558280d91e2c19))
* **core:** OpencodeTeamBridge + OpencodeAcpAdapter for team/ACP ([cdeb474](https://github.com/syxscott/Maximilian/commit/cdeb474100af765f77e02dcd02b7becf29c124f8))
* **core:** runaway-guard + tool-output-budget loop extensions ([e004cca](https://github.com/syxscott/Maximilian/commit/e004cca426a955d2d13e51f835948d26bbdce5ba))
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
* **credential-lease:** OAuth lease protocol package (minimax-code port) ([9d89a68](https://github.com/syxscott/Maximilian/commit/9d89a68eb184f690944ce0b715e6bb6fc4091748))
* **evolution,agents,commander,api,worker:** C2C borrowings — handoff budget, lesson gating, oracle triad ([20fcac1](https://github.com/syxscott/Maximilian/commit/20fcac12937ad71b15c33047ccf7d0acc0d9db78))
* **evolution,providers,session-store,core:** borrowings batch — RemoteError, capacity pool, vault core, aux hardening, auto-review, rewind ([4b30eb4](https://github.com/syxscott/Maximilian/commit/4b30eb43cf54ca6e72a888721f772ee78920d323))
* **evolution:** OpencodeTraceCollector + VariantRunner for opencode sessions ([31ea992](https://github.com/syxscott/Maximilian/commit/31ea992bb0658133ff6dacf70f9c972da6bab53e))
* FailoverReason/工具allowlist/saveState(借鉴 hermes-agent/cc-switch/openclaw) ([4042021](https://github.com/syxscott/Maximilian/commit/40420213cf2d7564ade1a1142f0a267a2884e9bc))
* implement 30+ borrowed patterns from 22 researched OSS projects + security fixes ([05d76ba](https://github.com/syxscott/Maximilian/commit/05d76bab889c794aab1d8ac54e3f366f5777d797))
* implement grok-build design patterns ([489de7e](https://github.com/syxscott/Maximilian/commit/489de7e8fae659831ace3637145c8930b46c7087))
* **llm:** wire opencode StructuredOutput tool with Zod schema ([6a63f3d](https://github.com/syxscott/Maximilian/commit/6a63f3db3e03e53e640501b34113f92fdd5a93de))
* MemoryScope/ADR/repo memory 三件套(借鉴 crewAI/wshobson/codebase-memory-mcp) ([7bce21b](https://github.com/syxscott/Maximilian/commit/7bce21b58d04f47a43f7eaf22edd8885eed31c1e))
* **meta-system:** MetaSystemOpencodeBridge + OpencodeDigitalTwin ([7ae832d](https://github.com/syxscott/Maximilian/commit/7ae832d8749daca32f4c1065b1558d5b9ca41724))
* **monitor:** live usage pill (dashboard) + status bar (TUI) ([2e316b2](https://github.com/syxscott/Maximilian/commit/2e316b269e97dcc44746c3d6359fb12eb775aca8))
* **pro:** ship all 30 professionalization gaps ([006ec52](https://github.com/syxscott/Maximilian/commit/006ec52aeaf5c9c28df25c63a13c28d243cef854))
* **providers,core:** aux-call hardening + runtime extension assembly ([f42c6bd](https://github.com/syxscott/Maximilian/commit/f42c6bd15d3880c4dcca7a2f86ccd26ac9d00388))
* **providers,workflow-engine:** model catalog wiring, governance, native presets, workflow engine ([925dba6](https://github.com/syxscott/Maximilian/commit/925dba625023b32f023f317d873a310a1fb10a5c))
* **providers:** expand to 188 borrowed CC Switch presets ([d22dbfe](https://github.com/syxscott/Maximilian/commit/d22dbfe0d36e1c7478751d40c20059fa3873b46d))
* **providers:** preset-driven registry with 60+ borrowed LLM presets ([6384213](https://github.com/syxscott/Maximilian/commit/6384213874fd56943b56000581134fd1ef00bde5))
* **providers:** update all resale-plan defaults to Sept 2026 frontiers + wire every envModel ([c4c3bbe](https://github.com/syxscott/Maximilian/commit/c4c3bbe5ed4c4b691efa08d0eed0162753a2bff3))
* **providers:** wire opencode ProviderTransform middleware registry ([d6ac8ff](https://github.com/syxscott/Maximilian/commit/d6ac8ff88ad0d85dba9a23f4195a23ead4db730f))
* **providers:** wire opencode retry-after header parsing ([5a0f4b2](https://github.com/syxscott/Maximilian/commit/5a0f4b2659765859a897688a0e0d0e074900d0ed))
* **queue:** wire opencode BackgroundJob lifecycle registry ([11243a8](https://github.com/syxscott/Maximilian/commit/11243a85e3d3eadab0423996e971db96bf528eac))
* **review:** integrate ScholarEval 8-dim scoring into ReviewIntelligence ([b67fd94](https://github.com/syxscott/Maximilian/commit/b67fd948602ce6a0e662f9fab3b1e97a99662b7d))
* SandboxService + PlannerObserver(借鉴 OpenHands/crewAI) ([d05457b](https://github.com/syxscott/Maximilian/commit/d05457b5db8c8d8bd6d830ed9618868a95b2d3da))
* **session-store:** SQLite session store (M4) + lease package formatting ([10121ce](https://github.com/syxscott/Maximilian/commit/10121ce9d9d11368cfdf4d0b37b4e475639ac3d0))
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
* **docker:** build chain in runtime stages too — --prod install compiles better-sqlite3 ([d162577](https://github.com/syxscott/Maximilian/commit/d162577fa6694b0ec83b4b8d9906df94fb13a51c))
* **docker:** copy tsconfig*.json so strict extends resolve ([17c5188](https://github.com/syxscott/Maximilian/commit/17c5188e1c743482c3134d57945a01744c86f517))
* **docker:** runtime stage needs HUSKY=0 — `--prod` skips husky devDep ([74d49a5](https://github.com/syxscott/Maximilian/commit/74d49a58547c19c4c0258e3584012a7c533be6e8))
* **docker:** scope build to app's workspace closure ([05c7748](https://github.com/syxscott/Maximilian/commit/05c77487a2881b943b54bedb7759853bdf297915))
* **docker:** skip better-sqlite3 build script (unused drizzle peer) ([73f2c04](https://github.com/syxscott/Maximilian/commit/73f2c04348b7aefd01829886fbf99320b0fd39e2))
* **event-bus:** await async subscribers via publishAsync in phase runner ([f820096](https://github.com/syxscott/Maximilian/commit/f820096262f637d768b03f998ad8d5ae2abf4049))
* **evolution,test:** correct test-only imports (AgentMemory from types, manifests from core); style: prettier ([e360d63](https://github.com/syxscott/Maximilian/commit/e360d63bb9b87c911a03b8384c769a3af988c42c))
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
* **providers,workflow-engine:** catalog alias resolution + backoff/attempt correctness ([0ed7d5d](https://github.com/syxscott/Maximilian/commit/0ed7d5dfb7cef34cd03f2715e45b580d5ba9e0a2))
* **providers:** 6 bugs found by end-to-end audit ([600c279](https://github.com/syxscott/Maximilian/commit/600c279aa16c3c70320dd47e1838aab7ec60b2e9))
* **providers:** update stale model defaults + activate dead env overrides ([973b787](https://github.com/syxscott/Maximilian/commit/973b78784844b1b4d9a970245dc1da261c628630))
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
