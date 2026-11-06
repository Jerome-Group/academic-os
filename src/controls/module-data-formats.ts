export function nativeNulFreeBytes(value: string): boolean {
  const bytes = Buffer.from(value, "base64");
  return (
    bytes.length > 0 && !bytes.includes(0) && bytes.toString("base64") === value
  );
}

export function moduleCalendarDate(value: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maximum = days[month - 1];
  return maximum !== undefined && day >= 1 && day <= maximum;
}
