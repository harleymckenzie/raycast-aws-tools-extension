// awsClient.ts

import { PricingClient } from "@aws-sdk/client-pricing";
import { EC2Client, DescribeInstanceTypesCommand, _InstanceType as EC2InstanceType } from "@aws-sdk/client-ec2";
import { fromIni } from "@aws-sdk/credential-provider-ini";
import { getPreferenceValues } from "@raycast/api";
import { paginateGetProducts } from "@aws-sdk/client-pricing";
import { parseKnownFiles } from "@aws-sdk/shared-ini-file-loader";

interface Preferences {
  awsProfile: string;
  defaultRegion: string;
  defaultTerminal: string;
}

export enum ServiceCode {
  EC2 = "AmazonEC2",
  RDS = "AmazonRDS",
  ELASTICACHE = "AmazonElastiCache", // Note the capital 'C' in 'Cache'
}

export async function getProfiles(): Promise<{ id: string; name: string }[]> {
  try {
    const profiles = await parseKnownFiles({});
    return Object.keys(profiles).map((profile) => ({
      id: profile,
      name: profile,
    }));
  } catch (error) {
    console.error("Error fetching AWS profiles:", error);
    return [];
  }
}

export function createPricingClient(profile: string) {
  return new PricingClient({
    region: "us-east-1", // Pricing API is only available in us-east-1
    credentials: fromIni({ profile }),
  });
}

export function createEC2Client(profile: string, region: string): EC2Client {
  return new EC2Client({
    region,
    credentials: fromIni({ profile }),
    maxAttempts: 3,
  });
}

export async function fetchBaselineBandwidth(
  instanceType: string,
  region: string,
  profile?: string,
): Promise<string | null> {
  console.log(`Fetching baseline bandwidth for ${instanceType} in ${region}`);
  const { awsProfile, defaultRegion } = getPreferenceValues<Preferences>();
  const profileToUse = profile || awsProfile;
  const regionToUse = region || defaultRegion;
  const ec2Client = createEC2Client(profileToUse, regionToUse);

  // Remove any prefixes like 'db.' or 'cache.'
  const cleanInstanceType = instanceType.replace(/^(db\.|cache\.)/, "");

  const command = new DescribeInstanceTypesCommand({
    InstanceTypes: [cleanInstanceType as EC2InstanceType],
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

interface PriceDimension {
  pricePerUnit: {
    USD: string;
  };
}

interface OnDemandTerm {
  priceDimensions: Record<string, PriceDimension>;
}

interface ProductAttributes {
  instanceType: string;
  usagetype: string;
  [key: string]: string | number;
}

interface PriceProduct {
  attributes: ProductAttributes;
}

interface PriceData {
  product: PriceProduct;
  terms: {
    OnDemand: Record<string, OnDemandTerm>;
  };
}

export async function fetchInstanceData(
  region: string,
  serviceCode: ServiceCode,
  filters: { Type: string; Field: string; Value: string }[],
  setProgress?: (progress: { current: number; total: number | null; message: string }) => void,
  signal?: AbortSignal,
  profile?: string | undefined,
): Promise<Record<string, ProductAttributes & { pricePerHour: number }>> {
  console.log(`Starting to fetch ${serviceCode} instance data for region: ${region}`);
  const { awsProfile } = getPreferenceValues<Preferences>();
  const profileToUse = profile || awsProfile;
  const client = createPricingClient(profileToUse);
  const instanceData: Record<string, ProductAttributes & { pricePerHour: number }> = {};
  let pageCount = 0;
  let instanceCount = 0;

  const paginator = paginateGetProducts(
    { client },
    {
      ServiceCode: serviceCode,
      Filters: Array.isArray(filters)
        ? filters.map((filter) => ({
            Type: "TERM_MATCH" as const,
            Field: filter.Field,
            Value: filter.Value,
          }))
        : [],
    },
  );

  for await (const page of paginator) {
    if (signal?.aborted) {
      console.log("Fetch aborted");
      throw new Error("Fetch aborted");
    }

    pageCount++;
    console.log(`Received page ${pageCount} with ${page.PriceList?.length || 0} items`);

    if (page.PriceList) {
      for (const priceItem of page.PriceList) {
        const priceJSON = JSON.parse(priceItem.toString()) as PriceData;
        const product = priceJSON.product;
        const attributes = product.attributes;
        const instanceType = attributes.instanceType;
        const usageType = attributes.usagetype;

        if (!instanceType) continue;

        const onDemandTerms = priceJSON.terms?.OnDemand;
        if (onDemandTerms) {
          const term = Object.values(onDemandTerms)[0];
          const priceDimensions = term.priceDimensions;
          const priceDimension = Object.values(priceDimensions)[0];
          const pricePerUnit = parseFloat(priceDimension.pricePerUnit.USD);

          const key = `${instanceType}|${usageType}`;
          instanceData[key] = {
            pricePerHour: pricePerUnit,
            ...attributes,
          };
          instanceCount++;
        }
      }
    }

    setProgress?.({
      current: pageCount,
      total: null,
      message: `Processed ${pageCount} pages, retrieved ${instanceCount} instance types`,
    });
    console.log(`Progress: ${pageCount} page(s) processed, ${instanceCount} instance types retrieved`);
  }

  console.log(`Finished fetching ${serviceCode} instance data. Total pages: ${pageCount}`);
  console.log(`Retrieved data for ${Object.keys(instanceData).length} instance types`);

  return instanceData;
}
