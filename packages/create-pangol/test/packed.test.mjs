import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'

const pkg = fileURLToPath(new URL('..', import.meta.url))
const framework = join(pkg, '../pangol')
// A child project is an independent test run, not a worker of this node:test process. Settings of
// an outer npm command (e.g. npm_config_dry_run=true during `npm publish --dry-run`, which runs this
// test from prepublishOnly) must not reach the npm commands below: `npm pack` would write nothing.
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)))
delete childEnv.NODE_TEST_CONTEXT
const command = (file, args, cwd, env = childEnv) => execFileSync(file, args, { cwd, env, encoding: 'utf8', timeout: 90_000, stdio: ['ignore', 'pipe', 'pipe'] })

test('packed initializer creates projects that check, test, build and serve on Node and Bun', { timeout: 180_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'create-pangol-packed-'))
  try {
    const stage = join(root, 'framework')
    mkdirSync(stage)
    cpSync(join(framework, 'package.json'), join(stage, 'package.json'))
    command(process.execPath, [join(framework, 'node_modules/typescript/bin/tsc'), '-p', join(framework, 'tsconfig.build.json'), '--outDir', join(stage, 'dist')], root)
    const pack = directory => {
      const result = JSON.parse(command('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], directory))
      return join(root, Object.values(result)[0].filename)
    }
    const initializerTarball = pack(pkg)
    const frameworkTarball = pack(stage)
    const runner = join(root, 'runner')
    mkdirSync(runner)
    writeFileSync(join(runner, 'package.json'), '{"private":true,"type":"module"}')
    command('npm', ['install', '--offline', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund', initializerTarball, frameworkTarball], runner)
    const modules = join(runner, 'node_modules')
    symlinkSync(join(framework, 'node_modules/typescript'), join(modules, 'typescript'), 'dir')
    mkdirSync(join(modules, '@types'), { recursive: true })
    symlinkSync(join(framework, 'node_modules/@types/node'), join(modules, '@types/node'), 'dir')
    symlinkSync(join(framework, 'node_modules/typescript/bin/tsc'), join(modules, '.bin/tsc'))
    const expectRegression = (project, title) => {
      let failure
      // Exercise Bun's colored reporter too: it uses ✗ instead of the plain (fail) label.
      try { command('npm', ['test'], project, { ...childEnv, FORCE_COLOR: '1' }) } catch (error) { failure = error }
      assert.ok(failure, `mutation must fail: ${title}`)
      assert.equal(failure.status, 1)
      const output = stripVTControlCharacters(`${failure.stdout}\n${failure.stderr}`)
      assert.ok(output.split('\n').some(line => /^(?:not ok \d+ - |\(fail\) |✗ )/.test(line) && line.includes(title)), output)
    }
    const coreVersion = JSON.parse(readFileSync(join(framework, 'package.json'), 'utf8')).version
    for (const runtime of ['node', 'bun']) {
      // The Bun template must be tested when this test runs under Bun (CI's bun job). Under Node (the
      // Node CI jobs and Node-only machines) Bun may be absent; then only the Node template runs here.
      if (runtime === 'bun') {
        try { command('bun', ['--version'], root) } catch (error) {
          if ('Bun' in globalThis) throw error
          continue
        }
      }
      const project = join(root, `${runtime}-app`)
      command(process.execPath, [join(modules, 'create-pangol/dist/main.js'), project, '--runtime', runtime], root)
      assert.equal(JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')).dependencies.pangol, coreVersion)
      symlinkSync(modules, join(project, 'node_modules'), 'dir')
      for (const script of ['check', 'test', 'build']) command('npm', ['run', script], project)
      // Exercise the selected adapter over HTTP; do not bind a fixed port in parallel CI jobs.
      writeFileSync(join(project, 'smoke.ts'), `import { serve } from 'pangol/${runtime}'\nimport { app } from './src/app.js'\nconst server = serve(app, { hostname: '127.0.0.1', port: 0 })\nconsole.log('PORT ' + ${runtime === 'node' ? "(server.address() as { port: number }).port" : 'server.port'})\n`)
      // Node's listen is asynchronous: emit the port from its listening event.
      if (runtime === 'node') writeFileSync(join(project, 'smoke.ts'), readFileSync(join(project, 'smoke.ts'), 'utf8').replace("console.log('PORT ' + (server.address() as { port: number }).port)", "server.on('listening', () => console.log('PORT ' + (server.address() as { port: number }).port))"))
      // A single string keeps the readiness line free of numeric console color escapes.
      // Force colors so this remains covered even when the parent terminal disables them.
      const child = spawn(runtime === 'node' ? process.execPath : 'bun', runtime === 'node' ? ['--import', 'pangol/register', 'smoke.ts'] : ['smoke.ts'], { cwd: project, env: { ...childEnv, FORCE_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      const diagnostic = reason => new Error(`${runtime} smoke server ${reason}\nstdout: ${JSON.stringify(stdout)}\nstderr: ${JSON.stringify(stderr)}`)
      child.stderr.on('data', chunk => { stderr += chunk })
      try {
        const port = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(diagnostic('did not report a port within 10000ms')), 10_000)
          child.stdout.on('data', chunk => {
            stdout += chunk
            const match = /PORT (\d+)/.exec(stdout)
            if (match) { clearTimeout(timer); resolve(Number(match[1])) }
          })
          child.once('error', error => { clearTimeout(timer); reject(error) })
          child.once('exit', (code, signal) => { clearTimeout(timer); reject(diagnostic(`exited (code=${code}, signal=${signal})`)) })
        })
        const res = await fetch(`http://127.0.0.1:${port}/health`)
        assert.equal(res.status, 200)
        assert.deepEqual(await res.json(), { ok: true })
      } finally {
        child.kill()
        await new Promise(resolve => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once('exit', resolve) })
      }
      // Mutation checks: prove generated tests detect real security regressions.
      const route = join(project, 'src/routes/posts/[id].get.ts')
      const source = readFileSync(route, 'utf8')
      writeFileSync(route, source.replace('post.authorId === c.user.id', 'true'))
      expectRegression(project, 'another user and missing resources both get 404')
      writeFileSync(route, source)
      const model = join(project, 'src/models.ts')
      const originalModel = readFileSync(model, 'utf8')
      writeFileSync(model, originalModel.replace('t.string().private()', 't.string()'))
      expectRegression(project, 'the owner gets only the public model fields')
      writeFileSync(model, originalModel)
      const auth = join(project, 'src/auth.ts')
      const originalAuth = readFileSync(auth, 'utf8')
      writeFileSync(auth, originalAuth.replace('resolve: () => null', "resolve: () => ({ id: 'ada', permissions: [] })"))
      expectRegression(project, 'production auth rejects missing and unverified credentials')
      writeFileSync(auth, originalAuth)
      command('npm', ['test'], project)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
