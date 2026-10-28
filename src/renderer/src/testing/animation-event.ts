// jsdom has no AnimationEvent. React DOM picks the animation event names it listens for when
// it loads, and without the constructor it takes the old prefixed ones, which neither Chromium
// nor fireEvent sends; onAnimationIteration would never fire in a test. setup.ts imports this
// first, so the constructor is there before React DOM loads.
if (!window.AnimationEvent) {
  class FakeAnimationEvent extends Event {
    readonly animationName: string
    readonly elapsedTime: number
    readonly pseudoElement: string

    constructor(type: string, init: AnimationEventInit = {}) {
      super(type, init)
      this.animationName = init.animationName ?? ''
      this.elapsedTime = init.elapsedTime ?? 0
      this.pseudoElement = init.pseudoElement ?? ''
    }
  }

  window.AnimationEvent = FakeAnimationEvent
}
