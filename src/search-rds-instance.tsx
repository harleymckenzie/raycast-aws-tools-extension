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
import { useEffect, useState, useMemo } from "react";
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
  processorType: string;
  networkPerformance: string;
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
  const [loadingStatus, setLoadingStatus] = useState("Initializing...");

  const region = props.arguments.region || defaultRegion;
  const databaseEngine = props.arguments.databaseEngine || "MySQL";
  const deploymentOption = "Single-AZ";

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setLoadingStatus("Checking cache...");
      try {
        const cacheKeyWithParams = `${CACHE_KEY}_${region}_${databaseEngine}_${deploymentOption}`;
        const cachedData = await getCachedData<Record<string, DatabaseDetails>>(cacheKeyWithParams);
        if (cachedData) {
          setLoadingStatus("Loading cached data...");
          setDatabaseData(cachedData);
        } else {
          setLoadingStatus("Fetching instance data from AWS...");
          const data = await fetchDatabaseData(region, databaseEngine, deploymentOption);
          setDatabaseData(data);
          setLoadingStatus("Populating cache...");
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

  const filteredDatabases = useMemo(() => {
    return Object.entries(databaseData)
      .filter(([key, info]) => info.instanceType.toLowerCase().includes(searchText.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [databaseData, searchText]);

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search RDS instance types..."
      searchText={searchText}
    >
      {isLoading ? (
        <List.EmptyView
          icon={Icon.Cloud}
          title="Loading RDS instance data"
          description={loadingStatus}
        />
      ) : error ? (
        <List.Item title="Error" subtitle={error} icon={Icon.ExclamationMark} />
      ) : (
        filteredDatabases.map(([key, info]) => (
          <List.Item
            key={key}
            title={info.instanceType}
            subtitle={`${info.vcpu} vCPU | ${info.memory} RAM`}
            icon={Icon.MemoryChip}
            accessories={
              info.pricePerHour !== null
                ? [{ text: `${info.engine} | $${info.pricePerHour.toFixed(4)}/hr` }]
                : [{ text: "Price N/A" }]
            }
            actions={
              <ActionPanel>
                <Action.Push
                  title="View Details"
                  target={<DatabaseDetailsComponent details={info} region={region} />}
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
  const [baselineBandwidth, setBaselineBandwidth] = useState<string | null>(null);
  const [isFetchingBandwidth, setIsFetchingBandwidth] = useState(true);

  useEffect(() => {
    const fetchBandwidth = async () => {
      setIsFetchingBandwidth(true);
      try {
        const bandwidth = await fetchBaselineBandwidth(details.instanceType.replace(/^db\./, ""), region);
        setBaselineBandwidth(bandwidth);
      } catch (error) {
        console.error(`Error fetching bandwidth for ${details.instanceType}:`, error);
      } finally {
        setIsFetchingBandwidth(false);
      }
    };

    fetchBandwidth();
  }, [details.instanceType, region]);

  const {
    pricePerHour,
    engine,
    databaseEdition,
    deploymentOption,
    instanceType,
    vcpu,
    memory,
    storage,
    processorType,
    networkPerformance,
  } = details;
  const hourlyCost = pricePerHour ?? 0;
  const dailyCost = hourlyCost * 24;
  const monthlyCost = dailyCost * 30;

  const networkThroughput = isFetchingBandwidth
    ? "Fetching baseline bandwidth..."
    : baselineBandwidth
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
        <List.Item
          icon={Icon.Network}
          title="Network Performance"
          accessories={[{ text: networkThroughput }]}
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

async function fetchDatabaseData(region: string, engine: string, deploymentOption: string): Promise<Record<string, DatabaseDetails>> {
  const client = createPricingClient();
  const databaseData: Record<string, DatabaseDetails> = {};

  const command = new GetProductsCommand({
    ServiceCode: "AmazonRDS",
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

async function getCachedData<T>(key: string): Promise<T | null> {
  try {
    const cachedDataString = await LocalStorage.getItem<string>(key);
    if (cachedDataString) {
      return JSON.parse(cachedDataString) as T;
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
