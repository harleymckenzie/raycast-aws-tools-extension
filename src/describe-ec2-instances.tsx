/* eslint-disable @raycast/prefer-title-case */
import { useState, useEffect } from "react";
import { Color, Icon, List, ActionPanel, Action, getPreferenceValues, LaunchProps } from "@raycast/api";
import { DescribeInstancesCommand, Instance } from "@aws-sdk/client-ec2";
import { createEC2Client } from "./shared/awsClient";

interface Preferences {
  awsProfile: string;
  defaultRegion: string;
}

interface CommandArguments {
  profile?: string;
}

type AwsService = "EC2" | "RDS";

export default function ListAWSResourcesCommand(props: LaunchProps<{ arguments: CommandArguments }>) {
  const { awsProfile, defaultRegion } = getPreferenceValues<Preferences>();
  const profile = props.arguments.profile || awsProfile;
  const region = defaultRegion;

  const [selectedService, setSelectedService] = useState<AwsService>("EC2");
  const [resources, setResources] = useState<Instance[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchInstances = async () => {
      setIsLoading(true);
      try {
        let data: Instance[] = [];
        if (selectedService === "EC2") {
          data = await listEC2Instances(profile, region);
        } else if (selectedService === "RDS") {
          // Placeholder: Add RDS resource listing here
          data = [];
        }
        setResources(data ?? []);
      } catch (error) {
        console.error("Error fetching instances:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchInstances();
  }, [profile, region, selectedService]);

  const consoleUrl = `https://${region}.console.aws.amazon.com/ec2/home?region=${region}#InstanceDetails:instanceId=`;

  return (
    <List
      isLoading={isLoading}
      isShowingDetail
      searchBarPlaceholder="Search AWS Resources..."
      searchBarAccessory={
        <List.Dropdown
          tooltip="Select AWS Service"
          value={selectedService}
          onChange={(newValue) => setSelectedService(newValue as AwsService)}
        >
          <List.Dropdown.Item title="EC2" value="EC2" />
          <List.Dropdown.Item title="RDS" value="RDS" />
        </List.Dropdown>
      }
    >
      {resources?.map((resource) => (
        <List.Item
          key={resource?.InstanceId}
          title={resource?.Tags?.find((tag) => tag.Key === "Name")?.Value ?? resource?.InstanceId ?? ""}
          icon={{ source: Icon.Dot, tintColor: resource?.State?.Name === "running" ? Color.Green : Color.Red }}
          accessories={[
            {
              text: resource?.InstanceId,
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
                  <List.Item.Detail.Metadata.Label title="Private IP Address" text={resource?.PrivateIpAddress ?? ""} />
                  <List.Item.Detail.Metadata.Label title="Public IP Address" text={resource?.PublicIpAddress ?? ""} />
                  <List.Item.Detail.Metadata.Label title="VPC ID" text={resource?.VpcId ?? ""} />
                  <List.Item.Detail.Metadata.Label
                    title="Availability Zone"
                    text={resource?.Placement?.AvailabilityZone ?? ""}
                  />
                  <List.Item.Detail.Metadata.Label title="Subnet ID" text={resource?.SubnetId ?? ""} />
                  <List.Item.Detail.Metadata.TagList title="Tags">
                    {resource?.Tags?.map((tag) => (
                      <List.Item.Detail.Metadata.TagList.Item
                        key={tag.Key}
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
              <Action.OpenInBrowser title="Open in Browser" url={consoleUrl + resource.InstanceId} />
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
        {resource?.Tags?.map((tag) => (
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
    return response.Reservations?.flatMap((reservation) => reservation.Instances ?? []) ?? [];
  } catch (error) {
    console.error(error);
    return [];
  }
}
