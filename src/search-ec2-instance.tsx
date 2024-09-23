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
import { createPricingClient } from "./shared/awsClient";
import { GetProductsCommand } from "@aws-sdk/client-pricing";

interface Preferences {
  defaultRegion: string;
}

interface InstanceDetails {
  pricePerHour: number | null;
  memory: string;
  vcpu: string;
  processorType: string; // Updated to processorType
  storage: string;
  networkPerformance: string;
}

interface CommandArguments {
  instanceType?: string;
  region?: string;
}

const CACHE_KEY = "ec2_instance_data";
const CACHE_VERSION = 1; // Update when making breaking changes

export default function Command(props: LaunchProps<{ arguments: CommandArguments }>) {
  const { defaultRegion } = getPreferenceValues<Preferences>();
  const [instanceData, setInstanceData] = useState<Record<string, InstanceDetails>>({});
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState(props.arguments.instanceType || "");

  const region = props.arguments.region || defaultRegion;

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const cacheKeyWithRegion = `${CACHE_KEY}_${region}`;
        const cachedData = await getCachedData<Record<string, InstanceDetails>>(cacheKeyWithRegion, CACHE_VERSION);
        if (cachedData) {
          setInstanceData(cachedData);
        } else {
          const data = await fetchInstanceData(region);
          setInstanceData(data);
          await setCachedData(cacheKeyWithRegion, CACHE_VERSION, data);
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
  }, [region]);

  const filteredInstances = Object.entries(instanceData)
    .filter(([type]) => type.toLowerCase().includes(searchText.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search EC2 instance types..."
      searchText={searchText}
    >
      {error ? (
        <List.Item title="Error" subtitle={error} icon={Icon.ExclamationMark} />
      ) : (
        filteredInstances.map(([instanceType, info]) => (
          <List.Item
            key={instanceType}
            title={instanceType}
            subtitle={`${info.vcpu} vCPU | ${info.memory} RAM`}
            icon={Icon.ComputerChip}
            accessories={
              info.pricePerHour !== null
                ? [{ text: `$${info.pricePerHour.toFixed(4)}/hr` }]
                : [{ text: "Price N/A" }]
            }
            actions={
              <ActionPanel>
                <Action.Push
                  title="View Details"
                  target={<InstanceDetailsComponent instanceType={instanceType} details={info} />}
                />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}

function InstanceDetailsComponent({ instanceType, details }: { instanceType: string; details: InstanceDetails }) {
  const { pricePerHour, memory, vcpu, storage, networkPerformance, processorType } = details;
  const hourlyCost = pricePerHour ?? 0;
  const dailyCost = hourlyCost * 24;
  const monthlyCost = dailyCost * 30;

  return (
    <List navigationTitle={`Details for ${instanceType}`}>
      <List.Section title="Instance Details">
        <List.Item icon={Icon.Monitor} title="Instance Type" accessories={[{ text: instanceType }]} />
        <List.Item icon={Icon.MemoryChip} title="vCPU" accessories={[{ text: `${vcpu} vCPU` }]} />
        <List.Item icon={Icon.MemoryChip} title="Processor Type" accessories={[{ text: processorType }]} />
        <List.Item icon={Icon.MemoryStick} title="Memory" accessories={[{ text: memory }]} />
        <List.Item icon={Icon.HardDrive} title="Storage" accessories={[{ text: storage }]} />
        <List.Item icon={Icon.Network} title="Network Performance" accessories={[{ text: networkPerformance }]} />
      </List.Section>
      <List.Section title="Pricing">
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

// Fetch Instance Data function
async function fetchInstanceData(region: string): Promise<Record<string, InstanceDetails>> {
  const client = createPricingClient();

  try {
    const command = new GetProductsCommand({
      ServiceCode: "AmazonEC2",
      Filters: [
        { Type: "TERM_MATCH", Field: "operatingSystem", Value: "Linux" },
        { Type: "TERM_MATCH", Field: "regionCode", Value: region },
        { Type: "TERM_MATCH", Field: "preInstalledSw", Value: "NA" },
        { Type: "TERM_MATCH", Field: "capacitystatus", Value: "Used" },
        { Type: "TERM_MATCH", Field: "tenancy", Value: "Shared" },
      ],
      MaxResults: 100,
    });

    const instanceData: Record<string, InstanceDetails> = {};
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

            instanceData[instanceType] = {
              pricePerHour: pricePerUnit,
              memory: attributes.memory,
              vcpu: attributes.vcpu,
              processorType,
              storage: attributes.storage,
              networkPerformance: attributes.networkPerformance,
            };
          }
        }
      }

      nextToken = response.NextToken;
      hasNext = !!nextToken;
      command.input.NextToken = nextToken;
    }

    return instanceData;
  } catch (error) {
    console.error("Error fetching instance data:", error);
    throw error;
  }
}

// Caching functions
async function getCachedData<T>(key: string, version: number): Promise<T | null> {
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

async function setCachedData<T>(key: string, version: number, data: T): Promise<void> {
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