import {
    List,
    LaunchProps,
    getPreferenceValues,
    Icon,
    ActionPanel,
    Action,
  } from '@raycast/api';
  import { useState, useMemo, useEffect } from 'react';
  import { ServiceCode } from './shared/awsClient';
  import { useAWSInstanceData, useBaselineBandwidth } from './shared/hooks';
  import { calculateCosts, getNetworkThroughput } from './shared/utils';
  
  interface Preferences {
    defaultRegion: string;
  }
  
  interface CommandArguments {
    instanceType?: string;
    region?: string;
    service?: string;
  }
  
  interface InstanceDetails {
    instanceType: string;
    vcpu: number;
    memory: string;
    networkPerformance: string;
    pricePerHour: number | null;
    usagetype?: string;
    storage?: {
      type: string;
      size?: number;
      iops?: number;
    };
    processorInfo?: {
      sustainedClockSpeedInGhz?: number;
      model?: string;
    };
    physicalProcessor?: string;
    clockSpeed?: number;
    architecture?: string;
    gpu?: {
      name: string;
      count: number;
      memoryGiB: number;
    };
    enhancedNetworkingSupported?: boolean;
    dedicatedEbsOptimized?: boolean;
    maxBandwidthGbps?: number;
    baselineBandwidthGbps?: number;
    maxIops?: number;
    baselineIops?: number;
  }
  
  const SERVICE_CONFIGS = {
    'EC2': {
      serviceCode: ServiceCode.EC2,
      cacheKey: 'ec2_instance_data',
      icon: Icon.ComputerChip,
      additionalFilters: [
        { Type: 'TERM_MATCH', Field: 'operatingSystem', Value: 'Linux' },
        { Type: 'TERM_MATCH', Field: 'tenancy', Value: 'Shared' },
        { Type: 'TERM_MATCH', Field: 'capacitystatus', Value: 'Used' },
        { Type: 'TERM_MATCH', Field: 'preInstalledSw', Value: 'NA' },
      ],
    },
    'Elasticache': {
      serviceCode: ServiceCode.ELASTICACHE,
      cacheKey: 'elasticache_instance_data',
      additionalFilters: [
        { Type: 'TERM_MATCH', Field: 'cacheEngine', Value: 'Redis' },
      ],
    },
    'RDS (Aurora MySQL)': {
      serviceCode: ServiceCode.RDS,
      cacheKey: 'rds_aurora_mysql_data',
      additionalFilters: [
        { Type: 'TERM_MATCH', Field: 'databaseEngine', Value: 'Aurora MySQL' },
        { Type: 'TERM_MATCH', Field: 'deploymentOption', Value: 'Single-AZ' },
      ],
    },
    'RDS (Aurora PostgreSQL)': {
      serviceCode: ServiceCode.RDS,
      cacheKey: 'rds_aurora_postgresql_data',
      additionalFilters: [
        { Type: 'TERM_MATCH', Field: 'databaseEngine', Value: 'Aurora PostgreSQL' },
        { Type: 'TERM_MATCH', Field: 'deploymentOption', Value: 'Single-AZ' },
      ],
    },
    'RDS (MySQL)': {
      serviceCode: ServiceCode.RDS,
      cacheKey: 'rds_mysql_data',
      additionalFilters: [
        { Type: 'TERM_MATCH', Field: 'databaseEngine', Value: 'MySQL' },
        { Type: 'TERM_MATCH', Field: 'deploymentOption', Value: 'Single-AZ' },
      ],
    },
    'RDS (PostgreSQL)': {
      serviceCode: ServiceCode.RDS,
      cacheKey: 'rds_postgresql_data',
      additionalFilters: [
        { Type: 'TERM_MATCH', Field: 'databaseEngine', Value: 'PostgreSQL' },
        { Type: 'TERM_MATCH', Field: 'deploymentOption', Value: 'Single-AZ' },
      ],
    },
    'RDS (MariaDB)': {
      serviceCode: ServiceCode.RDS,
      cacheKey: 'rds_mariadb_data',
      additionalFilters: [
        { Type: 'TERM_MATCH', Field: 'databaseEngine', Value: 'MariaDB' },
        { Type: 'TERM_MATCH', Field: 'deploymentOption', Value: 'Single-AZ' },
      ],
    },
    'RDS (Oracle)': {
      serviceCode: ServiceCode.RDS,
      cacheKey: 'rds_oracle_data',
      additionalFilters: [
        { Type: 'TERM_MATCH', Field: 'databaseEngine', Value: 'Oracle' },
        { Type: 'TERM_MATCH', Field: 'deploymentOption', Value: 'Single-AZ' },
      ],
    },
    'RDS (SQL Server)': {
      serviceCode: ServiceCode.RDS,
      cacheKey: 'rds_sqlserver_data',
      additionalFilters: [
        { Type: 'TERM_MATCH', Field: 'databaseEngine', Value: 'SQL Server' },
        { Type: 'TERM_MATCH', Field: 'deploymentOption', Value: 'Single-AZ' },
      ],
    },
  } as const;

