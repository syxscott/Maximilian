export const meta = {
  name: 'deep-research-maximilian-goal',
  description: 'Evaluate whether Maximilian achieves its self-evolving multi-agent OS goal',
  phases: ['Search', 'Fetch', 'Verify', 'Synthesize'],
}

const QUESTION = 'Maximilian 项目是否达成了其"自进化多智能体操作系统"的最终目标？'

const SEARCH_ANGLES = [
  'self-evolving multi-agent OS architecture requirements benchmark 2025 2026',
  'AutoGPT LangGraph CrewAI MetaGPT self-evolution capabilities comparison 2025',
  'Maximilian multi-agent OS architecture features completeness review',
  'self-evolving agent system DARPA AutoGPT autonomy benchmark metrics',
  'multi-agent OS production readiness gaps limitations open source 2025 2026',
]

const SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    url: { type: 'string' },
    star_count: { type: 'number' },
    description: { type: 'string' },
    key_findings: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'url', 'description', 'key_findings'],
}

const FETCH_SCHEMA = {
  type: 'object',
  properties: {
    architectural_features: { type: 'array', items: { type: 'string' } },
    self_evolution_mechanisms: { type: 'array', items: { type: 'string' } },
    production_readiness: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['CONFIRMED', 'PLAUSIBLE', 'REFUTED'] },
    reason: { type: 'string' },
  },
  required: ['verdict', 'reason'],
}

phase('Search')
const searchResults = await parallel(SEARCH_ANGLES.map(function(a, i) {
  return function() {
    return agent('Search ' + i + ': ' + a, {
      schema: SEARCH_SCHEMA,
      prompt: 'WebSearch for: ' + a + '\nReturn top 5 results with title, URL, star_count (if github), description, and 3 key findings each. Format each result as: TITLE | URL | STARS | DESCRIPTION | FINDINGS',
    })
  }
}))

// Deduplicate
const allUrls = []
const seen = {}
for (let i = 0; i < searchResults.length; i++) {
  const r = searchResults[i]
  if (r && r.url && !seen[r.url]) {
    seen[r.url] = true
    allUrls.push(r.url)
  }
}

phase('Fetch')
const fetches = allUrls.slice(0, 12).map(function(url, i) {
  return function() {
    return agent('Fetch ' + i + ': ' + url, {
      schema: FETCH_SCHEMA,
      prompt: 'WebFetch ' + url + '\nExtract and categorize into four buckets: (1) architectural_features, (2) self_evolution_mechanisms, (3) production_readiness, (4) gaps. Return all four arrays, each with string items. If a category has nothing, return an empty array.',
    })
  }
})
const fetched = await parallel(fetches)

// Collect claims
const claims = []
for (let j = 0; j < fetched.length; j++) {
  const f = fetched[j]
  if (f && typeof f === 'object') {
    const fields = ['architectural_features', 'self_evolution_mechanisms', 'production_readiness', 'gaps']
    for (let k = 0; k < fields.length; k++) {
      const field = fields[k]
      const arr = f[field]
      if (Array.isArray(arr)) {
        for (let m = 0; m < arr.length; m++) {
          const item = arr[m]
          if (typeof item === 'string' && item.length > 20) {
            const srcUrl = allUrls[j] || 'unknown'
            claims.push({ claim: item, source: srcUrl })
          }
        }
      }
    }
  }
}

phase('Verify')
const verifiers = claims.slice(0, 20).map(function(c, i) {
  return function() {
    const claimText = c.claim || ''
    const source = c.source || 'unknown'
    return agent('Verify ' + i + ': ' + claimText.slice(0, 80), {
      schema: VERDICT_SCHEMA,
      prompt: 'Adversarially verify this claim about self-evolving multi-agent OS:\n' + claimText + '\nEvidence source: ' + source + '\nReturn EXACTLY one verdict: CONFIRMED (evidence directly supports), PLAUSIBLE (mechanism real but uncertain trigger), or REFUTED (factually wrong). Also give one sentence reason.',
    })
  }
})
const verified = await parallel(verifiers)

phase('Synthesize')
const confirmed = []
const plausible = []
const refuted = []
for (let n = 0; n < verified.length; n++) {
  const v = verified[n]
  if (!v) continue
  if (v.verdict === 'CONFIRMED') confirmed.push(v.claim || v.reason || c)
  else if (v.verdict === 'PLAUSIBLE') plausible.push(v.claim || v.reason || '')
  else if (v.verdict === 'REFUTED') refuted.push(v.claim || v.reason || '')
}

const verdict = confirmed.length > plausible.length + refuted.length
  ? 'EVIDENCE SUPPORTS: Maximilian achieves its stated self-evolving OS goal'
  : confirmed.length > refuted.length
  ? 'MIXED: Partial achievement with significant gaps'
  : 'INSUFFICIENT: Major gaps between goal and implementation'

return {
  question: QUESTION,
  confirmed_count: confirmed.length,
  plausible_count: plausible.length,
  refuted_count: refuted.length,
  confirmed_claims: confirmed.slice(0, 10),
  plausible_claims: plausible.slice(0, 10),
  refuted_claims: refuted.slice(0, 5),
  overall_verdict: verdict,
}
