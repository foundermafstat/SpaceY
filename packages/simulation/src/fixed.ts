export function normalizeFixedAxis(
  x: number,
  y: number,
  scale: number,
  fallbackX: number,
  fallbackY: number
): { x: number; y: number } {
  if (x === 0 && y === 0) return { x: fallbackX, y: fallbackY };
  const bigX = BigInt(x);
  const bigY = BigInt(y);
  const scaleBig = BigInt(scale);
  const lengthSquared = bigX * bigX + bigY * bigY;
  if (lengthSquared <= scaleBig * scaleBig) return { x, y };
  const length = integerSquareRoot(lengthSquared);
  return {
    x: Number((bigX * scaleBig) / length),
    y: Number((bigY * scaleBig) / length)
  };
}

export function fixedRotationMilliRadians(x: number, y: number): number {
  if (x === 0 && y === 0) return 0;
  const absY = Math.abs(y) + 1;
  let angle: number;
  if (x >= 0) {
    const ratioMilli = Math.trunc(((x - absY) * 1_000) / (x + absY));
    angle = 785 - Math.trunc((785 * ratioMilli) / 1_000);
  } else {
    const ratioMilli = Math.trunc(((x + absY) * 1_000) / (absY - x));
    angle = 2_356 - Math.trunc((785 * ratioMilli) / 1_000);
  }
  return y < 0 ? -angle : angle;
}

export function isWithinFixedRadius(
  leftX: number,
  leftY: number,
  rightX: number,
  rightY: number,
  radius: number
): boolean {
  const dx = BigInt(leftX - rightX);
  const dy = BigInt(leftY - rightY);
  const fixedRadius = BigInt(radius);
  return dx * dx + dy * dy <= fixedRadius * fixedRadius;
}

export function segmentIntersectsFixedCircle(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  centerX: number,
  centerY: number,
  radius: number
): boolean {
  const segmentX = BigInt(endX - startX);
  const segmentY = BigInt(endY - startY);
  const fromStartX = BigInt(centerX - startX);
  const fromStartY = BigInt(centerY - startY);
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared === 0n) {
    return isWithinFixedRadius(startX, startY, centerX, centerY, radius);
  }
  const projection = fromStartX * segmentX + fromStartY * segmentY;
  if (projection <= 0n) return isWithinFixedRadius(startX, startY, centerX, centerY, radius);
  if (projection >= lengthSquared) return isWithinFixedRadius(endX, endY, centerX, centerY, radius);
  const cross = fromStartX * segmentY - fromStartY * segmentX;
  const fixedRadius = BigInt(radius);
  return cross * cross <= fixedRadius * fixedRadius * lengthSquared;
}

export function ceilPositiveRatio(numerator: number, denominator: number): number {
  return Math.trunc((numerator + denominator - 1) / denominator);
}

function integerSquareRoot(value: bigint): bigint {
  if (value < 0n) throw new Error("Cannot calculate a square root for a negative integer.");
  if (value < 2n) return value;
  let low = 1n;
  let high = value;
  while (low <= high) {
    const middle = (low + high) >> 1n;
    const square = middle * middle;
    if (square === value) return middle;
    if (square < value) low = middle + 1n;
    else high = middle - 1n;
  }
  return high;
}
