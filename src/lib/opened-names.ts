import { extractRawCovenantName } from './covenant-utils';

interface CovenantLike {
  action?: unknown;
  type?: unknown;
  items?: unknown;
}

interface TransactionOutputLike {
  covenant?: unknown;
}

/**
 * Return the raw (punycode) name from the first OPEN covenant output in a
 * decoded hsd transaction, or `null` when the transaction is not an OPEN.
 *
 * hsd exposes the covenant action either as a string (`"OPEN"`) or as a
 * numeric type (`OPEN = 2`). Both forms are accepted.
 */
export function findOpenedName(
  outputs: TransactionOutputLike[] | null | undefined,
): string | null {
  if (!Array.isArray(outputs)) return null;

  for (const output of outputs) {
    const covenant = output?.covenant as CovenantLike | undefined;
    if (!covenant) continue;

    const action = typeof covenant.action === 'string'
      ? covenant.action.toUpperCase()
      : '';
    const type = typeof covenant.type === 'number'
      ? covenant.type
      : (typeof covenant.action === 'number' ? covenant.action : -1);

    // OPEN = 2 in hsd's covenant type enum
    if (action !== 'OPEN' && type !== 2) continue;

    const items = Array.isArray(covenant.items)
      ? covenant.items as string[]
      : [];
    const name = extractRawCovenantName('OPEN', items);
    if (name) return name;
  }

  return null;
}
