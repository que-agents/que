// The tokenizer worker: a worker thread the daemon starts (tokenizer.ts) so
// grammar loading and tokenizing never block the main thread, which pumps
// every terminal. Bundled on its own, next to the daemon bundle.
import { parentPort } from 'node:worker_threads'
import { tokenizeFile } from './highlight'
import type { TokenizedFile } from './syntax'

export interface TokenizeRequest {
  id: number
  text: string
  language: string | null
}

export interface TokenizeResponse {
  id: number
  result: TokenizedFile
}

/** Answers one request. */
export function answer(req: TokenizeRequest): TokenizeResponse {
  return { id: req.id, result: tokenizeFile(req.text, req.language) }
}

parentPort?.on('message', (req: TokenizeRequest) => {
  parentPort?.postMessage(answer(req))
})
