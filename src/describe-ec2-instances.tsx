import { useState, useEffect, useCallback } from "react";
import { Color, Icon, List, ActionPanel, Action, getPreferenceValues, Detail } from "@raycast/api";
import { DescribeInstancesCommand, Instance } from "@aws-sdk/client-ec2";
import { createEC2Client } from "./shared/awsClient";
import { useCachedState, useCachedPromise } from "@raycast/utils";
import { loadSharedConfigFiles } from "@aws-sdk/shared-ini-file-loader";

interface Preferences {
  awsProfile: string;
}

export default function Command() {
  const { awsProfile, defaultRegion, defaultTerminal } = getPreferenceValues<Preferences>();
  const [selectedProfile, setSelectedProfile] = useCachedState<string>("aws_profile", awsProfile);
  const [region, setRegion] = useState(defaultRegion);
  
  const { data: instances, isLoading, revalidate } = useCachedPromise(
    async (profile: string, region: string) => {
      return await describeEC2Instances(profile, region);
    },
    [selectedProfile, region]
  );

  const profileOptions = useProfileOptions();

  const handleProfileChange = useCallback((newProfile: string) => {
    setSelectedProfile(newProfile);
    revalidate();
  }, [setSelectedProfile, revalidate]);

  const consoleUrl = `https://${region}.console.aws.amazon.com/ec2/home?region=${region}#InstanceDetails:instanceId=`;

  return (
    <List 
      isLoading={isLoading} 
      searchBarAccessory={
        <List.Dropdown 
          tooltip="Select AWS Profile" 
          onChange={handleProfileChange}
          value={selectedProfile}
        >
          {profileOptions.map((profile) => (
            <List.Dropdown.Item
              key={profile.name}
              value={profile.name}
              title={profile.name}
            />
          ))}
        </List.Dropdown>
      } 
      isShowingDetail
    >
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
                  <List.Item.Detail.Metadata.Label title="Name" text={instance?.Tags?.find((tag) => tag.Key === "Name")?.Value ?? ""} />
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
                  <List.Item.Detail.Metadata.Label title="Availability Zone" text={instance?.Placement?.AvailabilityZone ?? ""} />
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
              <Action.Push title="View Details" target={<InstanceDetailsComponent />} />
              <Action.OpenInBrowser title="Open in Browser" url={consoleUrl + instance.InstanceId} />
              <ActionPanel.Submenu title="Connect" icon={Icon.Ellipsis}>
                <Action.Open
                  title="Connect via SSH"
                  icon={Icon.Terminal}
                  target={`ssh ${instance.PublicIpAddress}`}
                  application={defaultTerminal}
                />
                <Action.Paste title="Paste SSH Command" content={`ssh ${instance.PublicIpAddress}`} />
                <Action.CopyToClipboard title="Copy SSH Command" content={`ssh ${instance.PublicIpAddress}`} />
              </ActionPanel.Submenu>
              <Action.CopyToClipboard title="Copy Public IP Address" content={instance.PublicIpAddress} />
              <Action.CopyToClipboard title="Copy Instance ID" content={instance.InstanceId} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

function ProfileDropdown({ onProfileChange }: { onProfileChange: (newProfile: string) => void }) {
  const [selectedProfile, setSelectedProfile] = useCachedState<string>("aws_profile");
  const profileOptions = useProfileOptions();

  useEffect(() => {
    const isSelectedProfileInvalid =
      selectedProfile && !profileOptions.some((profile) => profile.name === selectedProfile);

    if (!selectedProfile || isSelectedProfileInvalid) {
      setSelectedProfile(profileOptions[0]?.name);
    }
  }, [profileOptions, selectedProfile]);

  useEffect(() => {
    if (selectedProfile) {
      onProfileChange(selectedProfile);
    }
  }, [selectedProfile, onProfileChange]);

  if (!profileOptions || profileOptions.length < 2) {
    return null;
  }

  return (
    <List.Dropdown
      tooltip="Select AWS Profile"
      value={selectedProfile}
      onChange={setSelectedProfile}
    >
      {profileOptions.map((profile) => (
        <List.Dropdown.Item
          key={profile.name}
          value={profile.name}
          title={profile.name}
        />
      ))}
    </List.Dropdown>
  );
}

const useProfileOptions = (): ProfileOption[] => {
  const [profileOptions, setProfileOptions] = useState<ProfileOption[]>([]);

  useEffect(() => {
    const fetchProfileOptions = async () => {
      try {
        const { configFile, credentialsFile } = await loadSharedConfigFiles();
        const profiles = Object.keys(configFile).length > 0 ? configFile : credentialsFile;

        const options = Object.entries(profiles).map(([name, config]) => {
          const region = config.region;
          return { ...config, region, name };
        });

        setProfileOptions(options);
      } catch (error) {
        console.error("Error loading AWS profiles:", error);
      }
    };

    fetchProfileOptions();
  }, []);

  return profileOptions;
};

function InstanceDetailsComponent() {
  return <Detail navigationTitle="Instance Details" markdown={`# Instance Details`} />;
}

export async function describeEC2Instances(profile: string, region: string) {
  const { awsProfile, defaultRegion } = getPreferenceValues<Preferences>();
  const profileToUse = profile || awsProfile;
  const regionToUse = region || defaultRegion;

  try {
    const ec2_client = createEC2Client(profileToUse, regionToUse);
    const input = { DryRun: false };
    const command = new DescribeInstancesCommand(input);
    const response = await ec2_client.send(command);
    const instances = response.Reservations?.flatMap((reservation) => reservation.Instances);

    return instances;
  } catch (error) {
    console.error(error);
  }
}
