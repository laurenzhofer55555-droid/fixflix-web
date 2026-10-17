import { solveChallenge, type PowChallenge } from './pow'

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<PowChallenge>) => void) | null
  postMessage: (message: unknown) => void
}

scope.onmessage = (event) => {
  solveChallenge(event.data).then(
    (proof) => scope.postMessage({ proof }),
    (error: unknown) => scope.postMessage({ error: error instanceof Error ? error.message : 'failed' }),
  )
}
