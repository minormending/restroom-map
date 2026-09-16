#!/usr/bin/env node
/**
 * Before-and-after screenshots for the branch you are on, published somewhere
 * a pull request can show them.
 *
 *   node scripts/pr-shots.mjs menu feedback         capture, publish, print markdown
 *   node scripts/pr-shots.mjs --dry-run menu        capture and diff, publish nothing
 *   node scripts/pr-shots.mjs --base main menu      compare against something else
 *
 * Prints a markdown table to stdout. Paste it into the PR body, or let the
 * triage process do that.
 *
 * HOW THE IMAGES REACH GITHUB
 *
 * A PR body can only show an image it can fetch. There is no API for attaching
 * one — the web UI does it by hand — so they go on an orphan branch, `pr-shots`,
 * and are linked by raw URL. The branch shares no history with main and is
 * never merged, so nothing binary ever lands in the tree somebody clones.
 *
 * This only works because the repo is public: raw.githubusercontent.com will
 * not serve a private one to an unauthenticated reader, and a PR body full of
 * broken images is worse than a PR body with none.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not commit, push the working branch, or open anything. It captures,
 * compares, publishes images and prints markdown. Whoever called it decides
 * what to do with that.
 */
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync, readdirSync, readFileSync, writeFileSync, cpSync, mkdirSync, rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { ROOT } from './lib/connect.mjs'

const SHOTS_BRANCH = 'pr-shots'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const baseAt = args.indexOf('--base')
const base = baseAt === -1 ? 'main' : args[baseAt + 1]
const states = args.filter((a, i) => !a.startsWith('--') && i !== baseAt + 1)

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim()
const sh = (cmd, a, opts = {}) =>
  execFileSync(cmd, a, { cwd: ROOT, stdio: 'inherit', ...opts })

const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
if (branch === base) {
  console.error(`On ${base}. There is nothing to compare — check out the branch first.`)
  process.exit(1)
}
if (git('status', '--porcelain')) {
  console.error('Working tree is dirty. Commit or stash first: this checks out ' +
    `${base} to take the "before" shots and will not risk your changes.`)
  process.exit(1)
}

const work = mkdtempSync(join(tmpdir(), 'pr-shots-'))
const beforeDir = join(work, 'before')
const afterDir = join(work, 'after')

const capture = (out) =>
  sh('node', ['scripts/shots.mjs', '--out', out, ...states], { stdio: 'inherit' })

console.log(`\n=== after: ${branch} ===`)
capture(afterDir)

console.log(`\n=== before: ${base} ===`)

/**
 * The same instrument on both sides.
 *
 * `git checkout main` would take this branch's version of the harness away
 * with it, and on a base predating the harness there would be nothing to run
 * at all. Worse: a branch that *changes* shots.mjs would measure its "before"
 * with the old capture logic and its "after" with the new one, and the
 * difference in the pictures would be the instrument rather than the app.
 *
 * So the harness is carried across, written into the checked-out tree, and
 * removed again before switching back.
 */
const HARNESS = ['scripts/shots.mjs', 'scripts/lib/connect.mjs',
                 'fixtures/bathrooms-in-view.json']
// From the base, not the working tree: the instrument belongs to main, so a
// branch cannot change it and measure itself with the changed version.
const carried = HARNESS.map((f) => [f,
  execFileSync('git', ['show', `${base}:${f}`], { cwd: ROOT, maxBuffer: 1 << 24 })])

// Detached, so the branch ref is untouched. Restored in the finally below
// even if a capture throws.
const head = git('rev-parse', 'HEAD')
try {
  git('checkout', '--detach', base)
  for (const [f, body] of carried) {
    mkdirSync(join(ROOT, dirname(f)), { recursive: true })
    writeFileSync(join(ROOT, f), body)
  }
  capture(beforeDir)
} finally {
  // Whatever the base tracked comes back; whatever it did not, goes.
  git('checkout', '--', '.')
  execFileSync('git', ['clean', '-fdq', 'scripts', 'fixtures'], { cwd: ROOT })
  git('checkout', '--detach', head)
  git('checkout', branch)
}

