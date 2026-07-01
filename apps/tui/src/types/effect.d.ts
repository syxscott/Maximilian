declare module "effect" {
  export class Effect<T> {
    [key: string]: unknown
  }
  export function succeed<A>(a: A): Effect<A>
  export function fail<E>(e: E): Effect<never>
  export function runSync<A>(effect: Effect<A>): A
  export function runPromise<A>(effect: Effect<A>): Promise<A>
  export const Layer: {
    [key: string]: unknown
  }
}
