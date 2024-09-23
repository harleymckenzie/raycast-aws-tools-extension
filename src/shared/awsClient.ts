// awsClient.ts

import { EC2Client, DescribeInstanceTypesCommand } from "@aws-sdk/client-ec2";
import { PricingClient } from "@aws-sdk/client-pricing";
import { fromIni } from "@aws-sdk/credential-providers";
import { getPreferenceValues } from "@raycast/api";

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

// New function to fetch baseline bandwidth
const BASELINE_BANDWIDTH_CACHE_KEY = "baseline_bandwidth_data";

export async function fetchBaselineBandwidth(instanceType: string, region: string): Promise<string | null> {
  console.log(`Fetching baseline bandwidth for ${instanceType} in ${region}`);
  const ec2Client = createEC2Client(region);

  const command = new DescribeInstanceTypesCommand({
    InstanceTypes: [instanceType],
  });

  try {
    const response = await ec2Client.send(command);
    
    if (response.InstanceTypes && response.InstanceTypes.length > 0) {
      const instanceTypeInfo = response.InstanceTypes[0];
      if (instanceTypeInfo.NetworkInfo?.NetworkCards && instanceTypeInfo.NetworkInfo.NetworkCards.length > 0) {
        const baselineBandwidth = instanceTypeInfo.NetworkInfo.NetworkCards[0].BaselineBandwidthInGbps;
        if (baselineBandwidth) {
          console.log(`Baseline bandwidth for ${instanceType}: ${baselineBandwidth} Gbps`);
          return `${baselineBandwidth} Gbps`;
        }
      }
    }
    
    console.log(`No baseline bandwidth found for ${instanceType}`);
  } catch (error) {
    console.error(`Error fetching baseline bandwidth for ${instanceType}:`, error);
  }

  return null;
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
