/**
 * Registration and assertions for scripts/test.mjs.
 *
 * Tests run against the real project database, so the contract every helper
 * here exists to keep is: a test can write whatever it likes and none of it
 * survives. See scripts/test.mjs for how that is enforced.
 */

export const suites = []

/** Declare a suite. The file that calls this is loaded by the runner. */
export function suite(name, body) {
  const tests = []
  body((testName, fn) => tests.push({ name: testName, fn }))
  suites.push({ name, tests })
}

// --- assertions ------------------------------------------------------------

export class AssertionError extends Error {}

function fail(message) {
  throw new AssertionError(message)
}

export function ok(value, what = 'expected a truthy value') {
  if (!value) fail(`${what} — got ${format(value)}`)
}

export function eq(actual, expected, what = 'values differ') {
  // Postgres returns bigint counts and numerics as strings; compare loosely on
  // purpose, so a test reads `eq(balance, 5)` rather than `eq(balance, '5')`.
  const a = typeof actual === 'string' && typeof expected === 'number' ? Number(actual) : actual
  if (!Object.is(a, expected)) {
    fail(`${what}\n      expected: ${format(expected)}\n      actual:   ${format(actual)}`)
  }
}

export function deepEq(actual, expected, what = 'values differ') {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) fail(`${what}\n      expected: ${b}\n      actual:   ${a}`)
}

/**
 * Assert a database call fails, and fails for the reason meant. An errcode is
 * part of the contract with the client: src/lib/ keys its messages off them,
 * so a function that starts raising a different code is a break even when the
 * English text is unchanged.
 */
export async function raises(fn, errcode, what = 'expected an error') {
  let error
  try {
    await fn()
  } catch (err) {
    error = err
  }
  if (!error) fail(`${what} — the call succeeded`)
  if (errcode && error.code !== errcode) {
    fail(`${what}\n      expected errcode: ${errcode}\n      actual errcode:   ${error.code}\n      message: ${error.message}`)
  }
  return error
}

function format(v) {
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}
