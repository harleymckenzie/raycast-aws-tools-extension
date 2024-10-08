// search-elasticache-instance.tsx

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
import { useEffect, useState, useMemo } from "react";
import { fetchBaselineBandwidth, fetchInstanceData, ServiceCode } from "./shared/awsClient";
import { getCachedData, setCachedData } from "./shared/utils";

interface Preferences {
  defaultRegion: string;
}

interface NodeDetails {
  pricePerHour: number | null;
  memory: string;
  networkPerformance: string;
  vcpu: string;
  nodeType: string;
}

interface CommandArguments {
  nodeType?: string;
  region?: string;
}

const CACHE_KEY = "elasticache_node_data";

export default function Command(props: LaunchProps<{ arguments: CommandArguments }>) {
  const { defaultRegion } = getPreferenceValues<Preferences>();
  const [nodeData, setNodeData] = useState<Record<string, NodeDetails>>({});
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState(props.arguments.nodeType || "");
  const [loadingStatus, setLoadingStatus] = useState("Initializing...");

  const region = props.arguments.region || defaultRegion;

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setLoadingStatus("Checking cache...");
      try {
        const cacheKeyWithRegion = `${CACHE_KEY}_${region}`;
        const cachedData = await getCachedData<Record<string, NodeDetails>>(cacheKeyWithRegion, 1);
        if (cachedData) {
          console.log("Using cached ElastiCache node data");
          setLoadingStatus("Loading cached data...");
          setNodeData(cachedData);
        } else {
          console.log("Fetching fresh ElastiCache node data");
          setLoadingStatus("Fetching node data from AWS...");
          const filters = [
            { Type: "TERM_MATCH", Field: "regionCode", Value: region },
            { Type: "TERM_MATCH", Field: "cacheEngine", Value: "Redis" },
          ];
          const data = await fetchInstanceData(region, ServiceCode.ElastiCache, filters);
          setNodeData(data);
          setLoadingStatus("Populating cache...");
          await setCachedData(cacheKeyWithRegion, 1, data);
        }
      } catch (error) {
        console.error("Error in fetchData:", error);
        const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
        setError(errorMessage);
        await showToast({
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

  const filteredNodes = useMemo(() => {
    return Object.entries(nodeData)
      .filter(([type]) => type.toLowerCase().includes(searchText.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [nodeData, searchText]);

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search ElastiCache Redis node types..."
      searchText={searchText}
    >
      {isLoading ? (
        <List.EmptyView
          icon={Icon.Cloud}
          title="Loading ElastiCache node data"
          description={loadingStatus}
        />
      ) : error ? (
        <List.Item title="Error" subtitle={error} icon={Icon.ExclamationMark} />
      ) : filteredNodes.length === 0 ? (
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title="No matching nodes found"
          description="Try adjusting your search term"
        />
      ) : (
        filteredNodes.map(([nodeType, info]) => (
          <List.Item
            key={nodeType}
            title={nodeType}
            subtitle={`${info.vcpu} vCPU | ${info.memory} Memory`}
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
                    <NodeDetailsComponent
                      nodeType={nodeType}
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

function NodeDetailsComponent({
  nodeType,
  details,
  region,
}: {
  nodeType: string;
  details: NodeDetails;
  region: string;
}) {
  const [baselineBandwidth, setBaselineBandwidth] = useState<string | null>(null);
  const [isFetchingBandwidth, setIsFetchingBandwidth] = useState(true);

  useEffect(() => {
    const fetchBandwidth = async () => {
      setIsFetchingBandwidth(true);
      try {
        const bandwidth = await fetchBaselineBandwidth(nodeType, region);
        setBaselineBandwidth(bandwidth);
      } catch (error) {
        console.error(`Error fetching bandwidth for ${nodeType}:`, error);
      } finally {
        setIsFetchingBandwidth(false);
      }
    };

    fetchBandwidth();
  }, [nodeType, region]);

  const { pricePerHour, memory, networkPerformance, vcpu } = details;
  const hourlyCost = pricePerHour ?? 0;
  const dailyCost = hourlyCost * 24;
  const monthlyCost = hourlyCost * 730; // More accurate monthly estimation

  const networkThroughput = isFetchingBandwidth
    ? "Fetching baseline bandwidth..."
    : baselineBandwidth
    ? `${networkPerformance} | Baseline: ${baselineBandwidth}`
    : networkPerformance;

  return (
    <List navigationTitle={`Details for ${nodeType}`}>
      <List.Section title="Node Details">
        <List.Item icon={Icon.Monitor} title="Node Type" accessories={[{ text: nodeType }]} />
        <List.Item icon={Icon.MemoryChip} title="vCPU" accessories={[{ text: `${vcpu} vCPU` }]} />
        <List.Item icon={Icon.MemoryStick} title="Memory" accessories={[{ text: memory }]} />
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
