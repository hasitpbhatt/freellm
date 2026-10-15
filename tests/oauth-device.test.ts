import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchQoderUserInfo,
  generatePkcePair,
  initiateQoderDeviceFlow,
  parseQoderExpiry,
  pollKiloDeviceCode,
  pollQoderDeviceToken,
  requestKiloDeviceCode,
} from '../functions/lib/oauth-device'

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => handler(String(url), init)) as typeof fetch
  return () => {
    globalThis.fetch = previousFetch
  }
}

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response

test('parseQoderExpiry: numeric, RFC3339, expires-in, and fallbacks', () => {
  assert.equal(parseQoderExpiry(1781594470000, undefined), 1781594470000)
  assert.equal(parseQoderExpiry('1781594470000', undefined), 1781594470000)
  // Seconds-scale values (10 digits) are seconds epoch, not ms.
  assert.equal(parseQoderExpiry(1781594470, undefined), 1781594470000)
  assert.equal(parseQoderExpiry('1781594470', undefined), 1781594470000)
  assert.equal(parseQoderExpiry('2026-06-16T07:15:04Z', undefined), Date.parse('2026-06-16T07:15:04Z'))
  const before = Date.now()
  const fromIn = parseQoderExpiry(undefined, 3600)!
  assert.ok(fromIn >= before + 3599 * 1000 && fromIn <= Date.now() + 3601 * 1000)
  // expiresIn 0 = already expired: now, not now+30d.
  assert.ok(Math.abs(parseQoderExpiry(undefined, 0)! - Date.now()) < 5000)
  const fallback = parseQoderExpiry(undefined, undefined)!
  assert.ok(fallback > Date.now() + 29 * 24 * 3600 * 1000)
})

test('initiateQoderDeviceFlow: local PKCE + nonce carried in the login URL', async () => {
  const flow = await initiateQoderDeviceFlow('https://qoder.com/device/selectAccounts')
  const url = new URL(flow.verificationUriComplete)
  assert.ok(url.searchParams.get('challenge'), 'challenge present')
  assert.equal(url.searchParams.get('challenge_method'), 'S256')
  assert.equal(url.searchParams.get('nonce'), flow.nonce)
  assert.ok(url.searchParams.get('machine_id'), 'machine_id present')
  assert.equal(flow.userCode, flow.nonce.slice(0, 8).toUpperCase())
  assert.equal(flow.verifier.length > 20, true)
})

test('requestKiloDeviceCode: maps the initiate response, 429 surfaces', async () => {
  const restore = stubFetch((url) => {
    assert.ok(url.endsWith('/api/device-auth/codes'))
    return jsonResponse({ code: 'KC-123', verificationUrl: 'https://kilo.ai/activate', expiresIn: 300 })
  })
  try {
    const initiated = await requestKiloDeviceCode('https://api.kilo.ai/api/device-auth/codes')
    assert.deepEqual(initiated, {
      deviceCode: 'KC-123',
      userCode: 'KC-123',
      verificationUri: 'https://kilo.ai/activate',
      expiresIn: 300,
      interval: 3,
    })
  } finally {
    restore()
  }

  const restore429 = stubFetch(() => ({ ok: false, status: 429, statusText: 'Too Many', text: async () => '' }) as Response)
  try {
    await assert.rejects(requestKiloDeviceCode('https://api.kilo.ai/api/device-auth/codes'), /Too many pending/)
  } finally {
    restore429()
  }
})

