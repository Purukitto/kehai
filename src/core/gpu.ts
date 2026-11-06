import type { GpuPayload } from './payloads';

/**
 * The card's model without the maker's names: "NVIDIA GeForce RTX 4070 SUPER"
 * reads as "RTX 4070 SUPER", "Intel(R) UHD Graphics 730" as "UHD 730".
 */
export function gpuModel(name: string): string {
  const short = name
    .replace(/\((R|TM)\)/gi, '')
    .replace(/\b(NVIDIA|GeForce|AMD|Radeon|Intel|Graphics)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return short || name;
}

/** Past the driver's own warning point. A card that gives none is never hot. */
export function gpuHot(gpu: GpuPayload | undefined): boolean {
  return !!gpu?.available && gpu.tempC !== null && gpu.warnC !== null && gpu.tempC >= gpu.warnC;
}

export function gpuTemp(gpu: GpuPayload | undefined): string {
  return gpu?.available && gpu.tempC !== null ? Math.round(gpu.tempC) + '°C' : '--°C';
}

/** Fan and power, whichever the driver gives, as one line. Empty when neither. */
export function gpuExtras(gpu: GpuPayload, join = ' · '): string {
  const parts: string[] = [];
  // Many cards stop their fans while cool, which a number reads as a fault.
  if (gpu.fanRpm !== null) parts.push(gpu.fanRpm === 0 ? 'fan stopped' : 'fan ' + gpu.fanRpm + ' rpm');
  if (gpu.powerPct !== null) parts.push('power ' + Math.round(gpu.powerPct) + '%');
  return parts.join(join);
}
