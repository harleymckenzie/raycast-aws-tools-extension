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
} from '@raycast/api';
import { useState, useMemo } from 'react';
import { ServiceCode } from './shared/awsClient';
import { useAWSInstanceData, useBaselineBandwidth } from './shared/hooks';
import { calculateCosts, getNetworkThroughput } from './shared/utils';

interface Preferences {
  defaultRegion: string;
}

interface InstanceDetails {
  pricePerHour: number | null;
  instanceType: string;
  vcpu: string;
  memory: string;
  physicalProcessor: string;
  storage: string;
  networkPerformance: string;
  baselineBandwidth?: string;
}

interface CommandArguments {
  instanceType?: string;
  region?: string;
}

const CACHE_KEY = 'ec2_instance_data';

export default function Command(props: LaunchProps<{ arguments: CommandArguments }>) {
  const { defaultRegion } = getPreferenceValues<Preferences>();
  const [searchText, setSearchText] = useState(props.arguments.instanceType || '');
  const region = props.arguments.region || defaultRegion;

  const filters = [
    { Type: 'TERM_MATCH', Field: 'regionCode', Value: region },
    { Type: 'TERM_MATCH', Field: 'operatingSystem', Value: 'Linux' },
    { Type: 'TERM_MATCH', Field: 'tenancy', Value: 'Shared' },
    { Type: 'TERM_MATCH', Field: 'capacitystatus', Value: 'Used' },
    { Type: 'TERM_MATCH', Field: 'preInstalledSw', Value: 'NA' },
  ];

  const { instanceData, error, isLoading, loadingStatus } = useAWSInstanceData<InstanceDetails>({
    region,
    serviceCode: ServiceCode.EC2,
    cacheKey: CACHE_KEY,
    filters,
  });

  const filteredInstances = useMemo(() => {
    return Object.entries(instanceData)
      .filter(([key]) => key.toLowerCase().includes(searchText.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [instanceData, searchText]);

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search EC2 instance types..."
      searchText={searchText}
    >
      {isLoading ? (
        <List.EmptyView icon={Icon.Cloud} title="Loading EC2 instance data" description={loadingStatus} />
      ) : error ? (
        <List.Item title="Error" subtitle={error} icon={Icon.ExclamationMark} />
      ) : (
        filteredInstances.map(([key, info]) => (
          <List.Item
            key={key}
            title={info.instanceType}
            subtitle={`${info.vcpu} vCPU | ${info.memory} RAM`}
            icon={Icon.ComputerChip}
            accessories={[
              { text: info.pricePerHour !== null ? `$${info.pricePerHour.toFixed(4)}/hr` : 'Price N/A' },
            ]}
            actions={
              <ActionPanel>
                <Action.Push
                  title="View Details"
                  target={<InstanceDetailsComponent details={info} region={region} />}
                />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}

function InstanceDetailsComponent({ details, region }: { details: InstanceDetails; region: string }) {
  const { baselineBandwidth, isFetchingBandwidth } = useBaselineBandwidth(details.instanceType, region);
  const { pricePerHour, instanceType, memory, vcpu, physicalProcessor, storage, networkPerformance } = details;
  const { hourlyCost, dailyCost, monthlyCost } = calculateCosts(pricePerHour);

  const networkThroughput = getNetworkThroughput(isFetchingBandwidth, baselineBandwidth, networkPerformance);

  return (
    <List navigationTitle={`Details for ${instanceType}`}>
      <List.Section title="Instance Details">
        <List.Item icon={Icon.Monitor} title="Instance Type" accessories={[{ text: instanceType }]} />
        <List.Item icon={Icon.MemoryChip} title="vCPU" accessories={[{ text: `${vcpu} vCPU` }]} />
        <List.Item icon={Icon.MemoryChip} title="Processor Type" accessories={[{ text: physicalProcessor }]} />
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