type ServiceType = keyof typeof SERVICE_CONFIGS;

interface InstanceDetailsProps {
  details: InstanceDetails;
  region: string;
  service: ServiceType;
}

function InstanceDetailsComponent({ details, region, service }: InstanceDetailsProps) {
  const [selectedService, setSelectedService] = useState<ServiceType>(service);
  const [instanceType, setInstanceType] = useState(details.instanceType);

  const serviceConfig = SERVICE_CONFIGS[selectedService];
  const filters = [
    { Type: 'TERM_MATCH', Field: 'regionCode', Value: region },
    ...serviceConfig.additionalFilters
  ];

  const { instanceData, error, isLoading } = useAWSInstanceData<InstanceDetails>({
    region,
    serviceCode: serviceConfig.serviceCode,
    cacheKey: serviceConfig.cacheKey,
    filters,
    dependencies: [selectedService]
  });

  // Get current instance price
  const currentInstanceData = useMemo(() => {
    if (!instanceData) return null;
    
    // Find the instance by matching the prefix of the usage type
    const matchingInstance = Object.entries(instanceData).find(([key]) => 
      key.startsWith(`${instanceType}|`)
    );
    
    console.log('Instance Data Lookup:', {
      instanceType,
      matchFound: !!matchingInstance,
      matchingKey: matchingInstance?.[0]
    });
    
    return matchingInstance ? matchingInstance[1] : null;
  }, [instanceData, instanceType]);

  // Update instance type when service changes
  useEffect(() => {
    let newInstanceType = instanceType;
    
    // First, strip all prefixes
    newInstanceType = newInstanceType.replace(/^(db\.|cache\.)+/, '');
    
    // Then add the correct prefix based on the selected service
    if (selectedService.startsWith('RDS')) {
      newInstanceType = `db.${newInstanceType}`;
    } else if (selectedService === 'Elasticache') {
      newInstanceType = `cache.${newInstanceType}`;
    }
    
    console.log('Instance Type Update:', {
      from: instanceType,
      to: newInstanceType,
      service: selectedService
    });
    
    setInstanceType(newInstanceType);
  }, [selectedService]);

  const { baselineBandwidth, isFetchingBandwidth } = useBaselineBandwidth(
    instanceType.replace(/^(db\.|cache\.)/, ''),
    region
  );
  
  const networkThroughput = getNetworkThroughput(
    isFetchingBandwidth, 
    baselineBandwidth, 
    details.networkPerformance
  );
  
  // Use the current instance data for pricing if available
  const pricePerHour = currentInstanceData?.pricePerHour ?? details.pricePerHour;
  const { hourlyCost, dailyCost, monthlyCost } = calculateCosts(pricePerHour);

  // Helper function to format storage info
  const getStorageInfo = (details: InstanceDetails) => {
    if (!details.storage) return "EBS-Only";
    return `${details.storage.type}${
      details.storage.size ? ` ${details.storage.size} GB` : ''
    }`;
  };

  return (
    <List 
      isLoading={isLoading}
      navigationTitle={`Details for ${instanceType}`}
      searchBarAccessory={
        <List.Dropdown
          tooltip="Select AWS Service"
          value={selectedService}
          onChange={(newValue) => setSelectedService(newValue as ServiceType)}
        >
          {Object.keys(SERVICE_CONFIGS).map((service) => (
            <List.Dropdown.Item
              key={service}
              title={service}
              value={service}
            />
          ))}
        </List.Dropdown>
      }
    >
      <List.Section title="Instance Details">
        <List.Item 
          icon={Icon.Monitor} 
          title="Instance Type" 
          accessories={[{ text: instanceType }]} 
        />
        {selectedService.startsWith('RDS') && (
          <List.Item 
            icon={Icon.Terminal} 
            title="Engine" 
            accessories={[{ 
              text: selectedService.replace('RDS (', '').replace(')', '') 
            }]} 
          />
        )}
        <List.Item 
          icon={Icon.MemoryChip} 
          title="vCPU" 
          accessories={[{ text: `${details.vcpu} vCPU` }]} 
        />
        {details.physicalProcessor && (
          <List.Item 
            icon={Icon.MemoryChip} 
            title="Processor Type" 
            accessories={[{ text: details.physicalProcessor }]} 
          />
        )}
        <List.Item 
          icon={Icon.MemoryStick} 
          title="Memory" 
          accessories={[{ text: details.memory }]} 
        />
        <List.Item 
          icon={Icon.HardDrive} 
          title="Storage" 
          accessories={[{ text: getStorageInfo(details) }]} 
        />
        <List.Item 
          icon={Icon.Network} 
          title="Network Performance" 
          accessories={[{ text: networkThroughput }]} 
        />
      </List.Section>

      <List.Section title={`Pricing (${region})`}>
        {error ? (
          <List.Item
            icon={Icon.ExclamationMark}
            title="Error fetching price"
            subtitle={error}
          />
        ) : isLoading ? (
          <List.Item
            icon={Icon.Clock}
            title="Retrieving pricing information..."
            subtitle={`Loading ${selectedService} pricing data`}
          />
        ) : !currentInstanceData ? (
          <List.Item
            icon={Icon.ExclamationMark}
            title="Instance type not available"
            subtitle={`${instanceType} is not available in ${selectedService}`}
          />
        ) : (
          <List.Item
            icon={Icon.BankNote}
            title="Pricing"
            accessories={[
              { text: `$${currentInstanceData.pricePerHour.toFixed(4)}/hr` },
              { text: `$${(currentInstanceData.pricePerHour * 24).toFixed(2)}/day` },
              { text: `$${(currentInstanceData.pricePerHour * 24 * 30).toFixed(2)}/mo` },
            ]}
          />
        )}
      </List.Section>
    </List>
  );
}

