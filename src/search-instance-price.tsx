import { Action, ActionPanel, Detail, getPreferenceValues, Icon, LaunchProps, List } from "@raycast/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ServiceCode } from "./shared/awsClient";
import { useAWSInstanceData, useBaselineBandwidth } from "./shared/hooks";
import { getNetworkThroughput } from "./shared/utils";
import React from "react";
import { Clipboard, showToast, Toast } from "@raycast/api";

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
}

const SERVICE_CONFIGS = {
  EC2: {
    serviceCode: ServiceCode.EC2,
    cacheKey: "ec2_instance_data",
    icon: "EC2.png",
    additionalFilters: [
      { Type: "TERM_MATCH", Field: "operatingSystem", Value: "Linux" },
      { Type: "TERM_MATCH", Field: "tenancy", Value: "Shared" },
      { Type: "TERM_MATCH", Field: "capacitystatus", Value: "Used" },
      { Type: "TERM_MATCH", Field: "preInstalledSw", Value: "NA" },
    ],
  },
  "Elasticache (Redis)": {
    serviceCode: ServiceCode.ELASTICACHE,
    cacheKey: "elasticache_redis_instance_data",
    icon: "Elasticache.png",
    additionalFilters: [
      {
        Type: "TERM_MATCH",
        Field: "cacheEngine",
        Value: "Redis",
      },
    ],
  },
  "RDS (Aurora MySQL)": {
    serviceCode: ServiceCode.RDS,
    cacheKey: "rds_aurora_mysql_data",
    icon: "RDS.png",
    additionalFilters: [
      { Type: "TERM_MATCH", Field: "databaseEngine", Value: "Aurora MySQL" },
      { Type: "TERM_MATCH", Field: "deploymentOption", Value: "Single-AZ" },
    ],
  },
  "RDS (Aurora PostgreSQL)": {
    serviceCode: ServiceCode.RDS,
    cacheKey: "rds_aurora_postgresql_data",
    icon: "RDS.png",
    additionalFilters: [
      {
        Type: "TERM_MATCH",
        Field: "databaseEngine",
        Value: "Aurora PostgreSQL",
      },
      { Type: "TERM_MATCH", Field: "deploymentOption", Value: "Single-AZ" },
    ],
  },
  "RDS (MySQL)": {
    serviceCode: ServiceCode.RDS,
    cacheKey: "rds_mysql_data",
    icon: "RDS.png",
    additionalFilters: [
      { Type: "TERM_MATCH", Field: "databaseEngine", Value: "MySQL" },
      { Type: "TERM_MATCH", Field: "deploymentOption", Value: "Single-AZ" },
    ],
  },
  "RDS (PostgreSQL)": {
    serviceCode: ServiceCode.RDS,
    cacheKey: "rds_postgresql_data",
    icon: "RDS.png",
    additionalFilters: [
      { Type: "TERM_MATCH", Field: "databaseEngine", Value: "PostgreSQL" },
      { Type: "TERM_MATCH", Field: "deploymentOption", Value: "Single-AZ" },
    ],
  },
  "RDS (MariaDB)": {
    serviceCode: ServiceCode.RDS,
    cacheKey: "rds_mariadb_data",
    icon: "RDS.png",
    additionalFilters: [
      { Type: "TERM_MATCH", Field: "databaseEngine", Value: "MariaDB" },
      { Type: "TERM_MATCH", Field: "deploymentOption", Value: "Single-AZ" },
    ],
  },
  "RDS (Oracle)": {
    serviceCode: ServiceCode.RDS,
    cacheKey: "rds_oracle_data",
    icon: "RDS.png",
    additionalFilters: [
      { Type: "TERM_MATCH", Field: "databaseEngine", Value: "Oracle" },
      { Type: "TERM_MATCH", Field: "deploymentOption", Value: "Single-AZ" },
    ],
  },
  "RDS (SQL Server)": {
    serviceCode: ServiceCode.RDS,
    cacheKey: "rds_sqlserver_data",
    icon: "RDS.png",
    additionalFilters: [
      { Type: "TERM_MATCH", Field: "databaseEngine", Value: "SQL Server" },
      { Type: "TERM_MATCH", Field: "deploymentOption", Value: "Single-AZ" },
    ],
  },
} as const;

type ServiceType = keyof typeof SERVICE_CONFIGS;

interface InstanceDetailsProps {
  details: InstanceDetails;
  region: string;
  service: ServiceType;
}

// Helper functions
const getStorageInfo = (details: InstanceDetails): string => {
  if (!details.storage) return "EBS-Only";
  return `${details.storage.type}${details.storage.size ? ` ${details.storage.size} GB` : ""}`;
};

const getInstancePrefix = (service: ServiceType): string => {
  if (service.startsWith("RDS")) return "db.";
  if (service.startsWith("Elasticache")) return "cache.";
  return "";
};