test('pollKiloDeviceCode: pending/denied/expired/approved+profile', async () => {
  const restore = stubFetch((url) => {
    if (url.includes('/api/profile')) return jsonResponse({ organizations: [{ id: 'org-9' }] })
    if (url.endsWith('/CODE-PENDING')) return { ok: false, status: 202, statusText: '', text: async () => '' } as Response
    if (url.endsWith('/CODE-DENIED')) return { ok: false, status: 403, statusText: '', text: async () => '' } as Response
    if (url.endsWith('/CODE-OLD')) return { ok: false, status: 410, statusText: '', text: async () => '' } as Response
    return jsonResponse({ status: 'approved', token: 'tok-1', userEmail: 'u@x.com' })
  })
  try {
    assert.deepEqual(await pollKiloDeviceCode('https://api.kilo.ai/api/device-auth/codes', 'https://api.kilo.ai/api/profile', 'CODE-PENDING'), { status: 'pending' })
    assert.deepEqual(await pollKiloDeviceCode('https://api.kilo.ai/api/device-auth/codes', 'https://api.kilo.ai/api/profile', 'CODE-DENIED'), { status: 'error', error: 'Authorization denied by user' })
    assert.deepEqual(await pollKiloDeviceCode('https://api.kilo.ai/api/device-auth/codes', 'https://api.kilo.ai/api/profile', 'CODE-OLD'), { status: 'error', error: 'Authorization code expired' })
    assert.deepEqual(await pollKiloDeviceCode('https://api.kilo.ai/api/device-auth/codes', 'https://api.kilo.ai/api/profile', 'CODE-OK'), {
      status: 'success',
      accessToken: 'tok-1',
      email: 'u@x.com',
      orgId: 'org-9',
    })
  } finally {
    restore()
  }
})

test('pollQoderDeviceToken: 202/404 pending, token success, shape guards', async () => {
  const restore = stubFetch((url) => {
    if (url.includes('nonce=PEND')) return { ok: false, status: 202, statusText: '', text: async () => '' } as Response
    if (url.includes('nonce=MISS')) return { ok: false, status: 404, statusText: '', text: async () => '' } as Response
    if (url.includes('nonce=EMPTY')) return jsonResponse({ nope: true })
    assert.ok(url.includes('challenge_method=S256'), 'challenge method pinned')
    return jsonResponse({ token: 'dt-abc', refresh_token: '', user_id: 'u1', expires_in: 86400 })
  })
  try {
    assert.deepEqual(await pollQoderDeviceToken('https://openapi.qoder.sh/api/v1/deviceToken/poll', 'PEND', 'v'), { status: 'pending' })
    assert.deepEqual(await pollQoderDeviceToken('https://openapi.qoder.sh/api/v1/deviceToken/poll', 'MISS', 'v'), { status: 'pending' })
    await assert.rejects(pollQoderDeviceToken('https://openapi.qoder.sh/api/v1/deviceToken/poll', 'EMPTY', 'v'), /no token/)
    const ok = await pollQoderDeviceToken('https://openapi.qoder.sh/api/v1/deviceToken/poll', 'DONE', 'v')
    assert.equal(ok.status, 'success')
    if (ok.status === 'success') {
      assert.equal(ok.accessToken, 'dt-abc')
      assert.equal(ok.userId, 'u1')
      assert.ok((ok.expiresAt ?? 0) > Date.now())
    }
  } finally {
    restore()
  }
})

test('fetchQoderUserInfo: tolerant profile read', async () => {
  const restore = stubFetch(() => jsonResponse({ username: 'qd', email: 'qd@x.com', organization_id: 'org-2' }))
  try {
    assert.deepEqual(await fetchQoderUserInfo('https://openapi.qoder.sh/api/v1/userinfo', 'dt-abc'), {
      name: 'qd',
      email: 'qd@x.com',
      organizationId: 'org-2',
    })
  } finally {
    restore()
  }
  const restoreDown = stubFetch(() => {
    throw new Error('down')
  })
  try {
    assert.deepEqual(await fetchQoderUserInfo('https://openapi.qoder.sh/api/v1/userinfo', 'dt-abc'), {
      name: '',
      email: '',
      organizationId: '',
    })
  } finally {
    restoreDown()
  }
})

test('generatePkcePair: verifier + S256 challenge', async () => {
  const { verifier, challenge } = await generatePkcePair()
  assert.ok(verifier.length >= 40)
  assert.ok(!/[+/=]/.test(challenge), 'challenge is base64url')
})
