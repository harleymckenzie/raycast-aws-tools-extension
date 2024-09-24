// awsClient.ts

import { PricingClient, GetProductsCommand } from "@aws-sdk/client-pricing";
import { EC2Client, DescribeInstanceTypesCommand } from "@aws-sdk/client-ec2";
import { fromIni } from "@aws-sdk/credential-providers";
import { getPreferenceValues } from "@raycast/api";
import { getCachedData, setCachedData } from "./utils";
import { paginateGetProducts } from "@aws-sdk/client-pricing";

interface Preferences {
  awsProfile: string;
}

enum ServiceCode {
  EC2 = "AmazonEC2",
  ElastiCache = "AmazonElastiCache",
  RDS = "AmazonRDS",
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

export async function fetchInstanceData(
  region: string,
  setProgress: (progress: { current: number; total: number }) => void,
  signal: AbortSignal
): Promise<Record<string, InstanceDetails>> {
  console.log(`Starting to fetch EC2 instance data for region: ${region}`);
  const client = createPricingClient();
  const instanceData: Record<string, InstanceDetails> = {};
  let nextToken: string | undefined;
  let pageCount = 0;

  do {
    if (signal.aborted) {
      console.log('Fetch aborted');
      throw new Error('Fetch aborted');
    }

    console.log(`Fetching page ${pageCount + 1}`);
    const command = new GetProductsCommand({
      ServiceCode: ServiceCode.EC2,
      Filters: [
        { Type: "TERM_MATCH", Field: "operatingSystem", Value: "Linux" },
        { Type: "TERM_MATCH", Field: "regionCode", Value: region },
        { Type: "TERM_MATCH", Field: "preInstalledSw", Value: "NA" },
        { Type: "TERM_MATCH", Field: "capacitystatus", Value: "Used" },
        { Type: "TERM_MATCH", Field: "tenancy", Value: "Shared" },
      ],
      MaxResults: 100,
      NextToken: nextToken,
    });

    const response = await client.send(command);
    pageCount++;

    console.log(`Received page ${pageCount} with ${response.PriceList?.length || 0} items`);

    if (response.PriceList) {
      for (const priceItem of response.PriceList) {
        const priceJSON = JSON.parse(priceItem);
        const product = priceJSON.product;
        const attributes = product.attributes;
        const instanceType = attributes.instanceType;

        if (!instanceType) continue;

        const onDemandTerms = priceJSON.terms?.OnDemand;
        if (onDemandTerms) {
          const term = Object.values(onDemandTerms)[0];
          const priceDimensions = term.priceDimensions;
          const priceDimension = Object.values(priceDimensions)[0];
          const pricePerUnit = parseFloat(priceDimension.pricePerUnit.USD);

          instanceData[instanceType] = {
            pricePerHour: pricePerUnit,
            vcpu: attributes.vcpu,
            processorType: attributes.physicalProcessor || "Unknown",
            memory: attributes.memory,
            storage: attributes.storage,
            networkPerformance: attributes.networkPerformance,
            baselineBandwidth: "Fetching...",
          };
        }
      }
    }

    nextToken = response.NextToken;
    setProgress({ current: pageCount, total: pageCount });
    console.log(`Progress: ${pageCount} page(s) processed`);
  } while (nextToken);

  console.log(`Finished fetching EC2 instance data. Total pages: ${pageCount}`);
  console.log(`Retrieved data for ${Object.keys(instanceData).length} instance types`);

  return instanceData;
}

export async function fetchNodeData(region: string): Promise<Record<string, NodeDetails>> {
  console.log(`Fetching ElastiCache node data for region: ${region}`);
  const client = createPricingClient();
  const nodeData: Record<string, NodeDetails> = {};

  const paginator = paginateGetProducts(
    { client },
    {
      ServiceCode: ServiceCode.ElastiCache,
      Filters: [
        { Type: "TERM_MATCH", Field: "regionCode", Value: region },
        { Type: "TERM_MATCH", Field: "cacheEngine", Value: "Redis" },
      ],
    }
  );

  for await (const page of paginator) {
    if (page.PriceList) {
      for (const priceItem of page.PriceList) {
        const priceJSON = JSON.parse(priceItem);
        const product = priceJSON.product;
        const attributes = product.attributes;
        const nodeType = attributes.instanceType;

        if (!nodeType) continue;

        const onDemandTerms = priceJSON.terms?.OnDemand;
        if (onDemandTerms) {
          const term = Object.values(onDemandTerms)[0] as any;
          const priceDimensions = term.priceDimensions;
          const priceDimension = Object.values(priceDimensions)[0] as any;
          const pricePerUnit = parseFloat(priceDimension.pricePerUnit.USD);

          nodeData[nodeType] = {
            pricePerHour: pricePerUnit,
            memory: attributes.memory,
            networkPerformance: attributes.networkPerformance,
            vcpu: attributes.vcpu,
            nodeType,
          };
        }
      }
    }
  }

  return nodeData;
}

export async function fetchDatabaseData(
  region: string,
  engine: string,
  deploymentOption: string
): Promise<Record<string, DatabaseDetails>> {
  const client = createPricingClient();
  const databaseData: Record<string, DatabaseDetails> = {};

  const command = new GetProductsCommand({
    ServiceCode: ServiceCode.RDS,
    Filters: [
      { Type: "TERM_MATCH", Field: "regionCode", Value: region },
      { Type: "TERM_MATCH", Field: "databaseEngine", Value: engine },
      { Type: "TERM_MATCH", Field: "deploymentOption", Value: deploymentOption },
    ],
  });

  try {
    const response = await client.send(command);
    if (response.PriceList) {
      for (const priceItem of response.PriceList) {
        const priceJSON = JSON.parse(priceItem);
        const attributes = priceJSON.product.attributes;
        const instanceType = attributes.instanceType;

        if (!instanceType) continue;

        const onDemandTerms = priceJSON.terms?.OnDemand;
        if (onDemandTerms) {
          const term = Object.values(onDemandTerms)[0] as any;
          const priceDimensions = term.priceDimensions;
          const priceDimension = Object.values(priceDimensions)[0] as any;
          const pricePerUnit = parseFloat(priceDimension.pricePerUnit.USD);

          databaseData[instanceType] = {
            pricePerHour: pricePerUnit,
            engine: attributes.databaseEngine,
            databaseEdition: attributes.databaseEdition,
            deploymentOption: attributes.deploymentOption,
            instanceType: instanceType,
            vcpu: attributes.vcpu,
            memory: attributes.memory,
            storage: attributes.storage,
            processorType: attributes.physicalProcessor || "N/A",
            networkPerformance: attributes.networkPerformance,
          };
        }
      }
    }
  } catch (error) {
    console.error("Error fetching database data:", error);
    throw error;
  }

  return databaseData;
}
