import { useState, useCallback, useEffect } from "react";
import { Color, Icon, List, ActionPanel, Action, getPreferenceValues, Detail } from "@raycast/api";
import { DescribeInstancesCommand, Instance } from "@aws-sdk/client-ec2";
import { createEC2Client } from "./shared/awsClient";
import { useAwsProfileDropdown, useProfileOptions } from "./shared/awsProfileSelection";

interface Preferences {
  awsProfile: string;
  defaultRegion: string;
  defaultTerminal: string;
}

export default function Command() {
  const { awsProfile, defaultRegion, defaultTerminal } = getPreferenceValues<Preferences>();
  const [region, setRegion] = useState(defaultRegion);
  const profileOptions = useProfileOptions();

  const { selectedProfile, dropdown } = useAwsProfileDropdown(awsProfile, (newProfile: string) => {
    const newRegion = profileOptions.find((p) => p.name === newProfile)?.region || defaultRegion;
    setRegion(newRegion);
  });

  const [instances, setInstances] = useState<Instance[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchInstances = async () => {
      setIsLoading(true);
      try {
        const data = await describeEC2Instances(selectedProfile, region);
        setInstances(data ?? []);
      } catch (error) {
        console.error("Error fetching instances:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchInstances();
  }, [selectedProfile, region]);

  const consoleUrl = `https://${region}.console.aws.amazon.com/ec2/home?region=${region}#InstanceDetails:instanceId=`;

  return (
    <List isLoading={isLoading} searchBarAccessory={dropdown} isShowingDetail>
      {instances?.map((instance) => (
        <List.Item
          key={instance?.InstanceId}
          title={instance?.Tags?.find((tag) => tag.Key === "Name")?.Value ?? instance?.InstanceId}
          icon={{ source: Icon.Dot, tintColor: instance?.State?.Name === "running" ? Color.Green : Color.Red }}
          accessories={[
            {
              text: instance?.InstanceId,
            },
          ]}
          detail={
            <List.Item.Detail
              metadata={
                <List.Item.Detail.Metadata>
                  <List.Item.Detail.Metadata.Label
                    title="Name"
                    text={instance?.Tags?.find((tag) => tag.Key === "Name")?.Value ?? ""}
                  />
                  <List.Item.Detail.Metadata.Label title="Instance ID" text={instance?.InstanceId ?? ""} />
                  <List.Item.Detail.Metadata.Label title="Instance Type" text={instance?.InstanceType ?? ""} />
                  <List.Item.Detail.Metadata.Label
                    icon={{
                      source: Icon.Dot,
                      tintColor: instance?.State?.Name === "running" ? Color.Green : Color.Red,
                    }}
                    title="State"
                    text={instance?.State?.Name ?? ""}
                  />
                  <List.Item.Detail.Metadata.Label title="AMI ID" text={instance?.ImageId ?? ""} />
                  <List.Item.Detail.Metadata.Label title="Instance Key Name" text={instance?.KeyName ?? ""} />
                  <List.Item.Detail.Metadata.Label
                    title="Launch Time"
                    text={instance?.LaunchTime?.toISOString() ?? ""}
                  />
                  <List.Item.Detail.Metadata.Separator />
                  <List.Item.Detail.Metadata.Label title="Private IP Address" text={instance?.PrivateIpAddress ?? ""} />
                  <List.Item.Detail.Metadata.Label title="Public IP Address" text={instance?.PublicIpAddress ?? ""} />
                  <List.Item.Detail.Metadata.Label title="VPC ID" text={instance?.VpcId ?? ""} />
                  <List.Item.Detail.Metadata.Label
                    title="Availability Zone"
                    text={instance?.Placement?.AvailabilityZone ?? ""}
                  />
                  <List.Item.Detail.Metadata.Label title="Instance Subnet ID" text={instance?.SubnetId ?? ""} />
                  <List.Item.Detail.Metadata.TagList title="Instance Tags">
                    {instance?.Tags?.map((tag) => (
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
            <ActionPanel title="EC2 Actions">
              <Action.Push title="View Details" target={<InstanceDetailsComponent instance={instance} />} />
              <Action.OpenInBrowser title="Open in Browser" url={consoleUrl + instance.InstanceId} />
              <Action.CopyToClipboard title="Copy Public IP Address" content={instance.PublicIpAddress ?? ""} />
              <Action.Paste
                title="Paste SSH Command"
                content={instance.PublicIpAddress ? `ssh ${instance.PublicIpAddress}` : ""}
              />
              <Action.CopyToClipboard
                title="Copy SSH Command"
                content={instance.PublicIpAddress ? `ssh ${instance.PublicIpAddress}` : ""}
              />
              <Action.CopyToClipboard title="Copy Instance ID" content={instance.InstanceId ?? ""} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

interface InstanceDetailsProps {
  instance: Instance;
}

function InstanceDetailsComponent({ instance }: InstanceDetailsProps) {
  return (
    <List navigationTitle="Instance Details">
      <List.Section title="Instance Details">
        <List.Item
          title="Name"
          accessories={[{ text: instance?.Tags?.find((tag) => tag.Key === "Name")?.Value ?? "N/A" }]}
        />
        <List.Item title="Instance ID" accessories={[{ text: instance?.InstanceId ?? "N/A" }]} />
        <List.Item title="Instance Type" accessories={[{ text: instance?.InstanceType ?? "N/A" }]} />
        <List.Item title="State" accessories={[{ text: instance?.State?.Name ?? "N/A" }]} />
        <List.Item title="Public IP" accessories={[{ text: instance?.PublicIpAddress ?? "N/A" }]} />
        <List.Item title="Private IP" accessories={[{ text: instance?.PrivateIpAddress ?? "N/A" }]} />
        <List.Item title="VPC ID" accessories={[{ text: instance?.VpcId ?? "N/A" }]} />
        <List.Item title="Availability Zone" subtitle={instance?.Placement?.AvailabilityZone ?? "N/A"} />
      </List.Section>
      <List.Section title="Tags">
        {instance?.Tags?.map((tag) => (
          <List.Item key={tag.Key} title={tag.Key ?? "N/A"} subtitle={tag.Value ?? "N/A"} />
        )) ?? <List.Item title="No tags" subtitle="This instance has no tags" />}
      </List.Section>
    </List>
  );
}

export async function describeEC2Instances(profile: string, region: string): Promise<Instance[]> {
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
