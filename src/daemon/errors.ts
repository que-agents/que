import { ErrorCodes } from '../shared/protocol'

/** An error the daemon reports to the client as `{ code, message }`. */
export class RpcError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

export const badRequest = (msg: string): RpcError => new RpcError(ErrorCodes.BadRequest, msg)
export const notFound = (msg: string): RpcError => new RpcError(ErrorCodes.NotFound, msg)
export const conflict = (msg: string): RpcError => new RpcError(ErrorCodes.Conflict, msg)

/** The GitHub CLI failed; the message is its first stderr line. */
export const GH_FAILED = 'gh_failed'
export const ghFailed = (msg: string): RpcError => new RpcError(GH_FAILED, msg)
