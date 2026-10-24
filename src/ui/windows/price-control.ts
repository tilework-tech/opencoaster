import { element, iconButton } from '../dom';
import { MAX_PRICE_CENTS, parsePriceCents, stepPrice } from '../format';

export interface PriceControl {
  root: HTMLElement;
  input: HTMLInputElement;
  /** Shows the authoritative price unless the player is typing. */
  show(cents: number): void;
}

/** A − / $ amount / + control. Every change is sent through `onSet` as whole cents. */
export function priceControl(
  label: string,
  onSet: (cents: number) => void,
  max = MAX_PRICE_CENTS,
): PriceControl {
  const root = element('div', 'price-control');
  const input = element('input', 'price-input');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.setAttribute('aria-label', label);
  let current = 0;
  const commit = (cents: number): void => {
    current = cents;
    input.value = (cents / 100).toFixed(2);
    onSet(cents);
  };
  input.addEventListener('change', () => {
    const parsed = parsePriceCents(input.value);
    if (parsed === null) input.value = (current / 100).toFixed(2);
    else commit(parsed);
  });
  root.append(
    iconButton('minus', `Decrease ${label}`, () => commit(stepPrice(current, -1, max))),
    element('span', 'price-symbol', '$'),
    input,
    iconButton('plus', `Increase ${label}`, () => commit(stepPrice(current, 1, max))),
  );
  return {
    root,
    input,
    show(cents) {
      current = cents;
      if (document.activeElement !== input) input.value = (cents / 100).toFixed(2);
    },
  };
}
