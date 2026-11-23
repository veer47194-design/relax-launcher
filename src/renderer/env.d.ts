import type { RelaxApi } from '../shared/types'

declare global {
  interface Window {
    relax: RelaxApi
  }
}

export {}
