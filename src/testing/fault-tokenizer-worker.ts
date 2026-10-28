// Test-only stand-in for the daemon's tokenizer worker (highlight-worker.ts):
// it tokenizes like the real one, except that QUE_TEST_TOKENIZER_FAULT makes
// it crash (`throw:<text>`) or spin forever (`hang:<text>`) on a file holding
// <text>. Tests bundle it (bundle.ts) and hand it to the daemon as its
// tokenizer worker, to prove a failing tokenizer gives plain tokens.
import { parentPort } from 'node:worker_threads'
import type { TokenizeRequest, TokenizeResponse } from '@daemon/highlight-worker'
import { tokenizeFile } from '@daemon/highlight'

parentPort?.on('message', (req: TokenizeRequest) => {
  const fault = process.env.QUE_TEST_TOKENIZER_FAULT ?? ''
  const at = fault.indexOf(':')

  if (at >= 0 && req.text.includes(fault.slice(at + 1))) {
    if (fault.startsWith('throw:')) throw new Error('tokenizer fault injected by a test')

    if (fault.startsWith('hang:')) for (;;);
  }

  const res: TokenizeResponse = { id: req.id, result: tokenizeFile(req.text, req.language) }
  parentPort?.postMessage(res)
})
