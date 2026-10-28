// The tokenizer worker: a worker thread the daemon starts (tokenizer.ts) so
// grammar loading and tokenizing never block the main thread, which pumps
// every terminal. Bundled on its own, next to the daemon bundle.
import { parentPort } from 'node:worker_threads'
import { tokenizeFile } from './highlight'

export interface TokenizeRequest {
  id: number
  text: string
  language: string | null
}

/**
 * Test-only: `QUE_TEST_TOKENIZER_FAULT=throw:<text>` makes the worker crash,
 * and `hang:<text>` spin forever, on a file containing <text>, so tests can
 * prove the daemon falls back to plain tokens. Unset everywhere else.
 */
function injectFault(text: string): void {
  const fault = process.env.QUE_TEST_TOKENIZER_FAULT ?? ''
  const at = fault.indexOf(':')

  if (at < 0 || !text.includes(fault.slice(at + 1))) return

  if (fault.startsWith('throw:')) throw new Error('tokenizer fault injected by a test')

  if (fault.startsWith('hang:')) for (;;);
}

parentPort?.on('message', (req: TokenizeRequest) => {
  injectFault(req.text)
  parentPort?.postMessage({ id: req.id, result: tokenizeFile(req.text, req.language) })
})
