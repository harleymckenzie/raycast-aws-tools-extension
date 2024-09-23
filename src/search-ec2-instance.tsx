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
import { useState, useEffect, useRef } from "react";
import { createPricingClient, fetchBaselineBandwidth } from "./shared/awsClient";
import { GetProductsCommand } from "@aws-sdk/client-pricing";

interface Preferences {
  defaultRegion: string;
}

interface InstanceDetails {
  pricePerHour: number | null;
  memory: string;
  vcpu: string;
  processorType: string;
  storage: string;
  networkPerformance: string;
  baselineBandwidth?: string;
}

interface CommandArguments {
  instanceType?: string;
  region?: string;
}

const CACHE_KEY = "ec2_instance_data";

export default function Command(props: LaunchProps<{ arguments: CommandArguments }>) {
  const { defaultRegion } = getPreferenceValues<Preferences>();
  const [instanceData, setInstanceData] = useState<Record<string, InstanceDetails>>({});
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState(props.arguments.instanceType || "");
  const [loadingStatus, setLoadingStatus] = useState("Initializing...");
  const [fetchProgress, setFetchProgress] = useState({ current: 0, total: 0 });
  const abortControllerRef = useRef<AbortController | null>(null);

  const region = props.arguments.region || defaultRegion;

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setLoadingStatus("Checking cache...");
      abortControllerRef.current = new AbortController();

      try {
        const cacheKeyWithRegion = `${CACHE_KEY}_${region}`;
        console.log(`Checking cache for region: ${region}`);
        const cachedData = await getCachedData<Record<string, InstanceDetails>>(cacheKeyWithRegion);
        if (cachedData) {
          console.log("Cache hit. Loading cached data...");
          setLoadingStatus("Loading cached data...");
          setInstanceData(cachedData);
        } else {
          console.log("Cache miss. Fetching instance data from AWS...");
          setLoadingStatus("Fetching instance data from AWS...");
          const data = await fetchInstanceData(region, setFetchProgress, abortControllerRef.current.signal);
          console.log(`Fetched ${Object.keys(data).length} instance types`);
          setInstanceData(data);
          setLoadingStatus("Populating cache...");
          await setCachedData(cacheKeyWithRegion, data);
          console.log("Cache populated");
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          console.log('Fetch aborted');
          return;
        }
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
        abortControllerRef.current = null;
      }
    };

    fetchData();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
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
      {isLoading ? (
        <List.EmptyView
          icon={Icon.Cloud}
          title="Loading EC2 instance data"
          description={loadingStatus}
        />
      ) : error ? (
        <List.Item title="Error" subtitle={error} icon={Icon.ExclamationMark} />
      ) : (
        filteredInstances.map(([instanceType, info]) => (
          <List.Item
            key={instanceType}
            title={instanceType}
            subtitle={`${info.vcpu} vCPU | ${info.memory} RAM`}
            icon={Icon.ComputerChip}
            accessories={[
              { text: info.pricePerHour !== null ? `$${info.pricePerHour.toFixed(4)}/hr` : "Price N/A" }
            ]}
            actions={
              <ActionPanel>
                <Action.Push
                  title="View Details"
                  target={
                    <InstanceDetailsComponent
                      instanceType={instanceType}
                      details={info}
                      region={region}
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

function InstanceDetailsComponent({
  instanceType,
  details,
  region,
}: {
  instanceType: string;
  details: InstanceDetails;
  region: string;
}) {
  const [baselineBandwidth, setBaselineBandwidth] = useState<string | null>(null);
  const [isFetchingBandwidth, setIsFetchingBandwidth] = useState(true);

  useEffect(() => {
    const fetchNetworkPerformance = async () => {
      setIsFetchingBandwidth(true);
      try {
        console.log(`Fetching network performance for ${instanceType} in ${region}`);
        const performance = await fetchBaselineBandwidth(instanceType, region);
        console.log(`Received network performance: ${performance}`);
        setBaselineBandwidth(performance);
      } catch (error) {
        console.error(`Error fetching network performance for ${instanceType}:`, error);
      } finally {
        setIsFetchingBandwidth(false);
      }
    };

    fetchNetworkPerformance();
  }, [instanceType, region]);

  const { pricePerHour, memory, vcpu, processorType, storage, networkPerformance } = details;
  const hourlyCost = pricePerHour ?? 0;
  const dailyCost = hourlyCost * 24;
  const monthlyCost = dailyCost * 30;

  const networkInfo = isFetchingBandwidth
    ? "Fetching baseline bandwidth..."
    : baselineBandwidth
    ? `${networkPerformance} | Baseline: ${baselineBandwidth}`
    : networkPerformance;

  console.log('Rendering network info:', networkInfo);

  return (
    <List navigationTitle={`Details for ${instanceType}`}>
      <List.Section title="Instance Details">
        <List.Item icon={Icon.Monitor} title="Instance Type" accessories={[{ text: instanceType }]} />
        <List.Item icon={Icon.MemoryChip} title="vCPU" accessories={[{ text: `${vcpu} vCPU` }]} />
        <List.Item icon={Icon.MemoryChip} title="Processor Type" accessories={[{ text: processorType }]} />
        <List.Item icon={Icon.MemoryStick} title="Memory" accessories={[{ text: memory }]} />
        <List.Item icon={Icon.HardDrive} title="Storage" accessories={[{ text: storage }]} />
        <List.Item 
          icon={Icon.Network} 
          title="Network Performance" 
          accessories={[{ text: networkInfo }]} 
        />
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

async function fetchInstanceData(
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
      ServiceCode: "AmazonEC2",
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