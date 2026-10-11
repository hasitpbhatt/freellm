// The project package.json declares "type": "module", which makes Node treat
// every .js file under it as ESM. The test build (tsconfig.test.json) emits
// CommonJS for `node --test`, so it needs a nested package.json marker — same
// trick tsc uses for --module nodenext output.
const fs = require('node:fs')

fs.mkdirSync('build-test', { recursive: true })
fs.writeFileSync('build-test/package.json', `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`)
