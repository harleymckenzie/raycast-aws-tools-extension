// utils.ts

import { LocalStorage } from "@raycast/api";

export async function getCachedData<T>(key: string, version: number): Promise<T | null> {
  try {
    const cachedDataString = await LocalStorage.getItem<string>(key);
    if (cachedDataString) {
      const cachedData = JSON.parse(cachedDataString);
      if (cachedData.version === version) {
        return cachedData.data as T;
      }
    }
  } catch (error) {
    console.error("Error getting cached data:", error);
  }
  return null;
}

export async function setCachedData<T>(key: string, version: number, data: T): Promise<void> {
  try {
    const dataToCache = {
      version,
      data,
    };
    await LocalStorage.setItem(key, JSON.stringify(dataToCache));
  } catch (error) {
    console.error("Error setting cached data:", error);
  }
}

export function calculateCosts(pricePerHour: number | null) {
  const hourlyCost = pricePerHour ?? 0;
  const dailyCost = hourlyCost * 24;
  const monthlyCost = hourlyCost * 730; // Assuming 730 hours in a month
  return { hourlyCost, dailyCost, monthlyCost };
}

export function getNetworkThroughput(
  isFetchingBandwidth: boolean,
  baselineBandwidth: string | null,
  networkPerformance: string,
): string {
  if (isFetchingBandwidth) {
    return "Fetching baseline bandwidth...";
  } else if (baselineBandwidth) {
    return `${networkPerformance} | Baseline: ${baselineBandwidth}`;
  } else {
    return networkPerformance;
  }
}
