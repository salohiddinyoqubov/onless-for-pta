export type RussianPluralCategory = 'one' | 'few' | 'many';
export function russianPluralCategory(value: number): RussianPluralCategory {
  if (!Number.isFinite(value)) {
    throw new RangeError('Russian plural input must be finite');
  }

  const absolute = Math.abs(Math.trunc(value));
  const modulo10 = absolute % 10;
  const modulo100 = absolute % 100;
  if (modulo100 >= 11 && modulo100 <= 19) {
    return 'many';
  }
  if (modulo10 === 1) {
    return 'one';
  }
  if (modulo10 >= 2 && modulo10 <= 4) {
    return 'few';
  }
  return 'many';
}
export function ruPlural(
  value: number,
  one: string,
  few: string,
  many: string,
): string {
  return { one, few, many }[russianPluralCategory(value)];
}
