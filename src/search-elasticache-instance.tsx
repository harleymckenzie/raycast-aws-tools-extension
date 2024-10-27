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
} from '@raycast/api';
import { useState, useMemo } from 'react';
import { ServiceCode } from './shared/awsClient';
import { useAWSInstanceData, useBaselineBandwidth } from './shared/hooks';
import { calculateCosts, getNetworkThroughput } from './shared/utils';

interface Preferences {
  defaultRegion: string;
}

interface NodeDetails {
  pricePerHour: number | null;
  memory: string;
  networkPerformance: string;
  vcpu: string;
  instanceType: string;
}

interface CommandArguments {
  instanceType?: string;
  region?: string;
}

const CACHE_KEY = 'elasticache_node_data';

export default function Command(props: LaunchProps<{ arguments: CommandArguments }>) {
  const { defaultRegion } = getPreferenceValues<Preferences>();
  const [searchText, setSearchText] = useState(props.arguments.instanceType || '');
  const region = props.arguments.region || defaultRegion;

  const filters = [
    { Type: 'TERM_MATCH', Field: 'regionCode', Value: region },
    { Type: 'TERM_MATCH', Field: 'cacheEngine', Value: 'Redis' },
  ];

  const { instanceData: nodeData, error, isLoading, loadingStatus } = useAWSInstanceData<NodeDetails>({
    region,
    serviceCode: ServiceCode.ElastiCache,
    cacheKey: CACHE_KEY,
    filters,
  });

  const filteredInstances = useMemo(() => {
    return Object.entries(nodeData)
      .filter(([_, info]) => info.instanceType.toLowerCase().includes(searchText.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [nodeData, searchText]);

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search ElastiCache instance types..."
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
      ) : filteredInstances.length === 0 ? (
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title="No matching nodes found"
          description="Try adjusting your search term"
        />
      ) : (
        filteredInstances.map(([key, info]) => (
          <List.Item
            key={key}
            title={info.instanceType}
            subtitle={`${info.vcpu} vCPU | ${info.memory} Memory`}
            icon={Icon.MemoryChip}
            accessories={
              info.pricePerHour !== null
                ? [{ text: `$${info.pricePerHour.toFixed(4)}/hr` }]
                : [{ text: 'Price N/A' }]
            }
            actions={
              <ActionPanel>
                <Action.Push
                  title="View Details"
                  target={<NodeDetailsComponent key={key} details={info} region={region} />}
                />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}

function NodeDetailsComponent({ details, region }: { details: NodeDetails; region: string }) {
  const { baselineBandwidth, isFetchingBandwidth } = useBaselineBandwidth(details.instanceType, region);
  const { pricePerHour, memory, networkPerformance, vcpu } = details;
  const { hourlyCost, dailyCost, monthlyCost } = calculateCosts(pricePerHour);

  const networkThroughput = getNetworkThroughput(isFetchingBandwidth, baselineBandwidth, networkPerformance);


  return (
    <List navigationTitle={`Details for ${details.instanceType}`}>
      <List.Section title="Node Details">
        <List.Item icon={Icon.Monitor} title="Node Type" accessories={[{ text: details.instanceType }]} />
        <List.Item icon={Icon.MemoryChip} title="vCPU" accessories={[{ text: `${details.vcpu} vCPU` }]} />
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
