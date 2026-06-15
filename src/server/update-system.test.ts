import { describe, expect, it } from 'vitest'
import { remoteUrlMatches, updateAvailableFromDivergence } from './update-system'

describe('update-system helpers', () => {
  it('matches GitHub URL forms against expected repo aliases', () => {
    expect(
      remoteUrlMatches('https://github.com/outsourc-e/agent-os-v3.git', [
        'outsourc-e/agent-os-v3',
      ]),
    ).toBe(true)
    expect(
      remoteUrlMatches('git@github.com:NousResearch/hermes-agent.git', [
        'hermes-agent',
      ]),
    ).toBe(true)
    expect(
      remoteUrlMatches('https://github.com/example/other.git', [
        'agent-os-v3',
      ]),
    ).toBe(false)
  })

  it('only reports update availability when the remote side is ahead', () => {
    expect(updateAvailableFromDivergence({ ahead: 2, behind: 0 }, true)).toBe(false)
    expect(updateAvailableFromDivergence({ ahead: 0, behind: 3 }, true)).toBe(true)
    expect(updateAvailableFromDivergence({ ahead: 2, behind: 3 }, true)).toBe(true)
    expect(updateAvailableFromDivergence({ ahead: 0, behind: 0 }, false)).toBe(false)
    expect(updateAvailableFromDivergence(null, true)).toBe(true)
  })
})
