// awsClient.ts

import { PricingClient } from "@aws-sdk/client-pricing";
import { EC2Client, DescribeInstanceTypesCommand } from "@aws-sdk/client-ec2";
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

// New function to fetch baseline bandwidths
export async function fetchBaselineBandwidth(
  nodeTypes: string[],
  region: string
): Promise<Record<string, string>> {
  const ec2Client = createEC2Client(region);
  const ec2InstanceTypes = nodeTypes.map((type) => type.replace("cache.", ""));

  const chunks = chunkArray(ec2InstanceTypes, 100); // Chunk into batches of 100

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
          baselineBandwidths[instanceType] = baselineBandwidth
            ? `${baselineBandwidth} Gbps`
            : "Unknown";
        }
      }
    } catch (error) {
      console.error("Error fetching baseline bandwidth:", error);
    }
  });

  // Wait for all promises to resolve
  await Promise.all(promises);

  return baselineBandwidths;
}
