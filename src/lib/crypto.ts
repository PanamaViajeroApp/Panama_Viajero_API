const encoder = new TextEncoder()
const passwordAlgorithm = 'pbkdf2-sha256'
const passwordIterations = 100_000
const passwordHashLength = 32
const passwordSaltLength = 16

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

async function derivePassword(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    },
    passwordKey,
    passwordHashLength * 8,
  )

  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(passwordSaltLength))
  const hash = await derivePassword(password, salt, passwordIterations)

  return [
    passwordAlgorithm,
    passwordIterations,
    toBase64Url(salt),
    toBase64Url(hash),
  ].join('$')
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [algorithm, iterationValue, saltValue, hashValue] = storedHash.split('$')
  const iterations = Number(iterationValue)

  if (
    algorithm !== passwordAlgorithm
    || !Number.isInteger(iterations)
    || iterations < 1
    || !saltValue
    || !hashValue
  ) {
    return false
  }

  try {
    const salt = fromBase64Url(saltValue)
    const expectedHash = fromBase64Url(hashValue)
    const actualHash = await derivePassword(password, salt, iterations)

    return crypto.subtle.timingSafeEqual(actualHash, expectedHash)
  } catch {
    return false
  }
}

export function createSecureToken(byteLength = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)))
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token))
  return toBase64Url(new Uint8Array(digest))
}

export async function safeEqualStrings(
  firstValue: string,
  secondValue: string,
): Promise<boolean> {
  const [firstHash, secondHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(firstValue)),
    crypto.subtle.digest('SHA-256', encoder.encode(secondValue)),
  ])

  return crypto.subtle.timingSafeEqual(firstHash, secondHash)
}