function InstanceDetailsComponent({ details, region, service }: InstanceDetailsProps) {
  const [selectedService, setSelectedService] = useState<ServiceType>(service);
  const [instanceType, setInstanceType] = useState(details.instanceType);
  const [refreshKey, setRefreshKey] = useState(0);

  const serviceConfig = SERVICE_CONFIGS[selectedService];
  const filters = [{ Type: "TERM_MATCH", Field: "regionCode", Value: region }, ...serviceConfig.additionalFilters];

  const { instanceData, error, isLoading } = useAWSInstanceData<InstanceDetails>({
    region,
    serviceCode: serviceConfig.serviceCode,
    cacheKey: serviceConfig.cacheKey,
    filters,
    dependencies: [selectedService, refreshKey],
  });

  // Log pricing info when menu is opened or refreshed
  useEffect(() => {
    if (instanceData) {
      const matchingInstance = Object.entries(instanceData).find(([key, data]) => {
        const [instanceTypeKey] = key.split("|");
        const isIOOptimized = data.usagetype?.includes("IOOptimized");
        if (selectedService.startsWith("RDS")) {
          const currentIsIOOptimized = details.usagetype?.includes("IOOptimized");
          return instanceTypeKey === instanceType && isIOOptimized === currentIsIOOptimized;
        }
        return instanceTypeKey === instanceType;
      });
      if (matchingInstance) {
        const [key, data] = matchingInstance;
        // eslint-disable-next-line no-console
        console.log("[Pricing Info]", {
          key,
          pricePerHour: data.pricePerHour,
          usagetype: data.usagetype,
          allAttributes: data,
        });
      } else {
        // eslint-disable-next-line no-console
        console.log(`[Pricing Info] No matching instance for type: ${instanceType}`);
      }
    }
  }, [instanceData, instanceType, selectedService, details.usagetype, refreshKey]);

  // Update instance type when service changes
  useEffect(() => {
    const baseInstanceType = instanceType.replace(/^(db\.|cache\.)+/, "");
    const newPrefix = getInstancePrefix(selectedService);
    setInstanceType(`${newPrefix}${baseInstanceType}`);
  }, [selectedService]);

  // Get all available instance types for dropdown
  const availableInstanceTypes = useMemo(() => {
    if (!instanceData) return [];
    return Array.from(new Set(Object.keys(instanceData).map((key) => key.split("|")[0]))).sort();
  }, [instanceData]);

  const currentInstanceData = useMemo(() => {
    if (!instanceData) return null;

    // Find instance that matches both type and I/O optimisation status
    const matchingInstance = Object.entries(instanceData).find(([key, data]) => {
      const [instanceTypeKey] = key.split("|");
      const isIOOptimized = data.usagetype?.includes("IOOptimized");

      // For RDS, check I/O optimisation status
      if (selectedService.startsWith("RDS")) {
        const currentIsIOOptimized = details.usagetype?.includes("IOOptimized");
        return instanceTypeKey === instanceType && isIOOptimized === currentIsIOOptimized;
      }

      // For other services, just match instance type
      return instanceTypeKey === instanceType;
    });

    return matchingInstance ? matchingInstance[1] : null;
  }, [instanceData, instanceType, selectedService, details.usagetype]);

  const { baselineBandwidth, isFetchingBandwidth } = useBaselineBandwidth(
    instanceType.replace(/^(db\.|cache\.)/, ""),
    region,
  );

  const networkThroughput = getNetworkThroughput(isFetchingBandwidth, baselineBandwidth, details.networkPerformance);

  return (
    <List
      isLoading={isLoading}
      navigationTitle={`Details for ${instanceType}`}
      searchBarAccessory={
        <>
          <List.Dropdown
            tooltip="Select AWS Service"
            value={selectedService}
            onChange={(newValue) => setSelectedService(newValue as ServiceType)}
          >
            <List.Dropdown.Section title="EC2">
              {Object.keys(SERVICE_CONFIGS)
                .filter((service) => service === "EC2")
                .map((service) => (
                  <List.Dropdown.Item
                    key={service}
                    title={service}
                    value={service}
                    icon={{
                      source: SERVICE_CONFIGS[service as ServiceType].icon,
                    }}
                  />
                ))}
            </List.Dropdown.Section>
            <List.Dropdown.Section title="RDS">
              {Object.keys(SERVICE_CONFIGS)
                .filter((service) => service.startsWith("RDS"))
                .map((service) => (
                  <List.Dropdown.Item
                    key={service}
                    title={service}
                    value={service}
                    icon={{
                      source: SERVICE_CONFIGS[service as ServiceType].icon,
                    }}
                  />
                ))}
            </List.Dropdown.Section>
            <List.Dropdown.Section title="Elasticache">
              {Object.keys(SERVICE_CONFIGS)
                .filter((service) => service.startsWith("Elasticache"))
                .map((service) => (
                  <List.Dropdown.Item
                    key={service}
                    title={service}
                    value={service}
                    icon={{
                      source: SERVICE_CONFIGS[service as ServiceType].icon,
                    }}
                  />
                ))}
            </List.Dropdown.Section>
          </List.Dropdown>
          <List.Dropdown
            tooltip="Select Instance Type"
            value={instanceType}
            onChange={(newValue) => setInstanceType(newValue)}
          >
            {availableInstanceTypes.map((type) => (
              <List.Dropdown.Item key={type} title={type} value={type} />
            ))}
          </List.Dropdown>
        </>
      }
    >
      <List.Section title="Instance Details">
        <List.Item icon={Icon.Monitor} title="Instance Type" accessories={[{ text: instanceType }]} />
        {selectedService.startsWith("RDS") && (
          <List.Item
            icon={Icon.Terminal}
            title="Engine"
            accessories={[
              {
                text: selectedService.replace("RDS (", "").replace(")", ""),
              },
            ]}
          />
        )}
        <List.Item icon={Icon.MemoryChip} title="vCPU" accessories={[{ text: `${details.vcpu} vCPU` }]} />
        {details.physicalProcessor && (
          <List.Item
            icon={Icon.MemoryChip}
            title="Processor Type"
            accessories={[{ text: details.physicalProcessor }]}
          />
        )}
        <List.Item icon={Icon.MemoryStick} title="Memory" accessories={[{ text: details.memory }]} />
        <List.Item icon={Icon.HardDrive} title="Storage" accessories={[{ text: getStorageInfo(details) }]} />
        <List.Item icon={Icon.Network} title="Network Performance" accessories={[{ text: networkThroughput }]} />
      </List.Section>

      <List.Section title={`Pricing (${region})`}>
        {error ? (
          <List.Item icon={Icon.ExclamationMark} title="Error fetching price" subtitle={error} />
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
              {
                text: `$${currentInstanceData.pricePerHour?.toFixed(4) ?? "0.0000"}/hr`,
              },
              {
                text: `$${((currentInstanceData.pricePerHour ?? 0) * 24).toFixed(2)}/day`,
              },
              {
                text: `$${((currentInstanceData.pricePerHour ?? 0) * 730).toFixed(2)}/mo`,
              },
            ]}
            actions={
              <ActionPanel>
                <Action
                  title="Refresh Pricing"
                  icon={Icon.RotateClockwise}
                  onAction={() => setRefreshKey((k) => k + 1)}
                />
              </ActionPanel>
            }
          />
        )}
      </List.Section>
    </List>
  );
}