// --- compare ----------------------------------------------------------------

const digest = (dir, name) =>
  createHash('sha256').update(readFileSync(join(dir, name))).digest('hex')

const shots = readdirSync(afterDir).filter((f) => f.endsWith('.png')).sort()
const changed = shots.filter((f) => {
  try {
    return digest(beforeDir, f) !== digest(afterDir, f)
  } catch {
    return true   // new state: it did not exist on base
  }
})

console.log(`\n${changed.length} of ${shots.length} states changed` +
  (changed.length ? `: ${changed.map((f) => f.replace('.png', '')).join(', ')}` : ''))

if (changed.length === 0) {
  console.log('\nNothing visual to show. That is worth knowing too — say so in the PR.')
  process.exit(0)
}
if (dryRun) {
  console.log(`\nDry run. Images are in ${work}`)
  process.exit(0)
}

// --- publish ----------------------------------------------------------------

const slug = `${branch.replace(/[^a-zA-Z0-9._-]/g, '-')}-${head.slice(0, 7)}`
const pub = mkdtempSync(join(tmpdir(), 'pr-shots-pub-'))

const remote = git('remote', 'get-url', 'origin')
const gitIn = (dir, ...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim()

// First run makes the branch. It is an orphan: no history in common with
// main, so nothing here can ever be merged into the tree by accident.
try {
  execFileSync('git', ['clone', '--depth', '1', '--branch', SHOTS_BRANCH, remote, pub],
    { stdio: 'ignore' })
} catch {
  execFileSync('git', ['clone', '--depth', '1', remote, pub], { stdio: 'ignore' })
  gitIn(pub, 'checkout', '--orphan', SHOTS_BRANCH)
  execFileSync('git', ['rm', '-rf', '--quiet', '.'], { cwd: pub, stdio: 'ignore' })
  writeFileSync(join(pub, 'README.md'), [
    '# Pull request screenshots',
    '',
    'Images linked from pull request bodies. Built by `scripts/pr-shots.mjs`.',
    '',
    'This branch shares no history with main and is never merged. Deleting a',
    'directory here only breaks the pictures in a closed pull request.',
    '',
  ].join('\n'))
  gitIn(pub, 'add', 'README.md')
  gitIn(pub, 'commit', '-m', 'Start the screenshot branch')
}

const dest = join(pub, slug)
rmSync(dest, { recursive: true, force: true })
mkdirSync(join(dest, 'before'), { recursive: true })
mkdirSync(join(dest, 'after'), { recursive: true })
for (const f of changed) {
  try { cpSync(join(beforeDir, f), join(dest, 'before', f)) } catch { /* new state */ }
  cpSync(join(afterDir, f), join(dest, 'after', f))
}

gitIn(pub, 'add', '-A')
gitIn(pub, 'commit', '-m', `shots: ${branch} @ ${head.slice(0, 7)}`)
gitIn(pub, 'push', 'origin', SHOTS_BRANCH)

const owner = remote.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '')
const raw = (kind, f) =>
  `https://raw.githubusercontent.com/${owner}/${SHOTS_BRANCH}/${slug}/${kind}/${f}`

console.log(`\n--- paste into the PR ---\n`)
console.log(`### Before and after\n`)
console.log(`${states.length ? '' : 'Every state captured; '}` +
  `${changed.length} changed, at 375×812.\n`)
console.log('| | before | after |')
console.log('| --- | --- | --- |')
for (const f of changed) {
  const name = f.replace('.png', '')
  const had = readdirSync(join(dest, 'before')).includes(f)
  console.log(`| **${name}** | ${had ? `<img src="${raw('before', f)}" width="280">` : '_new_'} ` +
    `| <img src="${raw('after', f)}" width="280"> |`)
}
console.log(`\n<sub>Rendered by \`scripts/pr-shots.mjs\` against fixtures; ` +
  `the map canvas is hidden because its tiles never paint the same way twice.</sub>`)
