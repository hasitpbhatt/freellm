import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_IMAGE_URL_CHARS,
  MAX_IMAGES_PER_REQUEST,
  MAX_MESSAGE_TEXT_CHARS,
  contentImageCount,
  contentTextLength,
  isAllowedImageUrl,
  parseOpenAiMessages,
} from '../functions/lib/openai-messages'

const imagePart = (url = 'data:image/jpeg;base64,AAAA') => ({
  type: 'image_url' as const,
  image_url: { url },
})

function parse(raw: unknown) {
  const result = parseOpenAiMessages(raw)
  if (!result.ok) assert.fail(result.error)
  return result.messages
}

test('parseOpenAiMessages: plain string content passes through', () => {
  const messages = parse([
    { role: 'system', content: 'be brief' },
    { role: 'user', content: 'hello' },
  ])
  assert.deepEqual(messages, [
    { role: 'system', content: 'be brief' },
    { role: 'user', content: 'hello' },
  ])
})

test('parseOpenAiMessages: multimodal text + image parts are preserved', () => {
  const messages = parse([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Estimate calories' },
        imagePart('data:image/jpeg;base64,BBBB'),
      ],
    },
  ])
  assert.equal(messages.length, 1)
  assert.equal(Array.isArray(messages[0].content), true)
  const parts = messages[0].content as Array<{ type: string; text?: string; image_url?: { url: string } }>
  assert.deepEqual(parts[0], { type: 'text', text: 'Estimate calories' })
  assert.deepEqual(parts[1], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BBBB' } })
})

test('parseOpenAiMessages: image detail is kept, unknown fields dropped', () => {
  const messages = parse([
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: 'https://example.com/meal.jpg', detail: 'low', extra: 'x' },
        },
      ],
    },
  ])
  assert.deepEqual((messages[0].content as unknown[])[0], {
    type: 'image_url',
    image_url: { url: 'https://example.com/meal.jpg', detail: 'low' },
  })
})

test('parseOpenAiMessages: an unsupported part rejects the request', () => {
  const result = parseOpenAiMessages([{ role: 'user', content: [{ type: 'audio', data: 'x' }] }])
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /messages\[0\]\.content/)
})

test('parseOpenAiMessages: an empty image URL rejects the request', () => {
  const result = parseOpenAiMessages([{ role: 'user', content: [imagePart('')] }])
  assert.equal(result.ok, false)
})

test('parseOpenAiMessages: an unsupported role rejects the request', () => {
  const result = parseOpenAiMessages([
    { role: 'user', content: 'ok' },
    { role: 'tool', content: 'dropped role' },
  ])
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /messages\[1\]\.role/)
})

test('parseOpenAiMessages: requests exceeding the image budget are rejected', () => {
  const content = Array.from({ length: MAX_IMAGES_PER_REQUEST + 1 }, () => imagePart())
  const result = parseOpenAiMessages([{ role: 'user', content }])
  assert.equal(result.ok, false)
})

test('parseOpenAiMessages: the image budget spans messages', () => {
  const content = Array.from({ length: MAX_IMAGES_PER_REQUEST }, () => imagePart())
  const result = parseOpenAiMessages([
    { role: 'user', content },
    { role: 'user', content: [imagePart()] },
  ])
  assert.equal(result.ok, false, 'the ninth image must reject the whole request')

  const withinBudget = parse([
    { role: 'user', content },
    { role: 'user', content: 'text still fits' },
  ])
  assert.equal(withinBudget.length, 2)
  assert.equal(withinBudget.reduce((n, m) => n + contentImageCount(m.content), 0), MAX_IMAGES_PER_REQUEST)
  assert.equal(withinBudget[1].content, 'text still fits')
})

test('parseOpenAiMessages: oversized image URLs are rejected', () => {
  const result = parseOpenAiMessages([
    { role: 'user', content: [imagePart(`data:image/jpeg;base64,${'A'.repeat(MAX_IMAGE_URL_CHARS + 1)}`)] },
  ])
  assert.equal(result.ok, false)
})

test('parseOpenAiMessages: oversized text messages are rejected', () => {
  const plain = parseOpenAiMessages([{ role: 'user', content: 'a'.repeat(MAX_MESSAGE_TEXT_CHARS + 1) }])
  const part = parseOpenAiMessages([
    { role: 'user', content: [{ type: 'text', text: 'b'.repeat(MAX_MESSAGE_TEXT_CHARS + 1) }] },
  ])
  assert.equal(plain.ok, false)
  assert.equal(part.ok, false)
})

test('image URLs: only public HTTPS and base64 image data are forwarded', () => {
  assert.equal(isAllowedImageUrl('https://example.com/meal.jpg'), true)
  assert.equal(isAllowedImageUrl('data:image/png;base64,AAAA'), true)
  assert.equal(isAllowedImageUrl('data:image/jpeg;base64,AAAA'), true)
  assert.equal(isAllowedImageUrl('http://example.com/meal.jpg'), false)
  assert.equal(isAllowedImageUrl('file:///etc/passwd'), false)
  assert.equal(isAllowedImageUrl('data:image/svg+xml;base64,AAAA'), false)
  assert.equal(isAllowedImageUrl('data:text/html;base64,AAAA'), false)
  assert.equal(isAllowedImageUrl('https://localhost/a.jpg'), false)
  assert.equal(isAllowedImageUrl('https://127.0.0.1/a.jpg'), false)
  assert.equal(isAllowedImageUrl('https://[::1]/a.jpg'), false)
  assert.equal(isAllowedImageUrl('https://10.0.0.1/a.jpg'), false)
  assert.equal(isAllowedImageUrl('https://192.168.1.2/a.jpg'), false)
  assert.equal(isAllowedImageUrl('https://172.20.0.1/a.jpg'), false)
  assert.equal(isAllowedImageUrl('https://169.254.169.254/latest/meta-data'), false)
  assert.equal(isAllowedImageUrl('https://metadata.google.internal/x'), false)
  assert.equal(isAllowedImageUrl('not a url'), false)
})

test('image detail only accepts auto, low, or high', () => {
  const messages = parse([
    {
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'https://example.com/a.jpg', detail: 'ultra' } }],
    },
  ])
  assert.deepEqual((messages[0].content as unknown[])[0], {
    type: 'image_url',
    image_url: { url: 'https://example.com/a.jpg' },
  })
})

test('contentTextLength / contentImageCount sum parts', () => {
  const content = [
    { type: 'text' as const, text: 'abcd' },
    imagePart(),
    { type: 'text' as const, text: 'ef' },
  ]
  assert.equal(contentTextLength(content), 6)
  assert.equal(contentImageCount(content), 1)
  assert.equal(contentTextLength('plain'), 5)
  assert.equal(contentImageCount('plain'), 0)
})