export default function Command(
  props: LaunchProps<{ arguments: CommandArguments }>
) {
  const { defaultRegion } = getPreferenceValues<Preferences>();
  const region = props.arguments.region || defaultRegion;
  const [searchText, setSearchText] = useState(
    props.arguments.instanceType || ''
  );
  const [selectedService, setSelectedService] = useState<ServiceType>(
    (props.arguments.service as ServiceType) || 'EC2'
  );
  
  const baseFilters = [
    { Type: 'TERM_MATCH', Field: 'regionCode', Value: region },
  ];
  
  const serviceConfig = SERVICE_CONFIGS[selectedService];
  const filters = [...baseFilters, ...serviceConfig.additionalFilters];
  
  const { instanceData, error, isLoading, loadingStatus } = useAWSInstanceData<
    InstanceDetails
  >({
    region,
    serviceCode: serviceConfig.serviceCode,
    cacheKey: serviceConfig.cacheKey,
    filters,
    // Add this to force refresh when service changes
    dependencies: [selectedService]
  });
  
  const filteredInstances = useMemo(() => {
    if (!instanceData) return [];
  
    return Object.entries(instanceData)
      .filter(([instanceType]) => {
        const searchLower = searchText.toLowerCase();
        return instanceType.toLowerCase().includes(searchLower);
      })
      .sort(([, a], [, b]) => {
        // Sort by vCPU first
        const vcpuDiff = a.vcpu - b.vcpu;
        if (vcpuDiff !== 0) return vcpuDiff;
  
        // Then by memory
        const memoryA = parseFloat(a.memory.replace(' GiB', ''));
        const memoryB = parseFloat(b.memory.replace(' GiB', ''));
        const memoryDiff = memoryA - memoryB;
        if (memoryDiff !== 0) return memoryDiff;
  
        // Finally by price
        if (a.pricePerHour === null) return 1;
        if (b.pricePerHour === null) return -1;
        return a.pricePerHour - b.pricePerHour;
      });
  }, [instanceData, searchText]);
  
  const getInstanceTitle = (instanceType: string, info: InstanceDetails) => {
    if (
      selectedService.startsWith('RDS') && 
      info.usagetype?.includes('IOOptimized')
    ) {
      return `${instanceType} (I/O-Optimized)`;
    }
    return instanceType;
  };
  
  if (error) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Error loading instance data"
          description={error}
        />
      </List>
    );
  }
  
  if (!isLoading && (!instanceData || Object.keys(instanceData).length === 0)) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="No instances found"
          description={`No ${selectedService} instances found for region ${region}`}
        />
      </List>
    );
  }
  
  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder={`Search ${selectedService} instance types...`}
      searchText={searchText}
      searchBarAccessory={
        <List.Dropdown
          tooltip="Select AWS Service"
          value={selectedService}
          onChange={(newValue) => setSelectedService(newValue as ServiceType)}
        >
          {Object.keys(SERVICE_CONFIGS).map((service) => (
            <List.Dropdown.Item
              key={service}
              title={service}
              value={service}
            />
          ))}
        </List.Dropdown>
      }
    >
      {filteredInstances.map(([key, info]) => (
        <List.Item
          key={key}
          title={getInstanceTitle(info.instanceType, info)}
          subtitle={`${info.vcpu} vCPU | ${info.memory} RAM`}
          icon={Icon.MemoryChip}
          accessories={[
            {
              text: info.pricePerHour !== null
                ? `$${info.pricePerHour.toFixed(4)}/hr`
                : 'Price N/A',
            },
          ]}
          actions={
            <ActionPanel>
              <Action.Push
                title="View Details"
                target={
                  <InstanceDetailsComponent
                    details={info}
                    region={region}
                    service={selectedService}
                  />
                }
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
