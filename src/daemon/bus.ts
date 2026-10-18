// The daemon's internal event bus. Services report what happened by emitting
// the same events clients receive, and react to each other by subscribing,
// so no service needs a reference to another and the socket server's only job
// on an event is to send it.
import type { EventName, Events } from '../shared/protocol'

export type Emit = <E extends EventName>(event: E, data: Events[E]) => void

type Handler<E extends EventName> = (data: Events[E]) => void

type AnyHandler = <E extends EventName>(event: E, data: Events[E]) => void

export class EventBus {
  private byEvent = new Map<EventName, Array<Handler<EventName>>>()
  private any: AnyHandler[] = []

  constructor(private opts: { log?: (msg: string) => void } = {}) {}

  /** Calls `handler` for each `event` from now on. Returns the function that stops it. */
  on<E extends EventName>(event: E, handler: Handler<E>): () => void {
    const list = this.byEvent.get(event) ?? []
    const h = handler as Handler<EventName>
    list.push(h)
    this.byEvent.set(event, list)

    return () => {
      const at = list.indexOf(h)

      if (at >= 0) list.splice(at, 1)
    }
  }

  /** Calls `handler` for every event. Returns the function that stops it. */
  onAny(handler: AnyHandler): () => void {
    this.any.push(handler)

    return () => {
      const at = this.any.indexOf(handler)

      if (at >= 0) this.any.splice(at, 1)
    }
  }

  /**
   * Runs every handler now, in subscription order (onAny handlers first). A
   * handler that throws is logged and the rest still run.
   */
  readonly emit: Emit = (event, data) => {
    const handlers: Array<() => void> = [
      ...this.any.map((h) => () => h(event, data)),
      ...(this.byEvent.get(event) ?? []).map((h) => () => h(data))
    ]

    for (const run of handlers) {
      try {
        run()
      } catch (error) {
        this.opts.log?.(
          `event ${event} handler threw: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }
}
