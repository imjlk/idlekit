export type Suffixer =
  | {
      kind: "alphaInfinite";
      minLen?: number;
    }
  | {
      kind: "table";
      table: string[];
    };

function assertValidMinLen(minLen: number): void {
  if (!Number.isInteger(minLen) || minLen < 1) {
    throw new Error(`alphaInfinite minLen must be an integer >= 1 (received: ${minLen})`);
  }
}

function pow26(exp: number): number {
  return 26 ** exp;
}

function countBeforeLength(length: number, minLen: number): number {
  let total = 0;
  for (let len = minLen; len < length; len++) total += pow26(len);
  return total;
}

// 1 -> aa, 26 -> az, 27 -> ba, 676 -> zz, 677 -> aaa (minLen=2)
export function alphaInfiniteSuffix(index: number, minLen = 2): string {
  assertValidMinLen(minLen);
  if (!Number.isFinite(index) || index <= 0) return "";

  let remaining = Math.floor(index);
  let length = minLen;
  while (true) {
    const count = pow26(length);
    if (remaining <= count) break;
    remaining -= count;
    length += 1;
  }

  let offset = remaining - 1;
  const chars = new Array<string>(length);
  for (let pos = length - 1; pos >= 0; pos--) {
    const digit = offset % 26;
    chars[pos] = String.fromCharCode(97 + digit);
    offset = Math.floor(offset / 26);
  }
  return chars.join("");
}

export function alphaInfiniteIndex(label: string, minLen = 2): number {
  assertValidMinLen(minLen);
  const s = label.trim().toLowerCase();
  if (s.length < minLen) return -1;

  let offset = 0;
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code < 97 || code > 122) return -1;
    offset = offset * 26 + (code - 97);
  }

  const prior = countBeforeLength(s.length, minLen);
  return prior + offset + 1;
}
