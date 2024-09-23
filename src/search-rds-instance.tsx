// rds.tsx

import {
  List,
  LaunchProps,
  getPreferenceValues,
  showToast,
  Toast,
  Icon,
  ActionPanel,
  Action,
  LocalStorage,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { createPricingClient, fetchBaselineBandwidth } from "./shared/awsClient";
import { GetProductsCommand } from "@aws-sdk/client-pricing";

interface Preferences {
  defaultRegion: string;
}

interface DatabaseDetails {
  pricePerHour: number | null;
  engine: string;
  databaseEdition: string;
  deploymentOption: string;
  instanceType: string;
  vcpu: string;
  memory: string;
  storage: string;
  processorType: string; // Added processorType
  networkPerformance: string;
  baselineBandwidth?: string; // Updated to optional
}

interface CommandArguments {
  instanceType?: string;
  databaseEngine?: string;
  region?: string;
}

const CACHE_KEY = "rds_instance_data";

export default function Command(props: LaunchProps<{ arguments: CommandArguments }>) {
  const { defaultRegion } = getPreferenceValues<Preferences>();
  const [databaseData, setDatabaseData] = useState<Record<string, DatabaseDetails>>({});
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState(props.arguments.instanceType || "");

  const region = props.arguments.region || defaultRegion;
  const databaseEngine = props.arguments.databaseEngine;
  const deploymentOption = "Single-AZ"; // Default deployment option

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const cacheKeyWithParams = `${CACHE_KEY}_${region}_${databaseEngine}_${deploymentOption}`;
        const cachedData = await getCachedData<Record<string, DatabaseDetails>>(cacheKeyWithParams);
        if (cachedData) {
          setDatabaseData(cachedData);
        } else {
          const data = await fetchDatabaseData(region, databaseEngine, deploymentOption);
          setDatabaseData(data);
          await setCachedData(cacheKeyWithParams, data);
        }
      } catch (error) {
        console.error("Error in fetchData:", error);
        const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
        setError(errorMessage);
        showToast({
          style: Toast.Style.Failure,
          title: "Error",
          message: errorMessage,
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [region, databaseEngine]);

  const filteredDatabases = Object.entries(databaseData)
    .filter(([key, info]) => info.instanceType.toLowerCase().includes(searchText.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search RDS instance types..."
      searchText={searchText}
    >
      {error ? (
        <List.Item title="Error" subtitle={error} icon={Icon.ExclamationMark} />
      ) : (
        filteredDatabases.map(([key, info]) => (
          <List.Item
            key={key}
            title={info.instanceType}
            subtitle={`${info.engine} | ${info.vcpu} vCPU | ${info.memory} RAM`}
            icon={Icon.MemoryChip}
            accessories={
              info.pricePerHour !== null
                ? [{ text: `$${info.pricePerHour.toFixed(4)}/hr` }]
                : [{ text: "Price N/A" }]
            }
            actions={
              <ActionPanel>
                <Action.Push
                  title="View Details"
                  target={
                    <DatabaseDetailsComponent
                      details={info}
                      region={region}  // Pass region as a prop
                    />
                  }
                />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}

function DatabaseDetailsComponent({
  details,
  region,
}: {
  details: DatabaseDetails;
  region: string;
}) {
  const { pricePerHour, engine, databaseEdition, deploymentOption, instanceType, vcpu, memory, storage, processorType, networkPerformance, baselineBandwidth } = details;
  const hourlyCost = pricePerHour ?? 0;
  const dailyCost = hourlyCost * 24;
  const monthlyCost = dailyCost * 30;

  const networkThroughput = baselineBandwidth
    ? `${networkPerformance} | Baseline: ${baselineBandwidth}`
    : networkPerformance;

  return (
    <List navigationTitle={`Details for ${instanceType}`}>
      <List.Section title="Instance Details">
        <List.Item icon={Icon.Monitor} title="Instance Type" accessories={[{ text: instanceType }]} />
        <List.Item icon={Icon.Terminal} title="Engine" accessories={[{ text: engine }]} />
        <List.Item icon={Icon.MemoryChip} title="vCPU" accessories={[{ text: `${vcpu} vCPU` }]} />
        <List.Item icon={Icon.MemoryChip} title="Processor Type" accessories={[{ text: processorType }]} />
        <List.Item icon={Icon.MemoryStick} title="Memory" accessories={[{ text: memory }]} />
        <List.Item icon={Icon.HardDrive} title="Storage" accessories={[{ text: storage }]} />
        <List.Item icon={Icon.Network} title="Network Performance" accessories={[{ text: networkThroughput }]} />
      </List.Section>
      <List.Section title={`Pricing (${region})`}>
        <List.Item
          icon={Icon.BankNote}
          title="Pricing"
          accessories={[
            { text: `$${hourlyCost.toFixed(4)}/hr` },
            { text: `$${dailyCost.toFixed(2)}/day` },
            { text: `$${monthlyCost.toFixed(2)}/mo` },
          ]}
        />
      </List.Section>
    </List>
  );
}

// Fetch Database Data function
async function fetchDatabaseData(
  region: string,
  databaseEngine: string,
  deploymentOption: string
): Promise<Record<string, DatabaseDetails>> {
  const client = createPricingClient();

  try {
    const filters = [
      { Type: "TERM_MATCH", Field: "productFamily", Value: "Database Instance" },
      { Type: "TERM_MATCH", Field: "databaseEngine", Value: databaseEngine },
      { Type: "TERM_MATCH", Field: "regionCode", Value: region },
      { Type: "TERM_MATCH", Field: "deploymentOption", Value: deploymentOption },
    ];

    const command = new GetProductsCommand({
      ServiceCode: "AmazonRDS",
      Filters: filters,
      MaxResults: 100,
    });

    const databaseData: Record<string, DatabaseDetails> = {};
    let hasNext = true;
    let nextToken: string | undefined;

    while (hasNext) {
      const response = await client.send(command);
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

            // Use physicalProcessor attribute to get the processor type
            const processorType = attributes.physicalProcessor || "Unknown";

            databaseData[instanceType] = {
              pricePerHour: pricePerUnit,
              engine: attributes.databaseEngine,
              databaseEdition: attributes.databaseEdition || "N/A",
              deploymentOption,
              instanceType,
              vcpu: attributes.vcpu,
              memory: attributes.memory,
              storage: attributes.storage || "N/A",
              processorType, // Include processorType in the data
              networkPerformance: attributes.networkPerformance,
              baselineBandwidth: "Fetching...", // Placeholder
            };
          }
        }
      }

      nextToken = response.NextToken;
      hasNext = !!nextToken;
      command.input.NextToken = nextToken;
    }

    // Extract instance types from databaseData
    const instanceTypes = Object.keys(databaseData);

    // Fetch baseline bandwidths in parallel
    const baselineBandwidths = await fetchBaselineBandwidth(instanceTypes, region);
    for (const instanceType of instanceTypes) {
      // Adjust instanceType by stripping the 'db.' prefix if present
      const ec2InstanceType = instanceType.startsWith("db.")
        ? instanceType.replace("db.", "")
        : instanceType;

      if (baselineBandwidths[ec2InstanceType]) {
        databaseData[instanceType].baselineBandwidth = baselineBandwidths[ec2InstanceType];
      } else {
        delete databaseData[instanceType].baselineBandwidth;
      }
    }

    return databaseData;
  } catch (error) {
    console.error("Error fetching database data:", error);
    throw error;
  }
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