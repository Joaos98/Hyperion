import Database from 'better-sqlite3'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import type { User } from '../domain/index.js'
import { SqliteStore } from '../storage/sqlite-store.js'
import { hashPassword } from './auth.js'

/**
 * The break-glass password reset, run against the SQLite file (plan § Users and access:
 * "An Admin resets other Users' passwords; the Admin's own reset is a command run against
 * the SQLite file"). Hyperion has no SMTP and never will, so a sole Admin who forgets
 * their password has no route back in through the app itself — this is that route.
 *
 * Deliberately not restricted to Admins: whoever can run this already holds the database
 * file, and every record in it. A permission check here would protect nothing and would
 * lock out the one case the command exists for.
 *
 *   npm run reset-password -- "Your Name"
 *   docker compose exec hyperion node dist-server/reset-password.js "Your Name"
 *
 * The new password is read from stdin, never from argv — an argument would sit in shell
 * history and in `ps` output for every other process on the box to read.
 */
export async function resetPassword(store: SqliteStore, displayName: string, password: string): Promise<User> {
  const user = await store.findUserByDisplayName(displayName)
  if (!user) throw new Error(`No account named ${JSON.stringify(displayName)}.`)
  if (password.length === 0) throw new Error('A new password is required.')
  await store.setPasswordHash(user.id, await hashPassword(password))
  // Same as the Admin-facing route does: a reset that left old Sessions alive would not be
  // a reset at all for anyone already signed in elsewhere.
  await store.deleteSessionsForUser(user.id)
  return user
}

/** Every account by name, so a mistyped or half-remembered one can be found rather than guessed at. */
function describeUsers(users: readonly User[]): string {
  if (users.length === 0) return '  (no accounts yet — open /setup instead)'
  return users.map((user) => `  ${user.displayName}${user.isAdmin ? '  [admin]' : ''}`).join('\n')
}

/**
 * Reads one line without echoing it. `_writeToOutput` is readline's own seam for this and
 * has no public equivalent; a password typed in the clear on a shared terminal is the
 * worse trade.
 */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    let hide = false
    ;(rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput = (text) => {
      if (!hide) process.stdout.write(text)
    }
    rl.question(prompt, (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
    hide = true
  })
}

/** Everything on stdin, for `echo secret | npm run reset-password -- Name` and for CI. */
function readPiped(): Promise<string> {
  return new Promise((resolve) => {
    let text = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (text += chunk))
    process.stdin.on('end', () => resolve(text.replace(/\r?\n$/, '')))
  })
}

async function main(): Promise<void> {
  const database = process.env['HYPERION_DATABASE'] ?? 'data/hyperion.db'
  const displayName = process.argv[2]
  const db = new Database(database)
  const store = new SqliteStore(db)

  try {
    if (!displayName) {
      console.error(`Usage: npm run reset-password -- "<display name>"\n\nAccounts in ${database}:\n${describeUsers(await store.allUsers())}`)
      process.exitCode = 1
      return
    }

    if (!(await store.findUserByDisplayName(displayName))) {
      console.error(`No account named ${JSON.stringify(displayName)} in ${database}.\n\nAccounts:\n${describeUsers(await store.allUsers())}`)
      process.exitCode = 1
      return
    }

    let password: string
    if (process.stdin.isTTY) {
      password = await askHidden(`New password for ${displayName}: `)
      const again = await askHidden('Again: ')
      if (password !== again) {
        console.error('Those did not match. Nothing was changed.')
        process.exitCode = 1
        return
      }
    } else {
      password = await readPiped()
    }

    const user = await resetPassword(store, displayName, password)
    console.log(`Password reset for ${user.displayName}. Every existing session for that account has been signed out.`)
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause))
    process.exitCode = 1
  } finally {
    db.close()
  }
}

// Only when run as a command — importing this module (the tests do) must reset nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
