/* eslint-disable @raycast/prefer-title-case */
import { useState, useEffect } from "react";
import { Color, Icon, List, ActionPanel, Action, getPreferenceValues, LaunchProps } from "@raycast/api";
import { DescribeInstancesCommand, Instance, Reservation } from "@aws-sdk/client-ec2";
import {
  RDSClient,
  DescribeDBInstancesCommand,
  DBInstance,
  ListTagsForResourceCommand,
  DescribeDBClustersCommand,
} from "@aws-sdk/client-rds";
import { ElastiCacheClient, DescribeCacheClustersCommand, CacheCluster } from "@aws-sdk/client-elasticache";
import { createEC2Client } from "./shared/awsClient";

interface Preferences {
  awsProfile: string;
  defaultRegion: string;
}

interface CommandArguments {
  profile?: string;
  service?: string;
}

type AwsService = "All" | "EC2" | "RDS" | "ElastiCache";

type ResourceUnion =
  | (Instance & { resourceType: "EC2" })
  | (DBInstance & { resourceType: "RDS"; Tags?: { Key?: string; Value?: string }[]; AuroraRole?: AuroraRole })
  | (CacheCluster & { resourceType: "ElastiCache" });

export default function ListAWSResourcesCommand(props: LaunchProps<{ arguments: CommandArguments }>) {
  const { awsProfile, defaultRegion } = getPreferenceValues<Preferences>();
  const profile = props.arguments.profile || awsProfile;
  const region = defaultRegion;

  const [selectedService, setSelectedService] = useState<AwsService>((props.arguments.service as AwsService) || "All");
  const [resources, setResources] = useState<ResourceUnion[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchAllResources = async () => {
      setIsLoading(true);
      try {
        const [ec2, rds, elasticache] = await Promise.all([
          listEC2Instances(profile, region),
          listRDSInstances(profile, region),
          listElastiCacheClusters(profile, region),
        ]);
        setResources([
          ...(ec2 ?? []).map((i) => ({ ...i, resourceType: "EC2" as const })),
          ...(rds ?? []).map((i) => ({ ...i, resourceType: "RDS" as const })),
          ...(elasticache ?? []).map((i) => ({ ...i, resourceType: "ElastiCache" as const })),
        ]);
      } catch (error) {
        console.error("Error fetching resources:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchAllResources();
  }, [profile, region]);

  const filteredResources = resources.filter((r) =>
    selectedService === "All" ? true : r.resourceType === selectedService,
  );

  return (
    <List
      isLoading={isLoading}
      isShowingDetail
      searchBarPlaceholder="Search AWS Resources..."
      searchBarAccessory={
        <List.Dropdown
          tooltip="Filter AWS Service"
          value={selectedService}
          onChange={(newValue) => setSelectedService(newValue as AwsService)}
        >
          <List.Dropdown.Item title="All" value="All" />
          <List.Dropdown.Item title="EC2" value="EC2" />
          <List.Dropdown.Item title="RDS" value="RDS" />
          <List.Dropdown.Item title="ElastiCache" value="ElastiCache" />
        </List.Dropdown>
      }
    >
      {/* EC2 Section */}
      {filteredResources.some((r) => r.resourceType === "EC2") && (
        <List.Section title="EC2 Instances">
          {filteredResources
            .filter((resource) => resource.resourceType === "EC2")
            .map((resource, idx) => (
              <List.Item
                key={resource.InstanceId || idx}
                title={resource?.Tags?.find((tag) => tag.Key === "Name")?.Value ?? resource?.InstanceId ?? ""}
                icon={Icon.Box}
                accessories={[
                  {
                    icon: { source: Icon.Dot, tintColor: getEc2StatusColor(resource?.State?.Name) },
                  },
                  {
                    text: "EC2",
                    icon: Icon.ComputerChip,
                  },
                ]}
                detail={
                  <List.Item.Detail
                    metadata={
                      <List.Item.Detail.Metadata>
                        <List.Item.Detail.Metadata.Label
                          title="Name"
                          text={resource?.Tags?.find((tag) => tag.Key === "Name")?.Value ?? ""}
                        />
                        <List.Item.Detail.Metadata.Label title="Resource ID" text={resource?.InstanceId ?? ""} />
                        <List.Item.Detail.Metadata.Label title="Resource Type" text={resource?.InstanceType ?? ""} />
                        <List.Item.Detail.Metadata.Label
                          icon={{
                            source: Icon.Dot,
                            tintColor: resource?.State?.Name === "running" ? Color.Green : Color.Red,
                          }}
                          title="State"
                          text={resource?.State?.Name ?? ""}
                        />
                        <List.Item.Detail.Metadata.Label title="AMI ID" text={resource?.ImageId ?? ""} />
                        <List.Item.Detail.Metadata.Label title="Key Name" text={resource?.KeyName ?? ""} />
                        <List.Item.Detail.Metadata.Label
                          title="Launch Time"
                          text={resource?.LaunchTime?.toISOString() ?? ""}
                        />
                        <List.Item.Detail.Metadata.Separator />
                        <List.Item.Detail.Metadata.Label
                          title="Private IP Address"
                          text={resource?.PrivateIpAddress ?? ""}
                        />
                        <List.Item.Detail.Metadata.Label
                          title="Public IP Address"
                          text={resource?.PublicIpAddress ?? ""}
                        />
                        <List.Item.Detail.Metadata.Label title="VPC ID" text={resource?.VpcId ?? ""} />
                        <List.Item.Detail.Metadata.Label
                          title="Availability Zone"
                          text={resource?.Placement?.AvailabilityZone ?? ""}
                        />
                        <List.Item.Detail.Metadata.Label title="Subnet ID" text={resource?.SubnetId ?? ""} />
                        <List.Item.Detail.Metadata.TagList title="Tags">
                          {resource?.Tags?.map((tag: { Key?: string; Value?: string }, tagIdx: number) => (
                            <List.Item.Detail.Metadata.TagList.Item
                              key={`${tag.Key ?? "tag"}-${tag.Value ?? tagIdx}`}
                              text={`${tag.Key}: ${tag.Value}`}
                              color={Color.Orange}
                            />
                          )) ?? <List.Item.Detail.Metadata.TagList.Item text="No tags" color={Color.SecondaryText} />}
                        </List.Item.Detail.Metadata.TagList>
                      </List.Item.Detail.Metadata>
                    }
                  />
                }
                actions={
                  <ActionPanel title="Resource Actions">
                    <Action.Push title="View Details" target={<ResourceDetailsComponent resource={resource} />} />
                    <Action.OpenInBrowser
                      title="Open in Browser"
                      url={`https://${region}.console.aws.amazon.com/ec2/home?region=${region}#InstanceDetails:instanceId=${resource.InstanceId}`}
                    />
                    <Action.CopyToClipboard title="Copy Public IP" content={resource.PublicIpAddress ?? ""} />
                    <Action.Paste
                      title="Paste SSH Command"
                      content={resource.PublicIpAddress ? `ssh ${resource.PublicIpAddress}` : ""}
                    />
                    <Action.CopyToClipboard
                      title="Copy SSH Command"
                      content={resource.PublicIpAddress ? `ssh ${resource.PublicIpAddress}` : ""}
                    />
                    <Action.CopyToClipboard title="Copy Resource ID" content={resource.InstanceId ?? ""} />
                  </ActionPanel>
                }
              />
            ))}
        </List.Section>
      )}
      {/* RDS Section */}
      {filteredResources.some((r) => r.resourceType === "RDS") && (
        <List.Section title="RDS Instances">
          {filteredResources
            .filter((resource) => resource.resourceType === "RDS")
            .map((resource, idx) => (
              <List.Item
                key={resource.DBInstanceIdentifier || idx}
                title={resource?.DBInstanceIdentifier ?? ""}
                icon={Icon.Box}
                accessories={[
                  {
                    icon: { source: Icon.Dot, tintColor: getRdsStatusColor(resource?.DBInstanceStatus) },
                  },
                  {
                    text: "RDS",
                    icon: Icon.Coin,
                  },
                ]}
                detail={
                  <List.Item.Detail
                    metadata={
                      <List.Item.Detail.Metadata>
                        <List.Item.Detail.Metadata.Label
                          title="DB Instance Identifier"
                          text={resource?.DBInstanceIdentifier ?? ""}
                        />
                        <List.Item.Detail.Metadata.Label title="Engine" text={resource?.Engine ?? ""} />
                        <List.Item.Detail.Metadata.Label title="Engine Version" text={resource?.EngineVersion ?? ""} />
                        <List.Item.Detail.Metadata.Label
                          title="Status"
                          text={resource?.DBInstanceStatus ?? ""}
                          icon={{ source: Icon.Dot, tintColor: getRdsStatusColor(resource?.DBInstanceStatus) }}
                        />
                        <List.Item.Detail.Metadata.Label
                          title="Instance Class"
                          text={resource?.DBInstanceClass ?? ""}
                        />
                        <List.Item.Detail.Metadata.Label
                          title="Availability Zone"
                          text={resource?.AvailabilityZone ?? ""}
                        />
                        <List.Item.Detail.Metadata.Label title="Endpoint" text={resource?.Endpoint?.Address ?? ""} />
                        <List.Item.Detail.Metadata.Label
                          title="Port"
                          text={resource?.Endpoint?.Port?.toString() ?? ""}
                        />
                        <List.Item.Detail.Metadata.Label title="ARN" text={resource?.DBInstanceArn ?? ""} />
                        <List.Item.Detail.Metadata.Label title="VPC ID" text={resource?.DBSubnetGroup?.VpcId ?? ""} />
                        {resource?.DBClusterIdentifier && (
                          <List.Item.Detail.Metadata.Label
                            title="Cluster Identifier"
                            text={resource.DBClusterIdentifier}
                          />
                        )}
                        <List.Item.Detail.Metadata.TagList title="Tags">
                          {resource?.Tags?.map((tag: { Key?: string; Value?: string }, tagIdx: number) => (
                            <List.Item.Detail.Metadata.TagList.Item
                              key={`${tag.Key ?? "tag"}-${tag.Value ?? tagIdx}`}
                              text={`${tag.Key}: ${tag.Value}`}
                              color={Color.Orange}
                            />
                          )) ?? <List.Item.Detail.Metadata.TagList.Item text="No tags" color={Color.SecondaryText} />}
                        </List.Item.Detail.Metadata.TagList>
                      </List.Item.Detail.Metadata>
                    }
                  />
                }
                actions={
                  <ActionPanel title="Resource Actions">
                    <Action.CopyToClipboard title="Copy Endpoint" content={resource?.Endpoint?.Address ?? ""} />
                    <Action.CopyToClipboard title="Copy ARN" content={resource?.DBInstanceArn ?? ""} />
                  </ActionPanel>
                }
              />
            ))}
        </List.Section>
      )}
      {/* ElastiCache Section */}
      {filteredResources.some((r) => r.resourceType === "ElastiCache") && (
        <List.Section title="ElastiCache Clusters">
          {filteredResources
            .filter((resource) => resource.resourceType === "ElastiCache")
            .map((resource, idx) => (
              <List.Item
                key={resource.CacheClusterId || idx}
                title={resource.CacheClusterId ?? ""}
                icon={Icon.Box}
                accessories={[
                  {
                    icon: {
                      source: Icon.Dot,
                      tintColor: resource.CacheClusterStatus === "available" ? Color.Green : Color.Yellow,
                    },
                  },
                  {
                    text: "Cache",
                    icon: Icon.MemoryChip,
                  },
                ]}
                detail={
                  <List.Item.Detail
                    metadata={
                      <List.Item.Detail.Metadata>
                        <List.Item.Detail.Metadata.Label title="Cluster ID" text={resource.CacheClusterId ?? ""} />
                        <List.Item.Detail.Metadata.Label title="Engine" text={resource.Engine ?? ""} />
                        <List.Item.Detail.Metadata.Label title="Engine Version" text={resource.EngineVersion ?? ""} />
                        <List.Item.Detail.Metadata.Label
                          title="Status"
                          text={resource.CacheClusterStatus ?? ""}
                          icon={{
                            source: Icon.Dot,
                            tintColor: resource.CacheClusterStatus === "available" ? Color.Green : Color.Yellow,
                          }}
                        />
                        <List.Item.Detail.Metadata.Label title="Node Type" text={resource.CacheNodeType ?? ""} />
                        <List.Item.Detail.Metadata.Label
                          title="Num Nodes"
                          text={resource.NumCacheNodes?.toString() ?? ""}
                        />
                        <List.Item.Detail.Metadata.Label
                          title="Endpoint"
                          text={
                            resource.ConfigurationEndpoint?.Address ?? resource.CacheNodes?.[0]?.Endpoint?.Address ?? ""
                          }
                        />
                        <List.Item.Detail.Metadata.Label
                          title="Port"
                          text={
                            resource.ConfigurationEndpoint?.Port?.toString() ??
                            resource.CacheNodes?.[0]?.Endpoint?.Port?.toString() ??
                            ""
                          }
                        />
                        <List.Item.Detail.Metadata.Label title="ARN" text={resource.ARN ?? ""} />
                      </List.Item.Detail.Metadata>
                    }
                  />
                }
                actions={
                  <ActionPanel title="Resource Actions">
                    <Action.CopyToClipboard
                      title="Copy Endpoint"
                      content={
                        resource.ConfigurationEndpoint?.Address ?? resource.CacheNodes?.[0]?.Endpoint?.Address ?? ""
                      }
                    />
                    <Action.CopyToClipboard title="Copy ARN" content={resource.ARN ?? ""} />
                  </ActionPanel>
                }
              />
            ))}
        </List.Section>
      )}
    </List>
  );
}

interface ResourceDetailsProps {
  resource: Instance;
}

function ResourceDetailsComponent({ resource }: ResourceDetailsProps) {
  return (
    <List navigationTitle="Resource Details">
      <List.Section title="Resource Details">
        <List.Item
          title="Name"
          accessories={[{ text: resource?.Tags?.find((tag) => tag.Key === "Name")?.Value ?? "N/A" }]}
        />
        <List.Item title="Resource ID" accessories={[{ text: resource?.InstanceId ?? "N/A" }]} />
        <List.Item title="Resource Type" accessories={[{ text: resource?.InstanceType ?? "N/A" }]} />
        <List.Item title="State" accessories={[{ text: resource?.State?.Name ?? "N/A" }]} />
        <List.Item title="Public IP" accessories={[{ text: resource?.PublicIpAddress ?? "N/A" }]} />
        <List.Item title="Private IP" accessories={[{ text: resource?.PrivateIpAddress ?? "N/A" }]} />
        <List.Item title="VPC ID" accessories={[{ text: resource?.VpcId ?? "N/A" }]} />
        <List.Item title="Availability Zone" subtitle={resource?.Placement?.AvailabilityZone ?? "N/A"} />
      </List.Section>
      <List.Section title="Tags">
        {resource?.Tags?.map((tag: { Key?: string; Value?: string }) => (
          <List.Item key={tag.Key} title={tag.Key ?? "N/A"} subtitle={tag.Value ?? "N/A"} />
        )) ?? <List.Item title="No tags" subtitle="This resource has no tags" />}
      </List.Section>
    </List>
  );
}

export async function listEC2Instances(profile: string, region: string): Promise<Instance[]> {
  const { awsProfile, defaultRegion } = getPreferenceValues<Preferences>();
  const profileToUse = profile || awsProfile;
  const regionToUse = region || defaultRegion;

  try {
    const ec2_client = createEC2Client(profileToUse, regionToUse);
    const input = { DryRun: false };
    const command = new DescribeInstancesCommand(input);
    const response = await ec2_client.send(command);
    return response.Reservations?.flatMap((reservation: Reservation) => reservation.Instances ?? []) ?? [];
  } catch (error) {
    console.error(error);
    return [];
  }
}

type AuroraRole = "Writer" | "Reader" | undefined;
async function listRDSInstances(
  profile: string,
  region: string,
): Promise<(DBInstance & { Tags?: { Key?: string; Value?: string }[]; AuroraRole?: AuroraRole })[]> {
  const client = new RDSClient({
    region,
    credentials: (await import("@aws-sdk/credential-provider-ini")).fromIni({ profile }),
  });
  try {
    const command = new DescribeDBInstancesCommand({});
    const response = await client.send(command);
    const instances = response.DBInstances ?? [];
    // Fetch tags for each instance
    const withTags = await Promise.all(
      instances.map(async (instance) => {
        if (!instance.DBInstanceArn) return instance;
        try {
          const tagResp = await client.send(new ListTagsForResourceCommand({ ResourceName: instance.DBInstanceArn }));
          return { ...instance, Tags: tagResp.TagList };
        } catch (err) {
          return { ...instance, Tags: [] };
        }
      }),
    );
    // Aurora: fetch cluster info for role
    const clusterIds = Array.from(new Set(withTags.map((i) => i.DBClusterIdentifier).filter(Boolean)));
    const clusterRoles: Record<string, AuroraRole> = {};
    if (clusterIds.length > 0) {
      const clusterResp = await client.send(
        new DescribeDBClustersCommand({ DBClusterIdentifier: clusterIds.length === 1 ? clusterIds[0] : undefined }),
      );
      const clusters = clusterResp.DBClusters ?? [];
      clusters.forEach((cluster) => {
        (cluster.DBClusterMembers ?? []).forEach((member) => {
          if (member.DBInstanceIdentifier) {
            clusterRoles[member.DBInstanceIdentifier] = member.IsClusterWriter ? "Writer" : "Reader";
          }
        });
      });
    }
    // Attach AuroraRole to each instance
    const withRoles = withTags.map((inst) =>
      inst.DBClusterIdentifier && inst.DBInstanceIdentifier && clusterRoles[inst.DBInstanceIdentifier]
        ? { ...inst, AuroraRole: clusterRoles[inst.DBInstanceIdentifier] }
        : inst,
    );
    return withRoles;
  } catch (error) {
    console.error("Error fetching RDS instances:", error);
    return [];
  }
}

function getRdsStatusColor(status: string | undefined): string {
  if (!status) return Color.SecondaryText;
  const s = status.toLowerCase();
  if (s === "available") return Color.Green;
  if (s === "modifying") return Color.Yellow;
  if (s === "failed" || s === "deleting") return Color.Red;
  return Color.SecondaryText;
}

function getEc2StatusColor(status: string | undefined): string {
  if (!status) return Color.SecondaryText;
  const s = status.toLowerCase();
  if (s === "running") return Color.Green;
  if (s === "pending" || s === "stopping" || s === "shutting-down") return Color.Yellow;
  if (s === "stopped" || s === "terminated") return Color.Red;
  return Color.SecondaryText;
}

// List ElastiCache clusters
async function listElastiCacheClusters(profile: string, region: string): Promise<CacheCluster[]> {
  const client = new ElastiCacheClient({
    region,
    credentials: (await import("@aws-sdk/credential-provider-ini")).fromIni({ profile }),
  });
  try {
    const command = new DescribeCacheClustersCommand({ ShowCacheNodeInfo: true });
    const response = await client.send(command);
    return response.CacheClusters ?? [];
  } catch (error) {
    console.error("Error fetching ElastiCache clusters:", error);
    return [];
  }
}
