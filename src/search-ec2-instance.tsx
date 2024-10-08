// search-ec2-instance.tsx

import {
  List,
  LaunchProps,
  getPreferenceValues,
  showToast,
  Toast,
  Icon,
  ActionPanel,
  Action,
} from "@raycast/api";
import { useState, useEffect, useRef } from "react";
import { fetchInstanceData, fetchBaselineBandwidth, ServiceCode } from "./shared/awsClient";
import { getCachedData, setCachedData } from "./shared/utils";

interface Preferences {
  defaultRegion: string;
}

interface InstanceDetails {
  pricePerHour: number | null;
  memory: string;
  vcpu: string;
  physicalProcessor: string;
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
        const cachedData = await getCachedData<Record<string, InstanceDetails>>(cacheKeyWithRegion, 1);
        if (cachedData) {
          console.log("Cache hit. Loading cached data...");
          setLoadingStatus("Loading cached data...");
          setInstanceData(cachedData);
        } else {
          console.log("Cache miss. Fetching instance data from AWS...");
          setLoadingStatus("Fetching instance data from AWS...");
          const filters = [
            { Type: "TERM_MATCH", Field: "regionCode", Value: region },
            { Type: "TERM_MATCH", Field: "operatingSystem", Value: "Linux" },
            { Type: "TERM_MATCH", Field: "tenancy", Value: "Shared" },
            { Type: "TERM_MATCH", Field: "capacitystatus", Value: "Used" },
            { Type: "TERM_MATCH", Field: "preInstalledSw", Value: "NA" },
          ];
          const data = await fetchInstanceData(
            region,
            ServiceCode.EC2,
            filters,
            (progress) => setFetchProgress({
              current: progress.current ?? 0,
              total: progress.total ?? 0
            }),
            abortControllerRef.current.signal
          );
          console.log(`Fetched ${Object.keys(data).length} instance types`);
          setInstanceData(data);
          setLoadingStatus("Populating cache...");
          await setCachedData(cacheKeyWithRegion, 1, data);
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
              { text: info.pricePerHour !== null ? `$${info.pricePerHour.toFixed(4)}/hr` : "Price N/A" },
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
    const fetchBandwidth = async () => {
      setIsFetchingBandwidth(true);
      try {
        const bandwidth = await fetchBaselineBandwidth(instanceType, region);
        setBaselineBandwidth(bandwidth);
      } catch (error) {
        console.error(`Error fetching bandwidth for ${instanceType}:`, error);
      } finally {
        setIsFetchingBandwidth(false);
      }
    };

    fetchBandwidth();
  }, [instanceType, region]);

  console.log('Details:', details);
  const { pricePerHour, memory, vcpu, physicalProcessor, storage, networkPerformance } = details;
  const hourlyCost = pricePerHour ?? 0;
  const dailyCost = hourlyCost * 24;
  const monthlyCost = dailyCost * 30;

  const networkThroughput = isFetchingBandwidth
    ? "Fetching baseline bandwidth..."
    : baselineBandwidth
    ? `${networkPerformance} | Baseline: ${baselineBandwidth}`
    : networkPerformance;

  console.log('Rendering network info:', networkThroughput);

  return (
    <List navigationTitle={`Details for ${instanceType}`}>
      <List.Section title="Instance Details">
        <List.Item icon={Icon.Monitor} title="Instance Type" accessories={[{ text: instanceType }]} />
        <List.Item icon={Icon.MemoryChip} title="vCPU" accessories={[{ text: `${vcpu} vCPU` }]} />
        <List.Item icon={Icon.MemoryChip} title="Processor Type" accessories={[{ text: physicalProcessor }]} />
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