export default function Command(props: LaunchProps<{ arguments: CommandArguments }>) {
  const { defaultRegion } = getPreferenceValues<Preferences>();
  const region = props.arguments.region || defaultRegion;
  const [searchText, setSearchText] = useState(props.arguments.instanceType || "");
  const [selectedService, setSelectedService] = useState<ServiceType>(
    (props.arguments.service as ServiceType) || "EC2",
  );
  const [compareSet, setCompareSet] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);

  // Clear search text when opening comparison modal
  useEffect(() => {
    if (showCompare && searchText !== "") setSearchText("");
  }, [showCompare]);

  const baseFilters = [
    {
      Type: "TERM_MATCH",
      Field: "regionCode",
      Value: region,
    },
  ];

  const serviceConfig = SERVICE_CONFIGS[selectedService];
  const filters = [...baseFilters, ...serviceConfig.additionalFilters];

  const { instanceData, error, isLoading } = useAWSInstanceData<InstanceDetails>({
    region,
    serviceCode: serviceConfig.serviceCode,
    cacheKey: serviceConfig.cacheKey,
    filters,
    dependencies: [selectedService],
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
        const memoryA = parseFloat(a.memory.replace(" GiB", ""));
        const memoryB = parseFloat(b.memory.replace(" GiB", ""));
        const memoryDiff = memoryA - memoryB;
        if (memoryDiff !== 0) return memoryDiff;

        // Finally by price
        if (a.pricePerHour === null) return 1;
        if (b.pricePerHour === null) return -1;
        return a.pricePerHour - b.pricePerHour;
      });
  }, [instanceData, searchText]);

  // Add/remove from compare set
  const toggleCompare = useCallback((key: string) => {
    setCompareSet((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, []);

  const getInstanceTitle = (instanceType: string, info: InstanceDetails) => {
    if (selectedService.startsWith("RDS") && info.usagetype?.includes("IOOptimized")) {
      return `${instanceType} (I/O-Optimized)`;
    }
    return instanceType;
  };

  if (showCompare) {
    // Clear search text when opening comparison modal
    if (searchText !== "") setSearchText("");
    if (!instanceData) return null;
    // Show the comparison table directly
    const compared = compareSet
      .map((key) => {
        const data = instanceData[key];
        return data ? ({ key, ...data } as InstanceDetails & { key: string }) : undefined;
      })
      .filter((item): item is InstanceDetails & { key: string } => item !== undefined);
    if (compared.length < 2) return null;
    const fields = [
      { label: "vCPU", key: "vcpu" },
      { label: "Memory", key: "memory" },
      {
        label: "Price/hr",
        key: "pricePerHour",
        render: (v: unknown) => (v != null ? `$${Number(v).toFixed(4)}` : "N/A"),
      },
      {
        label: "Price/day",
        key: "pricePerHour",
        render: (v: unknown) => (v != null ? `$${(Number(v) * 24).toFixed(2)}` : "N/A"),
      },
      {
        label: "Price/mo",
        key: "pricePerHour",
        render: (v: unknown) => (v != null ? `$${(Number(v) * 730).toFixed(2)}` : "N/A"),
      },
      { label: "Network", key: "networkPerformance" },
    ];
    const headers = ["Attribute", ...compared.map((item) => `**${String(item.instanceType)}**`)];
    const rows = fields.map((field) => {
      const values = compared.map((item) => {
        const value = item[field.key as keyof typeof item];
        return field.render ? field.render(value) : String(value ?? "N/A");
      });
      return `| **${field.label}** | ${values.join(" | ")} |`;
    });
    const headerRow = `| ${headers.map((h) => `**${h}**`).join(" | ")} |`;
    const separatorRow = `|${headers.map(() => ":---:").join("|")}|`;
    const markdown = ["**Comparison Table**", "", headerRow, separatorRow, ...rows].join("\n");
    return (
      <Detail
        markdown={markdown}
        navigationTitle="Compare Instances"
        actions={
          <ActionPanel>
            <Action
              title="Copy Table (markdown)"
              onAction={async () => {
                await Clipboard.copy(markdown);
                showToast({
                  style: Toast.Style.Success,
                  title: "Copied table to clipboard",
                });
              }}
            />
            <Action title="Close Comparison" onAction={() => setShowCompare(false)} />
          </ActionPanel>
        }
      />
    );
  }

  if (error) {
    return (
      <List>
        <List.EmptyView icon={Icon.ExclamationMark} title="Error loading instance data" description={error} />
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
          <List.Dropdown.Section title="EC2">
            {Object.keys(SERVICE_CONFIGS)
              .filter((service) => service === "EC2")
              .map((service) => (
                <List.Dropdown.Item
                  key={service}
                  title={service}
                  value={service}
                  icon={{
                    source: SERVICE_CONFIGS[service as ServiceType].icon,
                  }}
                />
              ))}
          </List.Dropdown.Section>
          <List.Dropdown.Section title="RDS">
            {Object.keys(SERVICE_CONFIGS)
              .filter((service) => service.startsWith("RDS"))
              .map((service) => (
                <List.Dropdown.Item
                  key={service}
                  title={service}
                  value={service}
                  icon={{
                    source: SERVICE_CONFIGS[service as ServiceType].icon,
                  }}
                />
              ))}
          </List.Dropdown.Section>
          <List.Dropdown.Section title="Elasticache">
            {Object.keys(SERVICE_CONFIGS)
              .filter((service) => service.startsWith("Elasticache"))
              .map((service) => (
                <List.Dropdown.Item
                  key={service}
                  title={service}
                  value={service}
                  icon={{
                    source: SERVICE_CONFIGS[service as ServiceType].icon,
                  }}
                />
              ))}
          </List.Dropdown.Section>
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
              text: info.pricePerHour !== null ? `$${info.pricePerHour.toFixed(4)}/hr` : "Price N/A",
            },
            ...(compareSet.includes(key) ? [{ icon: Icon.CheckCircle, tooltip: "In Comparison" }] : []),
          ]}
          actions={
            <ActionPanel>
              <Action.Push
                title="View Details"
                target={<InstanceDetailsComponent details={info} region={region} service={selectedService} />}
              />
              <Action
                title={compareSet.includes(key) ? "Remove from Compare" : "Add to Compare"}
                icon={compareSet.includes(key) ? Icon.MinusCircle : Icon.PlusCircle}
                onAction={() => toggleCompare(key)}
              />
            </ActionPanel>
          }
        />
      ))}
      {compareSet.length >= 2 && (
        <List.Item
          key="compare-action"
          title="Compare Selected Instances"
          icon={Icon.Sidebar}
          actions={
            <ActionPanel>
              <Action title="Compare Selected" icon={Icon.Sidebar} onAction={() => setShowCompare(true)} />
            </ActionPanel>
          }
        />
      )}
    </List>
  );
}
