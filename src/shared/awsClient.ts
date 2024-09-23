// awsClient.ts

import { PricingClient } from "@aws-sdk/client-pricing";
import { EC2Client, DescribeInstanceTypesCommand } from "@aws-sdk/client-ec2";
import { fromIni } from "@aws-sdk/credential-providers";
import { getPreferenceValues, LocalStorage } from "@raycast/api";

interface Preferences {
  awsProfile: string;
}

function getCredentials() {
  const { awsProfile } = getPreferenceValues<Preferences>();
  return fromIni({ profile: awsProfile });
}

export function createPricingClient() {
  return new PricingClient({
    region: "us-east-1", // Pricing API is only available in us-east-1
    credentials: getCredentials(),
  });
}

export function createEC2Client(region: string) {
  return new EC2Client({
    region,
    credentials: getCredentials(),
  });
}

// Helper function to chunk array into smaller arrays
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

// New function to fetch baseline bandwidths
const BASELINE_BANDWIDTH_CACHE_KEY = "baseline_bandwidth_data";

export async function fetchBaselineBandwidth(
  nodeTypes: string[],
  region: string
): Promise<Record<string, string>> {
  const cachedData = await getCachedData<Record<string, string>>(BASELINE_BANDWIDTH_CACHE_KEY);
  if (cachedData) {
    return cachedData;
  }

  const ec2Client = createEC2Client(region);
  const ec2InstanceTypes = nodeTypes.map((type) => type.replace("cache.", "").replace("db.", ""));

  const validInstanceTypes: string[] = [];
  const invalidInstanceTypes: string[] = [];

  // Validate instance types
  for (const instanceType of ec2InstanceTypes) {
    try {
      const command = new DescribeInstanceTypesCommand({
        InstanceTypes: [instanceType],
      });
      await ec2Client.send(command);
      validInstanceTypes.push(instanceType);
    } catch (error) {
      invalidInstanceTypes.push(instanceType);
    }
  }

  const chunks = chunkArray(validInstanceTypes, 100); // Chunk into batches of 100

  const baselineBandwidths: Record<string, string> = {};

  // Fetch all chunks in parallel
  const promises = chunks.map(async (chunk) => {
    const command = new DescribeInstanceTypesCommand({
      InstanceTypes: chunk,
    });

    try {
      const response = await ec2Client.send(command);
      if (response.InstanceTypes) {
        for (const instanceTypeInfo of response.InstanceTypes) {
          const instanceType = instanceTypeInfo.InstanceType;
          const baselineBandwidth =
            instanceTypeInfo.NetworkInfo?.NetworkCards?.[0]?.BaselineBandwidthInGbps;
          if (baselineBandwidth) {
            baselineBandwidths[instanceType] = `${baselineBandwidth} Gbps`;
          }
        }
      }
    } catch (error) {
      console.error("Error fetching baseline bandwidth:", error);
    }
  });

  // Wait for all promises to resolve
  await Promise.all(promises);

  // Cache the fetched data
  await setCachedData(BASELINE_BANDWIDTH_CACHE_KEY, baselineBandwidths);

  return baselineBandwidths;
}

// Caching functions
async function getCachedData<T>(key: string): Promise<T | null> {
  try {
    const cachedDataString = await LocalStorage.getItem<string>(key);
    if (cachedDataString) {
      const cachedData = JSON.parse(cachedDataString);
      return cachedData as T;
    }
  } catch (error) {
    console.error("Error getting cached data:", error);
  }
  return null;
}

async function setCachedData<T>(key: string, data: T): Promise<void> {
  try {
    await LocalStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.error("Error setting cached data:", error);
  }
}
