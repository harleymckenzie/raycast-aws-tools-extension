// awsClient.ts

import { PricingClient, GetProductsCommand } from "@aws-sdk/client-pricing";
import { EC2Client, DescribeInstanceTypesCommand } from "@aws-sdk/client-ec2";
import { fromIni } from "@aws-sdk/credential-providers";
import { getPreferenceValues } from "@raycast/api";
import { paginateGetProducts } from "@aws-sdk/client-pricing";

interface Preferences {
  awsProfile: string;
}

export enum ServiceCode {
  EC2 = "AmazonEC2",
  RDS = "AmazonRDS",
  ElastiCache = "AmazonElastiCache"
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

export async function fetchBaselineBandwidth(
  instanceType: string,
  region: string
): Promise<string | null> {
  console.log(`Fetching baseline bandwidth for ${instanceType} in ${region}`);
  const ec2Client = createEC2Client(region);

  // Remove any prefixes like 'db.' or 'cache.'
  const cleanInstanceType = instanceType.replace(/^(db\.|cache\.)/, "");

  const command = new DescribeInstanceTypesCommand({
    InstanceTypes: [cleanInstanceType],
  });

  try {
    const response = await ec2Client.send(command);
    
    if (response.InstanceTypes && response.InstanceTypes.length > 0) {
      const instanceTypeInfo = response.InstanceTypes[0];
      if (instanceTypeInfo.NetworkInfo?.NetworkCards && 
          instanceTypeInfo.NetworkInfo.NetworkCards.length > 0) {
        const baselineBandwidth = 
          instanceTypeInfo.NetworkInfo.NetworkCards[0].BaselineBandwidthInGbps;
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

export async function fetchInstanceData(
  region: string,
  serviceCode: ServiceCode,
  filters: { Type: string; Field: string; Value: string }[],
  setProgress?: (progress: { current: number; total: number | null; message: string }) => void,
  signal?: AbortSignal
): Promise<Record<string, any>> {
  console.log(`Starting to fetch ${serviceCode} instance data for region: ${region}`);
  const client = createPricingClient();
  const instanceData: Record<string, any> = {};
  let pageCount = 0;
  let instanceCount = 0;

  const paginator = paginateGetProducts(
    { client },
    {
      ServiceCode: serviceCode,
      Filters: filters,
    }
  );

  for await (const page of paginator) {
    if (signal?.aborted) {
      console.log('Fetch aborted');
      throw new Error('Fetch aborted');
    }

    pageCount++;
    console.log(`Received page ${pageCount} with ${page.PriceList?.length || 0} items`);

    if (page.PriceList) {
      for (const priceItem of page.PriceList) {
        const priceJSON = JSON.parse(priceItem);
        const product = priceJSON.product;
        const attributes = product.attributes;
        const instanceType = attributes.instanceType;

        if (!instanceType) continue;

        const onDemandTerms = priceJSON.terms?.OnDemand;
        if (onDemandTerms) {
          const term = Object.values(onDemandTerms)[0] as any;
          const priceDimensions = term.priceDimensions;
          const priceDimension = Object.values(priceDimensions)[0] as any;
          const pricePerUnit = parseFloat(priceDimension.pricePerUnit.USD);

          instanceData[instanceType] = {
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
      message: `Processed ${pageCount} pages, retrieved ${instanceCount} instance types` 
    });
    console.log(`Progress: ${pageCount} page(s) processed, ${instanceCount} instance types retrieved`);
  }

  console.log(`Finished fetching ${serviceCode} instance data. Total pages: ${pageCount}`);
  console.log(`Retrieved data for ${Object.keys(instanceData).length} instance types`);

  return instanceData;
}
