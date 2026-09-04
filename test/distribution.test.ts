/// <reference types="node" />
import assert from 'node:assert/strict'
import { constants } from 'node:fs'
import { access, chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { runCli } from '../src/cli.js'

const execFileAsync = promisify(execFile)

function parseJson<T>(value: string, source: string): T {
  try {
    return JSON.parse(value) as T
  } catch (error) {
    throw new Error(`Invalid JSON in ${source}`, { cause: error })
  }
}

test('package metadata and CLI usage expose hackvault', async () => {
  const packageJson = parseJson<{
    name: string
    bin: Record<string, string>
    main: string
    types: string
    exports: Record<string, unknown>
    files: string[]
  }>(
    await readFile('package.json', 'utf8'),
    'package.json'
  )
  const packageLock = parseJson<{
    name: string
    packages: Record<string, { name?: string; bin?: Record<string, string> }>
  }>(await readFile('package-lock.json', 'utf8'), 'package-lock.json')

  assert.equal(packageJson.name, 'hackvault')
  assert.deepEqual(packageJson.bin, { hackvault: 'dist/cli.js' })
  assert.equal(packageJson.main, 'dist/index.js')
  assert.equal(packageJson.types, 'dist/index.d.ts')
  assert.deepEqual(packageJson.exports, {
    '.': { types: './dist/index.d.ts', import: './dist/index.js' }
  })
  assert.equal(packageJson.files.includes('skills/hackvault-context/SKILL.md'), true)
  assert.equal(packageLock.name, 'hackvault')
  assert.equal(packageLock.packages[''].name, 'hackvault')
  assert.deepEqual(packageLock.packages[''].bin, { hackvault: 'dist/cli.js' })

  await assert.rejects(runCli([]), (error) => {
    const message = String(error)
    for (const command of ['host start', 'join', 'sync', 'add', 'list', 'get']) {
      assert.equal(message.includes(`hackvault ${command}`), true)
    }
    assert.doesNotMatch(message, /pears-vault host start/)
    return true
  })
})

test('help prints usage and exits successfully', async () => {
  const output: string[] = []
  const originalLog = console.log
  console.log = (...values: unknown[]) => output.push(values.join(' '))
  try {
    await runCli(['--help'])
    await runCli(['-h'])
  } finally {
    console.log = originalLog
  }

  assert.equal(output.length, 2)
  assert.match(output[0], /hackvault host start/)
  assert.equal(output[1], output[0])
})

test(
  'installer is repeatable and removes only its managed installation',
  {
    timeout: 30_000
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'hackvault-installer-'))
    const sourceDir = join(root, 'source')
    const installRoot = join(root, 'share', 'hackvault')
    const binDir = join(root, 'bin')
    const wrapper = join(binDir, 'hackvault')

    try {
      await mkdir(join(sourceDir, 'dist'), { recursive: true })
      await writeFile(
        join(sourceDir, 'package.json'),
        JSON.stringify({
          name: 'hackvault',
          version: '0.0.0-test',
          type: 'module',
          scripts: {
            build: "node -e \"require('fs').accessSync('dist/cli.js')\""
          },
          dependencies: {}
        })
      )
      await writeFile(join(sourceDir, 'dist', 'cli.js'), "#!/usr/bin/env node\nconsole.log('fake-hackvault')\n")
      await chmod(join(sourceDir, 'dist', 'cli.js'), 0o755)
      await mkdir(join(sourceDir, 'skills', 'hackvault-context'), { recursive: true })
      await writeFile(join(sourceDir, 'skills', 'hackvault-context', 'SKILL.md'), '# fake context skill\n')

      const env = {
        ...process.env,
        HACKVAULT_SOURCE_DIR: sourceDir,
        HACKVAULT_INSTALL_ROOT: installRoot,
        HACKVAULT_BIN_DIR: binDir
      }

      const first = await execFileAsync('bash', ['scripts/install.sh'], { env })
      assert.match(first.stdout, /Installed hackvault/)
      await access(wrapper, constants.X_OK)
      assert.match(await readFile(wrapper, 'utf8'), /hackvault-installer-managed/)
      assert.equal((await execFileAsync(wrapper, [], { env })).stdout.trim(), 'fake-hackvault')
      assert.equal(
        await readFile(join(installRoot, 'skills', 'hackvault-context', 'SKILL.md'), 'utf8'),
        '# fake context skill\n'
      )

      const second = await execFileAsync('bash', ['scripts/install.sh'], { env })
      assert.match(second.stdout, /Installed hackvault/)
      assert.equal((await execFileAsync(wrapper, [], { env })).stdout.trim(), 'fake-hackvault')

      const removed = await execFileAsync('bash', ['scripts/install.sh', '--uninstall'], { env })
      assert.match(removed.stdout, /Uninstalled hackvault/)
      await assert.rejects(access(wrapper), { code: 'ENOENT' })
      await assert.rejects(access(installRoot), { code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
)
