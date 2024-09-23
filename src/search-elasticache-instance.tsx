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
  LocalStorage,
} from "@raycast/api";
import { useEffect, useState, useMemo } from "react";
import { createPricingClient, fetchBaselineBandwidth } from "./shared/awsClient";
import { paginateGetProducts } from "@aws-sdk/client-pricing";

interface Preferences {
  defaultRegion: string;
}

interface NodeDetails {
  pricePerHour: number | null;
  memory: string;
  networkPerformance: string;
  vcpu: string;
  nodeType: string;
  baselineBandwidth?: string; // Updated to optional
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

  const region = props.arguments.region || defaultRegion;

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const cacheKeyWithRegion = `${CACHE_KEY}_${region}`;
        const cachedData = await getCachedData<Record<string, NodeDetails>>(cacheKeyWithRegion);
        if (cachedData) {
          setNodeData(cachedData);
        } else {
          const data = await fetchNodeData(region);
          setNodeData(data);
          await setCachedData(cacheKeyWithRegion, data);
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
      {error ? (
        <List.Item title="Error" subtitle={error} icon={Icon.ExclamationMark} />
      ) : (
        filteredNodes.map(([nodeType, info]) => (
          <List.Item
            key={nodeType}
            title={nodeType}
            subtitle={`${info.vcpu} vCPU | ${info.memory} Memory`}
            icon={Icon.MemoryChip}
            accessories={
              info.pricePerHour !== null ? [{ text: `$${info.pricePerHour.toFixed(4)}/hr` }] : [{ text: "Price N/A" }]
            }
            actions={
              <ActionPanel>
                <Action.Push
                  title="View Details"
                  target={
                    <NodeDetailsComponent
                      nodeType={nodeType}
                      details={info}
                      region={region} // Pass region as a prop
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
  const { pricePerHour, memory, networkPerformance, vcpu, baselineBandwidth } = details;
  const hourlyCost = pricePerHour ?? 0;
  const dailyCost = hourlyCost * 24;
  const monthlyCost = hourlyCost * 730; // More accurate monthly estimation

  const networkThroughput = baselineBandwidth
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

// Fetch Node Data function
async function fetchNodeData(region: string): Promise<Record<string, NodeDetails>> {
  const client = createPricingClient();

  const paginatorConfig = {
    client,
    pageSize: 100,
  };

  const input = {
    ServiceCode: "AmazonElastiCache",
    Filters: [
      { Type: "TERM_MATCH", Field: "cacheEngine", Value: "Redis" },
      { Type: "TERM_MATCH", Field: "regionCode", Value: region },
      { Type: "TERM_MATCH", Field: "productFamily", Value: "Cache Instance" },
    ],
  };

  const paginator = paginateGetProducts(paginatorConfig, input);

  const nodeData: Record<string, NodeDetails> = {};

  try {
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
            const term = Object.values(onDemandTerms)[0];
            const priceDimensions = term.priceDimensions;
            const priceDimension = Object.values(priceDimensions)[0];
            const pricePerUnit = parseFloat(priceDimension?.pricePerUnit?.USD ?? "0");

            nodeData[nodeType] = {
              pricePerHour: pricePerUnit,
              vcpu: attributes.vcpu,
              memory: attributes.memory,
              networkPerformance: attributes.networkPerformance,
              nodeType,
              baselineBandwidth: "Fetching...", // Placeholder
            };
          }
        }
      }
    }

    // Extract node types from nodeData
    const nodeTypes = Object.keys(nodeData);

    // Fetch baseline bandwidths in parallel
    const baselineBandwidths = await fetchBaselineBandwidth(nodeTypes, region);
    for (const nodeType of nodeTypes) {
      const ec2InstanceType = nodeType.replace("cache.", "");
      if (baselineBandwidths[ec2InstanceType]) {
        nodeData[nodeType].baselineBandwidth = baselineBandwidths[ec2InstanceType];
      } else {
        delete nodeData[nodeType].baselineBandwidth;
      }
    }

    return nodeData;
  } catch (error) {
    console.error("Error fetching node data:", error);
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
