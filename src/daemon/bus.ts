// The daemon's internal event bus. Services report what happened by emitting
// the same events clients receive, and react to each other by subscribing,
// so no service needs a reference to another and the socket server's only job
// on an event is to send it.
import { errorMessage } from '../shared/errors.decode'
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

    this.byEvent.set(event, list)

    return this.add(list, handler as Handler<EventName>)
  }

  /** Calls `handler` for every event. Returns the function that stops it. */
  onAny(handler: AnyHandler): () => void {
    return this.add(this.any, handler)
  }

  /**
   * Runs every handler now, in subscription order (onAny handlers first). A
   * handler that throws is logged and the rest still run.
   */
  readonly emit: Emit = (event, data) => {
    // Iterate over copies: a handler may unsubscribe (splice) while we loop.
    for (const h of [...this.any]) this.run(event, () => h(event, data))

    for (const h of [...(this.byEvent.get(event) ?? [])]) this.run(event, () => h(data))
  }

  private add<T>(list: T[], item: T): () => void {
    list.push(item)

    return () => {
      const at = list.indexOf(item)

      if (at >= 0) list.splice(at, 1)
    }
  }

  private run(event: EventName, fn: () => void): void {
    try {
      fn()
    } catch (error) {
      this.opts.log?.(`event ${event} handler threw: ${errorMessage(error)}`)
    }
  }
}
