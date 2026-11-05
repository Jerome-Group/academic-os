export function isCalendarDay(value: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (days[month - 1] ?? 0)
  );
}

export function isAcademicYear(value: string): boolean {
  if (/^[0-9]{4}$/u.test(value)) return Number(value) >= 1;
  const match = /^([0-9]{4})-([0-9]{4})$/u.exec(value);
  return (
    match !== null &&
    Number(match[1]) >= 1 &&
    Number(match[2]) === Number(match[1]) + 1
  );
}

export function isNumericToken(token: string): boolean {
  return (
    /^[0-9]{1,2}$/u.test(token) || isAcademicYear(token) || isCalendarDay(token)
  );
}
