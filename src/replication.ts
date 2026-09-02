/// <reference types="node" />

/**
 * Parse the high-water mark returned by a host mutation or status request.
 * The length is a receipt for the canonical append, not merely a hint.
 */
export function parseLengthReceipt(value: unknown, context: string): number {
  if (
    !value ||
    typeof value !== 'object' ||
    !Number.isInteger((value as Record<string, unknown>).length) ||
    ((value as Record<string, unknown>).length as number) < 0
  ) {
    throw new Error(`Host returned an invalid ${context}`)
  }
  return (value as Record<string, unknown>).length as number
}

async function waitForLength(core: any, expected: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (core.length < expected) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      throw new Error(`Timed out while syncing local core (have ${core.length}, need ${expected})`)
    }

    await new Promise<void>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined
      const cleanup = (): void => {
        if (timer) clearTimeout(timer)
        core.off('append', onAppend)
      }
      const onAppend = (): void => {
        cleanup()
        resolve()
      }
      timer = setTimeout(() => {
        cleanup()
        reject(new Error(`Timed out while syncing local core (have ${core.length}, need ${expected})`))
      }, remaining)

      core.once('append', onAppend)
      core.update().then(
        () => {
          if (core.length >= expected) onAppend()
        },
        (error: Error) => {
          cleanup()
          reject(error)
        }
      )
    })
  }
}

/**
 * Download and verify every block in the host-issued range.
 * Hypercore metadata reaching the receipt length alone is not sufficient.
 */
export async function downloadCoreCopy(core: any, expected: number, timeoutMs: number): Promise<void> {
  if (!Number.isInteger(expected) || expected < 0) throw new Error('Expected core length must be a non-negative integer')
  await waitForLength(core, expected, timeoutMs)
  if (expected === 0) return

  const range = core.download({ start: 0, end: expected })
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      range.done(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out downloading local core copy through block ${expected}`)),
          timeoutMs
        )
      })
    ])
  } catch (error) {
    range.destroy()
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }

  if (!(await core.has(0, expected))) {
    throw new Error(`Local core copy is incomplete through block ${expected}`)
  }
}
